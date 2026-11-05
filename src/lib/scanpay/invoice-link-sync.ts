import "server-only";
import { coll, getDb, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { scanpayKeys } from "./client";
import { planInvoiceLinks, type Evidence, type LinkInvoice, type LinkJob, type SuggestionReason } from "./invoice-link";

// Every day (owner, 2026-11-05: "do it automatically, always"): attach paid
// ScanPay invoices to their CRM job (Job.invoiceNumber) with the proven rules in
// ./invoice-link. Certain links are written — only on jobs that have no invoice
// number; the rest become suggestions in finance_scanpay_link_suggestion for a
// person to confirm (Banking → Invoice links). Read-only against ScanPay.

const BASE = process.env.SCANPAY_API_BASE || "https://api.scanpay.tech";
export const AUTO_LINK_ACTOR = "auto-link";

export interface LinkSuggestionRecord {
  _id: string;                // invoiceNumber
  team: number;
  invoice: { invoiceNumber: string; createdAt: string; amount: number; tip: number; customerName: string | null; customerPhone: string | null; member: string | null };
  reason: SuggestionReason;
  candidates: Array<{ jobId: string; date: string | null; clientName: string | null; address: string | null; tech: string | null; card: number; evidence: Evidence[] }>;
  status: "open" | "linked" | "dismissed";
  linkedJobId?: string | null;
  decidedBy?: string | null;
  created_at: string;
  updated_at: string;
}

type ScanpayInvoiceRow = LinkInvoice & { id?: string };

async function recentInvoices(sinceIso: string, deadline: number): Promise<{ invoices: ScanpayInvoiceRow[]; complete: boolean }> {
  const out: ScanpayInvoiceRow[] = [];
  for (const [i, key] of scanpayKeys().entries()) {
    for (let page = 0; page < 40; page++) {
      if (Date.now() > deadline) return { invoices: out, complete: false };
      let res: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, 4000 * attempt));
        res = await fetch(`${BASE}/connect/v1/invoices?page=${page}&limit=500`, {
          headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, cache: "no-store",
        });
        if (res.ok) break;
      }
      if (!res?.ok) throw new Error(`ScanPay invoices: HTTP ${res?.status}`);
      const rows = ((await res.json()) as { data?: { invoices?: ScanpayInvoiceRow[] } }).data?.invoices ?? [];
      if (!rows.length) break;
      for (const r of rows) out.push({ ...r, team: i + 1 });
      const oldest = rows[rows.length - 1].createdAt;
      await new Promise((r) => setTimeout(r, 600));
      if (oldest && Date.parse(oldest) < Date.parse(sinceIso)) break;
    }
  }
  return { invoices: out, complete: true };
}

export interface InvoiceLinkSummary {
  invoices: number;
  linked: number;
  suggestions: number;
  alreadyOnJob: number;
  noCandidate: number;
  complete: boolean;
  dryRun: boolean;
  sample?: Array<{ invoiceNumber: string; jobId: string; evidence: Evidence[] }>;
}

