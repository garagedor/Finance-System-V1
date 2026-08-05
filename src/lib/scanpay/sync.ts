import "server-only";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { fetchScanpayDisputes, parseAmount, parseScanpayDate, normalizeOutcome } from "./client";
import { matchDispute } from "./match";
import { postDisputeCharge } from "@/lib/dispute-service";
import { shareFromSnapshot } from "./share";
import type { ScanpayDisputeRaw, ScanpayDisputeRecord, ScanpayComputedShare } from "@/types/scanpay";

// Dry-run the shared engine for a matched dispute → its loss allocation
// (+ the actual job's collected/amount/tip).
async function computeShare(jobId: string, amount: number, actor: string): Promise<{ share: ScanpayComputedShare | null; error: string | null }> {
  const r = await postDisputeCharge({ type: "dispute", jobId, amount, actor, dryRun: true });
  if (!r.ok) return { share: null, error: r.error };
  return { share: shareFromSnapshot(r.snapshot), error: null };
}

// Pull all ScanPay disputes, upsert them into the inbox, and auto-match each to
// a CRM job. Human decisions (posted / ignored / manual match) are preserved —
// only volatile fields (status, outcome, resolution date, raw) get refreshed.

export interface ScanpaySyncSummary {
  fetched: number;
  created: number;
  updated: number;
  matchedByInvoice: number;
  matchedByFallback: number;
  unmatched: number;
  preserved: number; // posted/ignored/manual left untouched
}

function toRecordCore(raw: ScanpayDisputeRaw, now: string) {
  return {
    disputeId: raw.disputeId,
    transactionId: raw.transactionId,
    invoiceNumber: raw.invoiceNumber,
    amount: parseAmount(raw.amount),
    currency: raw.currency,
    reason: raw.reason,
    statusRaw: raw.status,
    outcome: normalizeOutcome(raw.status),
    customerName: raw.customerName,
    customerPhone: raw.customerPhone,
    serviceAddress: raw.serviceAddress,
    technicians: Array.isArray(raw.technicians) ? raw.technicians : [],
    scanpayJobId: raw.jobId,
    teamId: raw.teamId ?? null,
    teamName: raw.teamName ?? null,
    disputedAt: parseScanpayDate(raw.disputedDate),
    resolvedAt: parseScanpayDate(raw.resultDate),
    paymentDate: parseScanpayDate(raw.paymentDate) ?? parseScanpayDate(raw.invoiceCreatedAt),
    raw,
    updated_at: now,
  };
}

export async function syncScanpayDisputes(): Promise<ScanpaySyncSummary> {
  await ensureFinanceIndexes();
  const c = coll<ScanpayDisputeRecord>(FINANCE_COLLECTIONS.scanpayDispute);
  const list = await fetchScanpayDisputes();
  const now = new Date().toISOString();

  const summary: ScanpaySyncSummary = {
    fetched: list.length, created: 0, updated: 0,
    matchedByInvoice: 0, matchedByFallback: 0, unmatched: 0, preserved: 0,
  };

  for (const raw of list) {
    const res = await upsertScanpayDispute(raw);
    if (res.action === "created") summary.created++;
    else summary.updated++;
    if (res.action === "preserved") summary.preserved++;
    if (res.matched === "invoice") summary.matchedByInvoice++;
    else if (res.matched === "fallback") summary.matchedByFallback++;
    else if (res.matched === "none") summary.unmatched++;
  }

  return summary;
}

// Upsert a single dispute (match + compute share + preserve human decisions).
// Shared by the full sync and the webhook receiver.
export async function upsertScanpayDispute(
  raw: ScanpayDisputeRaw,
): Promise<{ action: "created" | "updated" | "preserved"; matched: "invoice" | "fallback" | "none" | "preserved" }> {
  await ensureFinanceIndexes();
  const c = coll<ScanpayDisputeRecord>(FINANCE_COLLECTIONS.scanpayDispute);
  const now = new Date().toISOString();
  const core = toRecordCore(raw, now);
  const existing = await c.findOne({ _id: raw.disputeId });

  // Preserve human decisions — refresh only volatile fields.
  if (existing && (existing.matchStatus === "posted" || existing.matchStatus === "ignored" || existing.matchStatus === "verified" || existing.matchMethod === "manual")) {
    await c.updateOne({ _id: raw.disputeId }, { $set: { ...core } });
    return { action: "preserved", matched: "preserved" };
  }

  const { candidates, best } = await matchDispute(raw);
  const matched = best?.method === "invoice" ? "invoice" : best?.method === "fallback" ? "fallback" : "none";

  let computedShare: ScanpayComputedShare | null = null;
  let computeError: string | null = null;
  if (best?.jobId) {
    const cs = await computeShare(best.jobId, core.amount, "scanpay-sync");
    computedShare = cs.share;
    computeError = cs.error;
  }

  const matchFields = {
    matchStatus: (best ? "matched" : "new") as ScanpayDisputeRecord["matchStatus"],
    matchedJobId: best?.jobId ?? null,
    matchMethod: best?.method ?? null,
    matchScore: best?.score ?? null,
    candidates,
    computedShare,
    computeError,
  };

  if (!existing) {
    await c.insertOne({ _id: raw.disputeId, ...core, ...matchFields, postedRecordId: null, ledgerEntryId: null, synced_at: now });
    return { action: "created", matched };
  }
  await c.updateOne({ _id: raw.disputeId }, { $set: { ...core, ...matchFields } });
  return { action: "updated", matched };
}
