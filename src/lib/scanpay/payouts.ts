import "server-only";
import { coll, getDb, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { scanpayKeys, fetchScanpayPayment } from "./client";
import { upsertScanpayRefund } from "./refund-sync";
import {
  invoiceOfCollectedLine, payoutDate, payoutTotals, refundsByPayment, toPayoutQueryDate,
  type PayoutTotals, type ScanpayPayoutLineRaw,
} from "./payout-lines";
import type { ScanpayRefundRecord } from "@/types/scanpay";

// ScanPay payouts → the CRM.
//
//   finance_scanpay_payout       one row per payout (what reached / will reach the bank)
//   finance_scanpay_payout_line  every line inside it (payment, fee, refund, dispute adj.)
//
// What it unlocks:
//   • refund AMOUNTS and DATES — the API never gave them before; a person had to
//     look each partial refund up in ScanPay. applyPayoutRefunds() fills them in
//     (only where empty — a human-entered amount is never overwritten).
//   • refunds the inbox never saw (added through the same upsert as always).
//   • job → payment → payout → bank deposit reconciliation.
//
// Read-only against ScanPay. Strictly one request at a time with a pause:
// ScanPay's firewall answers bursts with 403 for the whole IP.

const BASE = process.env.SCANPAY_API_BASE || "https://api.scanpay.tech";
const PAUSE_MS = 700;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ScanpayPayoutRecord {
  _id: string;              // payoutId "PO-…"
  team: number;             // 1-based index of the team token
  amount: number;
  status: string;           // INITIATED | IN TRANSIT | SUCCESS | …
  expectedBy: string | null; // ISO date the payout should reach the bank
  instant: boolean;
  totals: PayoutTotals | null;
  /** Lines add up to the payout amount (to the cent). */
  balanced: boolean | null;
  lineCount: number;
  detailsSyncedAt: string | null;
  synced_at: string;
}

export interface ScanpayPayoutLineRecord extends ScanpayPayoutLineRaw {
  _id: string;              // `${payoutId}#${n}`
  payoutId: string;
  team: number;
  effect: number;           // signed effect on the payout
  dateIso: string | null;
  invoiceNumber: string | null; // Collected lines name their invoice
}

async function get<T>(key: string, path: string): Promise<T> {
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(4000 * attempt); // back off, never hammer
    res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (res.ok) break;
    if (res.status === 401 || res.status === 404) break;
  }
  if (!res?.ok) throw new Error(`ScanPay ${path.split("?")[0]} failed: HTTP ${res?.status}`);
  await sleep(PAUSE_MS);
  return (await res.json()) as T;
}

type PayoutListRow = { payoutId: string; amount: string; status: string; expectedBy: string; instant: boolean };

async function listPayouts(key: string, since: string, deadline: number): Promise<{ rows: PayoutListRow[]; complete: boolean }> {
  const rows: PayoutListRow[] = [];
  for (let page = 0; page < 200; page++) {
    if (Date.now() > deadline) return { rows, complete: false };
    const q = new URLSearchParams({ startDate: toPayoutQueryDate(since), limit: "100", page: String(page) });
    const body = await get<{ data?: { totalCount?: number; payouts?: PayoutListRow[] } }>(key, `/connect/v1/payouts?${q}`);
    const got = body.data?.payouts ?? [];
    rows.push(...got);
    if (got.length === 0 || rows.length >= (body.data?.totalCount ?? 0)) break;
  }
  return { rows, complete: true };
}

async function payoutDetails(key: string, payoutId: string): Promise<ScanpayPayoutLineRaw[]> {
  const lines: ScanpayPayoutLineRaw[] = [];
  for (let page = 0; page < 50; page++) {
    const body = await get<{ data?: { totalCount?: number; details?: ScanpayPayoutLineRaw[] } }>(
      key, `/connect/v1/payouts/${encodeURIComponent(payoutId)}/details?limit=500&page=${page}`,
    );
    const got = body.data?.details ?? [];
    lines.push(...got);
    if (got.length === 0 || lines.length >= (body.data?.totalCount ?? 0)) break;
  }
  return lines;
}

export interface PayoutSyncSummary {
  teams: number;
  payouts: number;
  detailsFetched: number;
  unbalanced: string[];
  complete: boolean;
}

/**
 * Pull payouts expected on/after `sinceDays` ago, and the lines of every payout
 * whose lines we don't have yet or that may still change (not SUCCESS).
 * A finished payout never changes, so it is read once.
 */
