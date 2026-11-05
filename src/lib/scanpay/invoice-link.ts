// ScanPay invoice → CRM job: which job does a paid invoice belong to? (pure, unit-tested)
//
// The rules of the one-off link run on 2026-10-13 (1,125 right / 0 wrong on
// the known links), now run every day. An invoice is linked only when ONE job fits all of:
//   · job date within 5 days before … 2 days after the invoice
//   · card amount matches within $2 (card, card + card tip, or invoice minus tip)
//   · customer name / phone don't contradict (when both sides have one)
//   · the technician fits the ScanPay user who made the invoice, when known
// …and that job fits no other invoice, and it has at least one confirming
// sign beyond date + amount (name, phone or technician). Jobs that already
// carry an invoice number are never changed. Anything less certain becomes a
// suggestion for a person to confirm.

import { techMatches } from "./match-score";

export interface LinkInvoice {
  invoiceNumber: string;
  team: number;
  createdAt: string;
  amount: string | number;
  tipAmount?: string | number;
  customerName?: string | null;
  customerPhone?: string | null;
  memberId?: string | null;
  status?: string;
}

export interface LinkJob {
  _id: string;
  date?: string;
  clientName?: string | null;
  clientPhoneNumber?: string | null;
  tech?: string | null;
  totalPaidCard?: unknown;
  tipsCard?: unknown;
  invoiceNumber?: string | null;
  address?: string | null;
}

export type Evidence = "date" | "amount" | "name" | "phone" | "tech";

export interface PlannedLink { invoice: LinkInvoice; job: LinkJob; evidence: Evidence[] }
export type SuggestionReason = "ambiguous" | "weak" | "shared-job" | "tech-mismatch" | "amount-differs";
export interface Suggestion { invoice: LinkInvoice; reason: SuggestionReason; candidates: Array<{ job: LinkJob; evidence: Evidence[] }> }

const num = (v: unknown) => { const n = parseFloat(String(v ?? "").replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : 0; };
const words = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length > 1);
const phone10 = (s: unknown) => String(s ?? "").replace(/\D/g, "").slice(-10);
const day = (iso: unknown) => String(iso ?? "").slice(0, 10);
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export const isPaidInvoice = (inv: LinkInvoice) => inv.status === "PAID" || /REFUND/i.test(inv.status ?? "");

/** true / false when both sides have a name, null when one is missing. */
export function nameOk(inv: LinkInvoice, j: LinkJob): boolean | null {
  const a = words(inv.customerName), b = words(j.clientName);
  if (!a.length || !b.length) return null;
  return a.some((w) => b.includes(w));
}
export function phoneOk(inv: LinkInvoice, j: LinkJob): boolean | null {
  const a = phone10(inv.customerPhone), b = phone10(j.clientPhoneNumber);
  if (a.length < 10 || b.length < 10) return null;
  return a === b;
}
export function amountOk(inv: LinkInvoice, j: LinkJob): boolean {
  const card = num(j.totalPaidCard), tip = num(j.tipsCard), amt = num(inv.amount), itip = num(inv.tipAmount);
  if (card <= 0) return false;
  return Math.abs(card + tip - amt) <= 2 || Math.abs(card - (amt - itip)) <= 2 || Math.abs(card - amt) <= 2;
}

/**
 * Who a ScanPay user is in the CRM. Learned from jobs that already carry one of
 * their invoices (memberTechs); otherwise by name (members: memberId → name).
 */
export function techFits(inv: LinkInvoice, j: LinkJob, memberTechs: Map<string, Set<string>>, memberNames: Map<string, string>): boolean | null {
  if (!inv.memberId || !j.tech) return null;
  const learned = memberTechs.get(inv.memberId);
  if (learned?.size) return learned.has(String(j.tech));
  const name = memberNames.get(inv.memberId);
  return name ? techMatches(j.tech, [name]) : null;
}

