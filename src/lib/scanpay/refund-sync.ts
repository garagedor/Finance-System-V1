import "server-only";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { fetchScanpayRefunds, fetchRefundedInvoices, parseAmount, parseScanpayDate } from "./client";
import { invoiceToRefundRaw } from "./invoice-refunds";
import { matchRefund } from "./match";
import { postDisputeCharge } from "@/lib/dispute-service";
import { shareFromSnapshot } from "./share";
import type { ScanpayRefundRaw, ScanpayRefundRecord, ScanpayComputedShare } from "@/types/scanpay";

// Dry-run the engine (type "refund") for a matched refund → its loss allocation
// (+ the actual job's collected/amount/tip).
async function computeRefundShare(jobId: string, amount: number): Promise<{ share: ScanpayComputedShare | null; error: string | null }> {
  const r = await postDisputeCharge({ type: "refund", jobId, amount, actor: "scanpay-sync", dryRun: true });
  if (!r.ok) return { share: null, error: r.error };
  return { share: shareFromSnapshot(r.snapshot), error: null };
}

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
    const res = await upsertScanpayRefund(raw);
    if (res.action === "created") summary.created++;
    else if (res.action !== "skipped") summary.updated++;
    if (res.action === "preserved") summary.preserved++;
    if (res.matched === "invoice") summary.matchedByInvoice++;
    else if (res.matched === "none") summary.unmatched++;
  }

  // Refunds found on an INVOICE aren't in the payments list above, so they'd
  // never be re-matched (e.g. after a job gets its invoice number). Re-run
  // the match from their stored raw — no ScanPay call. Rows a person has
  // already decided on are preserved inside the upsert, as always.
  const fromInvoices = await c.find({ source: "invoice", matchStatus: { $in: ["new", "matched"] } } as never).toArray();
  for (const rec of fromInvoices) {
    const res = await upsertScanpayRefund(rec.raw, "invoice");
    if (res.action === "updated") summary.updated++;
    if (res.matched === "invoice") summary.matchedByInvoice++;
    else if (res.matched === "none") summary.unmatched++;
  }

  return summary;
}

// Incremental sync for the scheduled cron: fully process only BRAND-NEW refunds,
// lightly refresh existing ones. Fast.
export async function syncNewScanpayRefunds(): Promise<{ fetched: number; created: number; refreshed: number }> {
  await ensureFinanceIndexes();
  const c = coll<ScanpayRefundRecord>(FINANCE_COLLECTIONS.scanpayRefund);
  const list = await fetchScanpayRefunds();
  const now = new Date().toISOString();
  const existing = new Set(await c.find({}, { projection: { _id: 1 } }).map((d) => d._id).toArray());
  let created = 0, refreshed = 0;
  for (const raw of list) {
    if (!existing.has(raw.id)) {
      await upsertScanpayRefund(raw);
      created++;
    } else {
      await c.updateOne({ _id: raw.id }, { $set: {
        originalAmount: parseAmount(raw.amount),
        paymentDate: parseScanpayDate(raw.createdAt),
        raw,
        updated_at: now,
      } });
      refreshed++;
    }
  }
  return { fetched: list.length, created, refreshed };
}

// Upsert a single refund (match + compute share + preserve human decisions).
// Shared by the full sync and the webhook receiver.
export async function upsertScanpayRefund(
  raw: ScanpayRefundRaw,
  source: "payment" | "invoice" = "payment",
): Promise<{ action: "created" | "updated" | "preserved" | "skipped"; matched: "invoice" | "none" | "preserved" }> {
  await ensureFinanceIndexes();
  const c = coll<ScanpayRefundRecord>(FINANCE_COLLECTIONS.scanpayRefund);
  const now = new Date().toISOString();
  const c0 = core(raw, now);
  const existing = await c.findOne({ _id: raw.id });

  // One refund, two ways in: the refunded PAYMENT, or a REFUNDED invoice
  // (partial refunds). Never let the same invoice land twice. An invoice is
  // skipped when anything for it exists; a payment is skipped only when the
  // invoice route got there first — two payments on one invoice can each be
  // refunded in full, and each is its own refund.
  if (!existing && raw.invoiceNumber) {
    const sameInvoice = await c.findOne(
      source === "invoice" ? { invoiceNumber: raw.invoiceNumber } : { invoiceNumber: raw.invoiceNumber, source: "invoice" },
      { projection: { _id: 1 } },
    );
    if (sameInvoice) return { action: "skipped", matched: "preserved" };
  }

  if (existing && (existing.matchStatus === "posted" || existing.matchStatus === "ignored" || existing.matchStatus === "verified" || existing.matchMethod === "manual")) {
    await c.updateOne({ _id: raw.id }, { $set: { ...c0 } });
    return { action: "preserved", matched: "preserved" };
  }

  const { candidates, best } = await matchRefund(raw);
  const matched = best?.method === "invoice" ? "invoice" : "none";

  let computedShare: ScanpayComputedShare | null = null;
  let computeError: string | null = null;
  if (best?.jobId) {
    const cs = await computeRefundShare(best.jobId, c0.originalAmount);
    computedShare = cs.share;
    computeError = cs.error;
  }

  const matchFields = {
    matchStatus: (best ? "matched" : "new") as ScanpayRefundRecord["matchStatus"],
    matchedJobId: best?.jobId ?? null,
    matchMethod: best?.method ?? null,
    matchScore: best?.score ?? null,
    candidates,
    computedShare,
    computeError,
  };

  if (!existing) {
    await c.insertOne({ _id: raw.id, ...c0, source, refundAmount: null, refundDate: null, ...matchFields, postedRecordId: null, ledgerEntryId: null, synced_at: now });
    return { action: "created", matched };
  }
  await c.updateOne({ _id: raw.id }, { $set: { ...c0, ...matchFields } });
  return { action: "updated", matched };
}

// Partial refunds: REFUNDED invoices that the payments list never shows (see
// ./invoice-refunds). Adds the new ones to the inbox through the same upsert —
// same matching, same share preview, same human confirm. Existing rows are left
// exactly as they are.
export async function syncRefundedInvoices(opts: { sinceDays: number; budgetMs: number }): Promise<{
  pages: number; found: number; created: number; skipped: number; complete: boolean;
}> {
  const since = new Date(Date.now() - opts.sinceDays * 86_400_000).toISOString();
  const scan = await fetchRefundedInvoices({ since, deadline: Date.now() + opts.budgetMs });
  const c = coll<ScanpayRefundRecord>(FINANCE_COLLECTIONS.scanpayRefund);
  let created = 0, skipped = 0;
  for (const inv of scan.invoices) {
    if (await c.findOne({ _id: inv.id }, { projection: { _id: 1 } })) { skipped++; continue; }
    const res = await upsertScanpayRefund(invoiceToRefundRaw(inv), "invoice");
    if (res.action === "created") created++; else skipped++;
  }
  return { pages: scan.pages, found: scan.invoices.length, created, skipped, complete: scan.complete };
}
