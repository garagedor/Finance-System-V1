import "server-only";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { fetchScanpayDisputes, parseAmount, parseScanpayDate, normalizeOutcome } from "./client";
import { matchDispute } from "./match";
import type { ScanpayDisputeRaw, ScanpayDisputeRecord } from "@/types/scanpay";

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
    const core = toRecordCore(raw, now);
    const existing = await c.findOne({ _id: raw.disputeId });

    // Preserve human decisions — refresh only volatile fields.
    if (existing && (existing.matchStatus === "posted" || existing.matchStatus === "ignored" || existing.matchMethod === "manual")) {
      await c.updateOne({ _id: raw.disputeId }, { $set: { ...core } });
      summary.preserved++;
      summary.updated++;
      continue;
    }

    const { candidates, best } = await matchDispute(raw);
    if (best?.method === "invoice") summary.matchedByInvoice++;
    else if (best?.method === "fallback") summary.matchedByFallback++;
    else summary.unmatched++;

    const matchFields = {
      matchStatus: (best ? "matched" : "new") as ScanpayDisputeRecord["matchStatus"],
      matchedJobId: best?.jobId ?? null,
      matchMethod: best?.method ?? null,
      matchScore: best?.score ?? null,
      candidates,
    };

    if (!existing) {
      const doc: ScanpayDisputeRecord = {
        _id: raw.disputeId,
        ...core,
        ...matchFields,
        postedRecordId: null,
        ledgerEntryId: null,
        synced_at: now,
      };
      await c.insertOne(doc);
      summary.created++;
    } else {
      await c.updateOne({ _id: raw.disputeId }, { $set: { ...core, ...matchFields } });
      summary.updated++;
    }
  }

  return summary;
}
