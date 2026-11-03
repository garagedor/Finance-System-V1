import "server-only";
import { coll, getDb, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { matchPayoutsToBank, WINDOW, type DepositForMatch, type PayoutBankResult } from "./payout-bank-match";
import type { ScanpayPayoutRecord } from "./payouts";

// Loads ScanPay payouts and the bank's "SCANPAY USA" deposits for a date range
// and pairs them (lib/scanpay/payout-bank-match). Read-only.

const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export interface PayoutReconView {
  range: { from: string; to: string };
  payouts: ScanpayPayoutRecord[];
  deposits: DepositForMatch[];
  result: PayoutBankResult;
  /** Last date the bank data covers — later payouts can't be checked yet. */
  bankThrough: string | null;
  lastBankSync: string | null;
  totals: { payouts: number; matched: number; missing: number; pending: number; unexplained: number };
}

export async function loadPayoutRecon(range: { from: string; to: string }): Promise<PayoutReconView> {
  await ensureFinanceIndexes();
  const db = await getDb();
  const payouts = await coll<ScanpayPayoutRecord>(FINANCE_COLLECTIONS.scanpayPayout)
    .find({ expectedBy: { $gte: range.from, $lte: range.to } } as never)
    .sort({ expectedBy: -1 })
    .toArray();

  const accounts = await db.collection(FINANCE_COLLECTIONS.bankAccountSynced).find({}, { projection: { account_id: 1, name: 1, mask: 1 } }).toArray();
  const acctName = new Map(accounts.map((a) => [String(a.account_id), `${a.name ?? "Account"}${a.mask ? ` ··${a.mask}` : ""}`]));
  const txns = await db.collection(FINANCE_COLLECTIONS.bankTxnSynced).find({
    date: { $gte: shift(range.from, -WINDOW.before), $lte: shift(range.to, WINDOW.after) },
    amount: { $gt: 0 },
    $or: [{ raw_name: { $regex: /scan\s*pay/i } }, { description: { $regex: /scan\s*pay/i } }],
  }, { projection: { date: 1, amount: 1, account_id: 1 } }).toArray();
  const deposits: DepositForMatch[] = txns.map((t) => ({
    id: String(t._id), date: String(t.date).slice(0, 10), amount: Number(t.amount), account: acctName.get(String(t.account_id)) ?? "",
  }));

  const last = await db.collection(FINANCE_COLLECTIONS.bankTxnSynced).find({}, { projection: { date: 1 } }).sort({ date: -1 }).limit(1).toArray();
  const bankThrough = last[0]?.date ? String(last[0].date).slice(0, 10) : null;
  const sync = await db.collection(FINANCE_COLLECTIONS.bankSyncLog).find({}, { projection: { started_at: 1 } }).sort({ started_at: -1 }).limit(1).toArray();

  // "Overdue" is judged against what the bank data actually covers.
  const today = new Date().toISOString().slice(0, 10);
  const asOf = bankThrough && bankThrough < today ? bankThrough : today;
  const result = matchPayoutsToBank(
    payouts.map((p) => ({ id: p._id, team: p.team, amount: p.amount, expectedBy: p.expectedBy, status: p.status })),
    deposits,
    asOf,
  );
  const sumP = (ids: Set<string>) => payouts.filter((p) => ids.has(p._id)).reduce((s, p) => s + p.amount, 0);
  const matchedIds = new Set(result.matched.flatMap((m) => m.payoutIds));
  return {
    range, payouts, deposits, result, bankThrough,
    lastBankSync: sync[0]?.started_at ? String(sync[0].started_at) : null,
    totals: {
      payouts: payouts.reduce((s, p) => s + p.amount, 0),
      matched: sumP(matchedIds),
      missing: result.missing.reduce((s, p) => s + p.amount, 0),
      pending: result.pending.reduce((s, p) => s + p.amount, 0),
      unexplained: result.unexplained.reduce((s, d) => s + d.amount, 0),
    },
  };
}