export function evidenceFor(inv: LinkInvoice, j: LinkJob, memberTechs: Map<string, Set<string>>, memberNames: Map<string, string>): Evidence[] {
  return [
    "date", "amount",
    ...(nameOk(inv, j) === true ? ["name" as const] : []),
    ...(phoneOk(inv, j) === true ? ["phone" as const] : []),
    ...(techFits(inv, j, memberTechs, memberNames) === true ? ["tech" as const] : []),
  ];
}

export function planInvoiceLinks(input: {
  invoices: LinkInvoice[];
  jobs: LinkJob[];                       // jobs around the invoices' dates
  memberTechs: Map<string, Set<string>>;
  memberNames: Map<string, string>;
}): { links: PlannedLink[]; suggestions: Suggestion[]; skipped: { alreadyOnJob: number; noCandidate: number } } {
  const { jobs, memberTechs, memberNames } = input;
  const byDay = new Map<string, LinkJob[]>();
  for (const j of jobs) { const d = day(j.date); byDay.set(d, [...(byDay.get(d) ?? []), j]); }
  const onJob = new Set(jobs.map((j) => String(j.invoiceNumber ?? "").trim()).filter(Boolean));

  const skipped = { alreadyOnJob: 0, noCandidate: 0 };
  const suggestions: Suggestion[] = [];
  const proposals: PlannedLink[] = [];

  for (const inv of input.invoices) {
    if (!isPaidInvoice(inv)) continue;
    if (onJob.has(inv.invoiceNumber)) { skipped.alreadyOnJob++; continue; }
    const d = day(inv.createdAt);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const pool: LinkJob[] = [];
    for (let k = -5; k <= 2; k++) pool.push(...(byDay.get(shift(d, k)) ?? []));
    let cands = pool.filter((j) => !String(j.invoiceNumber ?? "").trim() && amountOk(inv, j) && nameOk(inv, j) !== false && phoneOk(inv, j) !== false);
    if (!cands.length) {
      // No job with this card amount — but maybe the same customer's job,
      // with the amount typed differently. A person checks and fixes it.
      const same = pool.filter((j) => !String(j.invoiceNumber ?? "").trim() && (nameOk(inv, j) === true || phoneOk(inv, j) === true));
      if (same.length) {
        suggestions.push({ invoice: inv, reason: "amount-differs", candidates: same.slice(0, 5).map((j) => ({ job: j, evidence: evidenceFor(inv, j, memberTechs, memberNames).filter((e) => e !== "amount") })) });
      } else skipped.noCandidate++;
      continue;
    }

    const withTech = cands.filter((j) => techFits(inv, j, memberTechs, memberNames) !== false);
    const ev = (j: LinkJob) => ({ job: j, evidence: evidenceFor(inv, j, memberTechs, memberNames) });
    if (!withTech.length) { suggestions.push({ invoice: inv, reason: "tech-mismatch", candidates: cands.slice(0, 5).map(ev) }); continue; }
    cands = withTech;
    if (cands.length > 1) {
      const strong = cands.filter((j) => nameOk(inv, j) === true || phoneOk(inv, j) === true);
      if (strong.length === 1) cands = strong;
    }
    if (cands.length > 1) { suggestions.push({ invoice: inv, reason: "ambiguous", candidates: cands.slice(0, 5).map(ev) }); continue; }
    const e = ev(cands[0]);
    if (e.evidence.length <= 2) { suggestions.push({ invoice: inv, reason: "weak", candidates: [e] }); continue; }
    proposals.push({ invoice: inv, job: cands[0], evidence: e.evidence });
  }

  // One-to-one: a job claimed by two invoices is left for a person (split payment?).
  const claims = new Map<string, number>();
  for (const p of proposals) claims.set(p.job._id, (claims.get(p.job._id) ?? 0) + 1);
  const links: PlannedLink[] = [];
  for (const p of proposals) {
    if ((claims.get(p.job._id) ?? 0) > 1) suggestions.push({ invoice: p.invoice, reason: "shared-job", candidates: [{ job: p.job, evidence: p.evidence }] });
    else links.push(p);
  }
  return { links, suggestions, skipped };
}