export async function syncScanpayPayouts(opts: { sinceDays: number; budgetMs: number }): Promise<PayoutSyncSummary> {
  await ensureFinanceIndexes();
  const P = coll<ScanpayPayoutRecord>(FINANCE_COLLECTIONS.scanpayPayout);
  const L = coll<ScanpayPayoutLineRecord>(FINANCE_COLLECTIONS.scanpayPayoutLine);
  const deadline = Date.now() + opts.budgetMs;
  const since = new Date(Date.now() - opts.sinceDays * 86_400_000).toISOString().slice(0, 10);
  const keys = scanpayKeys();
  const out: PayoutSyncSummary = { teams: keys.length, payouts: 0, detailsFetched: 0, unbalanced: [], complete: true };

  for (const [i, key] of keys.entries()) {
    const team = i + 1;
    const { rows, complete } = await listPayouts(key, since, deadline);
    if (!complete) out.complete = false;
    const now = new Date().toISOString();
    for (const p of rows) {
      out.payouts++;
      const amount = Math.round(parseFloat(p.amount) * 100) / 100;
      const prev = await P.findOne({ _id: p.payoutId }, { projection: { detailsSyncedAt: 1, status: 1, amount: 1 } });
      await P.updateOne(
        { _id: p.payoutId },
        {
          $set: { team, amount, status: p.status, expectedBy: payoutDate(p.expectedBy), instant: !!p.instant, synced_at: now },
          $setOnInsert: { totals: null, balanced: null, lineCount: 0, detailsSyncedAt: null },
        },
        { upsert: true },
      );
      const settled = prev?.detailsSyncedAt && prev.status === "SUCCESS" && p.status === "SUCCESS" && prev.amount === amount;
      if (settled) continue;
      if (Date.now() > deadline) { out.complete = false; continue; }

      const lines = await payoutDetails(key, p.payoutId);
      out.detailsFetched++;
      const totals = payoutTotals(lines);
      const balanced = Math.abs(totals.net - amount) < 0.01;
      if (!balanced) out.unbalanced.push(p.payoutId);
      await L.deleteMany({ payoutId: p.payoutId });
      if (lines.length) {
        await L.insertMany(lines.map((l, n) => ({
          ...l,
          _id: `${p.payoutId}#${n}`,
          payoutId: p.payoutId,
          team,
          effect: l.type.trim().toLowerCase().startsWith("fee") ? -Math.abs(parseFloat(l.amount) || 0) : parseFloat(l.amount) || 0,
          dateIso: payoutDate(l.date),
          invoiceNumber: /^collected$/i.test(l.type.trim()) ? invoiceOfCollectedLine(l) : null,
        })));
      }
      await P.updateOne({ _id: p.payoutId }, { $set: { totals, balanced, lineCount: lines.length, detailsSyncedAt: new Date().toISOString() } });
    }
  }
  return out;
}

export interface PayoutRefundSummary {
  paymentsWithRefunds: number;
  filled: number;          // refund amount/date written into an existing record
  alreadySet: number;      // record already had an amount (left as is)
  mismatched: number;      // a human-entered amount differs from ScanPay
  added: number;           // refunds the inbox never had, now added
  notFound: number;        // ScanPay payment could not be read
}


/**
 * Write refund amounts/dates from payout lines into the refund inbox.
 * A record is found by its payment id, or — for refunds found on an invoice —
 * by the invoice the payment was collected for. Only EMPTY amounts are filled.
 */
export async function applyPayoutRefunds(opts: { addMissing?: boolean; budgetMs?: number } = {}): Promise<PayoutRefundSummary> {
  await ensureFinanceIndexes();
  const db = await getDb();
  const R = coll<ScanpayRefundRecord>(FINANCE_COLLECTIONS.scanpayRefund);
  const L = db.collection<ScanpayPayoutLineRecord>(FINANCE_COLLECTIONS.scanpayPayoutLine);
  const deadline = Date.now() + (opts.budgetMs ?? 60_000);

  const refundLines = await L.find({ type: { $regex: /^refunds?$/i } }).toArray();
  const byPayment = refundsByPayment(refundLines);
  const out: PayoutRefundSummary = { paymentsWithRefunds: byPayment.size, filled: 0, alreadySet: 0, mismatched: 0, added: 0, notFound: 0 };
  if (byPayment.size === 0) return out;

  // payment id → invoice number, from the Collected lines we already hold.
  const collected = await L.find(
    { relatedPaymentId: { $in: [...byPayment.keys()] }, invoiceNumber: { $ne: null } },
    { projection: { relatedPaymentId: 1, invoiceNumber: 1 } },
  ).toArray();
  const invoiceOf = new Map(collected.map((l) => [l.relatedPaymentId!, l.invoiceNumber!]));

  const now = new Date().toISOString();
  for (const ref of byPayment.values()) {
    let rec = await R.findOne({ $or: [{ _id: ref.paymentId }, { paymentId: ref.paymentId }] } as never);
    const invoiceNumber = invoiceOf.get(ref.paymentId) ?? rec?.invoiceNumber ?? null;
    if (!rec && invoiceNumber) rec = await R.findOne({ invoiceNumber, source: "invoice" } as never);

    if (!rec && opts.addMissing && Date.now() < deadline) {
      const raw = await fetchScanpayPayment(ref.paymentId);
      if (!raw) { out.notFound++; continue; }
      const res = await upsertScanpayRefund(raw, "payment");
      if (res.action === "created") out.added++;
      rec = await R.findOne({ _id: raw.id } as never);
      if (!rec && raw.invoiceNumber) rec = await R.findOne({ invoiceNumber: raw.invoiceNumber, source: "invoice" } as never);
    }
    if (!rec) continue;

    const payout = { amount: ref.amount, date: ref.lastDate, firstDate: ref.firstDate, refundIds: ref.refundIds, paymentId: ref.paymentId, at: now };
    // Fill when empty, or when the only value so far came from a webhook
    // (ScanPay's payout is the settled figure). A person's value is kept.
    if (rec.refundAmount == null || rec.refundAmountSource === "webhook") {
      await R.updateOne({ _id: rec._id }, {
        $set: { refundAmount: ref.amount, refundDate: rec.refundDate ?? ref.lastDate, refundAmountSource: "payout", payoutRefund: payout, updated_at: now },
      } as never);
      out.filled++;
    } else {
      const mismatch = Math.abs(Number(rec.refundAmount) - ref.amount) >= 0.01;
      if (mismatch) out.mismatched++; else out.alreadySet++;
      await R.updateOne({ _id: rec._id }, { $set: { payoutRefund: payout, refundAmountMismatch: mismatch, updated_at: now } } as never);
    }
  }
  return out;
}
