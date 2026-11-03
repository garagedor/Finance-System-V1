import "server-only";
import { getDb } from "@/lib/finance-db";
import { parseAmount, parseScanpayDate } from "./client";
import type { ScanpayDisputeRaw, ScanpayJobCandidate, ScanpayRefundRaw } from "@/types/scanpay";
import { cardAmountMatches, clearWinner, nameMatches, techMatches } from "./match-score";

// Maps a ScanPay dispute to CRM jobs. Primary = exact invoice-number match
// (the field we just added). Fallback = address + amount + tech + date scoring
// for jobs created before invoice numbers were captured.

const STREET_ABBR: Record<string, string> = {
  street: "st", str: "st", avenue: "ave", av: "ave", boulevard: "blvd",
  drive: "dr", road: "rd", lane: "ln", court: "ct", place: "pl",
  terrace: "ter", circle: "cir", parkway: "pkwy", highway: "hwy",
  square: "sq", trail: "trl", way: "way", north: "n", south: "s",
  east: "e", west: "w",
};

export function normalizeInvoice(s: string): string {
  return String(s ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Normalize an address (or street segment) to a comparable token string. */
export function normalizeAddr(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => STREET_ABBR[w] ?? w)
    .join(" ")
    .trim();
}

function streetSegment(serviceAddress: string): string {
  return String(serviceAddress ?? "").split(",")[0].trim();
}

interface JobLite {
  _id: unknown;
  address?: string;
  date?: string;
  totalAmount?: number;
  totalPaidCard?: number;
  tipsCard?: number;
  clientName?: string;
  tech?: string;
}

export async function matchDispute(raw: ScanpayDisputeRaw): Promise<{
  candidates: ScanpayJobCandidate[];
  best: ScanpayJobCandidate | null;
}> {
  const db = await getDb();
  const Job = db.collection<JobLite>("Job");

  // ── 1. Exact invoice-number match ──────────────────────────────────────
  const inv = normalizeInvoice(raw.invoiceNumber);
  if (inv) {
    const hit = await Job.findOne({
      invoiceNumber: { $regex: `^${escapeRegex(inv)}$`, $options: "i" },
    });
    if (hit) {
      const c: ScanpayJobCandidate = {
        jobId: String(hit._id),
        score: 100,
        method: "invoice",
        reason: `invoice ${raw.invoiceNumber} exact`,
        address: hit.address ?? null,
        date: hit.date ?? null,
        totalAmount: hit.totalAmount ?? null,
        tech: hit.tech ?? null,
      };
      return { candidates: [c], best: c };
    }
  }

  // ── 2. Fallback: address + amount + tech + date scoring ────────────────
  const amount = parseAmount(raw.amount);
  const street = streetSegment(raw.serviceAddress);
  const streetNorm = normalizeAddr(street);
  if (!streetNorm) return { candidates: [], best: null };

  // Query by the raw street prefix (case-insensitive) to get a candidate set,
  // then score with the normalized comparison.
  const rows = await Job.find({
    address: { $regex: `^${escapeRegex(street.slice(0, 24))}`, $options: "i" },
  })
    .limit(25)
    .toArray();

  // ScanPay sends the assigned techs as jobAssignees (older rows: technicians),
  // in full ("Oren Kadosh"); techMatches compares them with the CRM short name.
  const techNames = [
    ...(raw.technicians ?? []),
    ...(raw.jobAssignees ?? []),
    raw.collectedBy,
    raw.jobCreatedBy,
  ].filter(Boolean);
  const disputeDay = parseScanpayDate(raw.paymentDate) ?? parseScanpayDate(raw.invoiceCreatedAt);

  const candidates: ScanpayJobCandidate[] = rows.map((j) => {
    let score = 0;
    const reasons: string[] = [];

    const jAddr = normalizeAddr(j.address ?? "");
    if (jAddr === streetNorm) { score += 45; reasons.push("addr exact"); }
    else if (jAddr.startsWith(streetNorm) || streetNorm.startsWith(jAddr)) { score += 35; reasons.push("addr prefix"); }

    if (amount > 0 && cardAmountMatches(j, amount)) { score += 30; reasons.push("amount"); }

    if (techMatches(j.tech, techNames)) { score += 15; reasons.push("tech"); }

    if (disputeDay && j.date) {
      const jd = parseScanpayDate(j.date);
      if (jd) {
        const days = Math.abs(new Date(jd).getTime() - new Date(disputeDay).getTime()) / 86400000;
        if (days <= 3) { score += 10; reasons.push("date"); }
      }
    }

    return {
      jobId: String(j._id),
      score,
      method: "fallback" as const,
      reason: reasons.join("+") || "addr region",
      address: j.address ?? null,
      date: j.date ?? null,
      totalAmount: j.totalAmount ?? null,
      tech: j.tech ?? null,
    };
  });

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, 5);
  // Pre-suggest (human still confirms in the inbox) when:
  //  • a single candidate at least matches the address (unique hit), or
  //  • the top score is high and clearly ahead of the runner-up.
  const best =
    top.length === 0 ? null
    : top.length === 1 && top[0].score >= 35 ? top[0]
    : top[0].score >= 60 && top[0].score - top[1].score >= 15 ? top[0]
    : null;
  return { candidates: top, best };
}

