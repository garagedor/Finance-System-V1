import "server-only";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { fetchScanpayRefunds, parseAmount, parseScanpayDate } from "./client";
import { matchRefund } from "./match";
import type { ScanpayRefundRaw, ScanpayRefundRecord } from "@/types/scanpay";

// Pull refunded ScanPay payments, upsert into the refund inbox, auto-match to a
// CRM job by invoice number. Human decisions (posted / ignored / manual) are
// preserved. Refund amount/date are NOT set here — the human enters them when
// confirming (ScanPay's API doesn't expose them).

export interface ScanpayRefundSyncSummary {
  fetched: number;
  created: number;
  updated: number;
  matchedByInvoice: number;
  unmatched: number;
  preserved: number;
}

function core(raw: ScanpayRefundRaw, now: string) {
  return {
    paymentId: raw.id,
    invoiceId: raw.invoiceId,
    invoiceNumber: raw.invoiceNumber,
    originalAmount: parseAmount(raw.amount),
    paymentDate: parseScanpayDate(raw.createdAt),
    paymentMethod: raw.paymentMethod,
    raw,
    updated_at: now,
  };
}

export async function syncScanpayRefunds(): Promise<ScanpayRefundSyncSummary> {
  await ensureFinanceIndexes();
  const c = coll<ScanpayRefundRecord>(FINANCE_COLLECTIONS.scanpayRefund);
  const list = await fetchScanpayRefunds();
  const now = new Date().toISOString();

  const summary: ScanpayRefundSyncSummary = {
    fetched: list.length, created: 0, updated: 0, matchedByInvoice: 0, unmatched: 0, preserved: 0,
  };

  for (const raw of list) {
    const c0 = core(raw, now);
    const existing = await c.findOne({ _id: raw.id });

    if (existing && (existing.matchStatus === "posted" || existing.matchStatus === "ignored" || existing.matchMethod === "manual")) {
      await c.updateOne({ _id: raw.id }, { $set: { ...c0 } });
      summary.preserved++; summary.updated++;
      continue;
    }

    const { candidates, best } = await matchRefund(raw);
    if (best?.method === "invoice") summary.matchedByInvoice++;
    else summary.unmatched++;

    const matchFields = {
      matchStatus: (best ? "matched" : "new") as ScanpayRefundRecord["matchStatus"],
      matchedJobId: best?.jobId ?? null,
      matchMethod: best?.method ?? null,
      matchScore: best?.score ?? null,
      candidates,
    };

    if (!existing) {
      const doc: ScanpayRefundRecord = {
        _id: raw.id,
        ...c0,
        refundAmount: null,
        refundDate: null,
        ...matchFields,
        postedRecordId: null,
        ledgerEntryId: null,
        synced_at: now,
      };
      await c.insertOne(doc);
      summary.created++;
    } else {
      await c.updateOne({ _id: raw.id }, { $set: { ...c0, ...matchFields } });
      summary.updated++;
    }
  }

  return summary;
}