export async function syncInvoiceLinks(opts: { sinceDays: number; budgetMs: number; dryRun?: boolean }): Promise<InvoiceLinkSummary> {
  await ensureFinanceIndexes();
  const db = await getDb();
  const since = new Date(Date.now() - opts.sinceDays * 86_400_000).toISOString();
  const { invoices: all, complete } = await recentInvoices(since, Date.now() + opts.budgetMs);
  const invoices = all.filter((x) => x.createdAt && Date.parse(x.createdAt) >= Date.parse(since));
  if (!invoices.length) return { invoices: 0, linked: 0, suggestions: 0, alreadyOnJob: 0, noCandidate: 0, complete, dryRun: !!opts.dryRun };

  const days = invoices.map((x) => String(x.createdAt).slice(0, 10)).sort();
  const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const jobsRaw = await db.collection("Job").find(
    { date: { $gte: shift(days[0], -5), $lte: shift(days[days.length - 1], 2) } },
    { projection: { date: 1, clientName: 1, clientPhoneNumber: 1, tech: 1, totalPaidCard: 1, tipsCard: 1, invoiceNumber: 1, address: 1 } },
  ).toArray();
  const jobs: LinkJob[] = jobsRaw.map((j) => ({ ...j, _id: String(j._id) })) as LinkJob[];

  // Who each ScanPay user is: learned from invoices already on a job, else by name.
  const byNumber = new Map(all.map((x) => [x.invoiceNumber, x]));
  const memberTechs = new Map<string, Set<string>>();
  const linkedJobs = await db.collection("Job").find(
    { invoiceNumber: { $in: [...byNumber.keys()] } }, { projection: { invoiceNumber: 1, tech: 1 } },
  ).toArray();
  for (const j of linkedJobs) {
    const inv = byNumber.get(String(j.invoiceNumber));
    if (inv?.memberId && j.tech) memberTechs.set(inv.memberId, (memberTechs.get(inv.memberId) ?? new Set()).add(String(j.tech)));
  }
  const memberNames = new Map(
    (await db.collection(FINANCE_COLLECTIONS.scanpayMember).find({}, { projection: { name: 1 } }).toArray()).map((m) => [String(m._id), String(m.name ?? "")]),
  );

  const plan = planInvoiceLinks({ invoices, jobs, memberTechs, memberNames });
  const summary: InvoiceLinkSummary = {
    invoices: invoices.length, linked: 0, suggestions: plan.suggestions.length,
    alreadyOnJob: plan.skipped.alreadyOnJob, noCandidate: plan.skipped.noCandidate, complete, dryRun: !!opts.dryRun,
  };
  if (opts.dryRun) {
    summary.linked = plan.links.length;
    summary.sample = plan.links.slice(0, 20).map((l) => ({ invoiceNumber: l.invoice.invoiceNumber, jobId: l.job._id, evidence: l.evidence }));
    return summary;
  }

  const { ObjectId } = await import("mongodb");
  const now = new Date().toISOString();
  const S = coll<LinkSuggestionRecord>(FINANCE_COLLECTIONS.scanpayLinkSuggestion);
  for (const l of plan.links) {
    const r = await db.collection("Job").updateOne(
      { _id: new ObjectId(l.job._id), $or: [{ invoiceNumber: { $exists: false } }, { invoiceNumber: null }, { invoiceNumber: "" }] },
      { $set: { invoiceNumber: l.invoice.invoiceNumber, invoiceLinkedBy: AUTO_LINK_ACTOR, invoiceLinkedAt: now, invoiceLinkTeam: l.invoice.team, invoiceLinkEvidence: l.evidence } },
    );
    if (r.modifiedCount) summary.linked++;
  }

  const num = (v: unknown) => { const n = parseFloat(String(v ?? "").replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : 0; };
  for (const s of plan.suggestions) {
    const doc = {
      team: s.invoice.team,
      invoice: {
        invoiceNumber: s.invoice.invoiceNumber, createdAt: s.invoice.createdAt, amount: num(s.invoice.amount), tip: num(s.invoice.tipAmount),
        customerName: s.invoice.customerName ?? null, customerPhone: s.invoice.customerPhone ?? null,
        member: s.invoice.memberId ? memberNames.get(s.invoice.memberId) ?? null : null,
      },
      reason: s.reason,
      candidates: s.candidates.map((c) => ({
        jobId: c.job._id, date: c.job.date ?? null, clientName: c.job.clientName ?? null, address: c.job.address ?? null,
        tech: c.job.tech ?? null, card: num(c.job.totalPaidCard), evidence: c.evidence,
      })),
      updated_at: now,
    };
    // A person's decision (linked / dismissed) is kept; open ones are refreshed.
    await S.updateOne(
      { _id: s.invoice.invoiceNumber, status: { $nin: ["linked", "dismissed"] } } as never,
      { $set: doc, $setOnInsert: { status: "open", created_at: now } } as never,
      { upsert: true },
    ).catch(() => null); // a decided row makes the upsert collide — fine, it's kept as is
  }
  // Open suggestions whose invoice has since reached a job (typed in, or linked above) are done.
  const open = await S.find({ status: "open" } as never, { projection: { _id: 1 } }).toArray();
  if (open.length) {
    const nowOnJob = await db.collection("Job").find({ invoiceNumber: { $in: open.map((o) => o._id) } }, { projection: { invoiceNumber: 1 } }).toArray();
    if (nowOnJob.length) {
      await S.updateMany({ _id: { $in: nowOnJob.map((j) => String(j.invoiceNumber)) }, status: "open" } as never, { $set: { status: "linked", decidedBy: "on-job", updated_at: now } } as never);
    }
  }
  await db.collection("finance_audit").insertOne({
    _id: `aud_autolink_${Date.now()}`, target_kind: "job", target_id: "multiple", before: null,
    after: { linked: summary.linked, suggestions: summary.suggestions, invoices: summary.invoices },
    summary: `Auto-linked ${summary.linked} ScanPay invoices to CRM jobs; ${summary.suggestions} left as suggestions`,
    action: "auto-link-invoices", changed_by: AUTO_LINK_ACTOR, changed_at: now,
  } as never).catch(() => null);
  return summary;
}