// Refund → job. Refunds carry NO address, so only the invoice number gives a
// confident match; otherwise we offer amount-matched candidates for the human.
export async function matchRefund(
  raw: ScanpayRefundRaw,
  ctx: { customerName?: string | null; createdBy?: string | null } = {},
): Promise<{
  candidates: ScanpayJobCandidate[];
  best: ScanpayJobCandidate | null;
}> {
  const db = await getDb();
  const Job = db.collection<JobLite>("Job");

  const inv = normalizeInvoice(raw.invoiceNumber);
  if (inv) {
    const hit = await Job.findOne({ invoiceNumber: { $regex: `^${escapeRegex(inv)}$`, $options: "i" } });
    if (hit) {
      const c: ScanpayJobCandidate = {
        jobId: String(hit._id), score: 100, method: "invoice",
        reason: `invoice ${raw.invoiceNumber} exact`,
        address: hit.address ?? null, date: hit.date ?? null,
        totalAmount: hit.totalAmount ?? null, tech: hit.tech ?? null,
      };
      return { candidates: [c], best: c };
    }
  }

  // Fallback: card jobs around the payment date whose card amount (with or
  // without the card tip) equals the payment; scored by customer name, the
  // ScanPay user who made the invoice (normally the tech) and the date.
  // Suggested only when one job clearly stands out — a person still confirms.
  const amount = parseAmount(raw.amount);
  const tip = parseAmount(raw.tipAmount);
  const day = (parseScanpayDate(raw.createdAt) ?? "").slice(0, 10);
  if (amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return { candidates: [], best: null };
  const shift = (n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const rows = await Job.find({ date: { $gte: shift(-5), $lte: shift(1) } }, {
    projection: { address: 1, date: 1, totalAmount: 1, totalPaidCard: 1, tipsCard: 1, clientName: 1, tech: 1 },
  }).limit(2000).toArray();
  const dayN = Date.parse(`${day}T00:00:00Z`);
  const candidates: ScanpayJobCandidate[] = rows
    .filter((j) => cardAmountMatches(j, amount, tip))
    .map((j) => {
      let score = 40;
      const reasons = ["amount"];
      if (nameMatches(ctx.customerName, j.clientName)) { score += 30; reasons.push("customer"); }
      if (ctx.createdBy && techMatches(j.tech, [ctx.createdBy])) { score += 15; reasons.push("tech"); }
      const jd = String(j.date ?? "").slice(0, 10);
      const jn = Date.parse(`${jd}T00:00:00Z`);
      if (Number.isFinite(jn) && Math.abs(jn - dayN) <= 86_400_000) { score += 10; reasons.push("date"); }
      return {
        jobId: String(j._id), score, method: "fallback" as const, reason: reasons.join("+"),
        address: j.address ?? null, date: j.date ?? null, totalAmount: j.totalAmount ?? null, tech: j.tech ?? null,
      };
    })
    .sort((a, b) => b.score - a.score);
  return { candidates: candidates.slice(0, 5), best: clearWinner(candidates, 80, 20) };
}
