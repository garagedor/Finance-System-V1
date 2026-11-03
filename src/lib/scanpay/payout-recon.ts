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
  /** First / last date the bank data covers — payouts outside can't be checked. */
  bankFrom: string | null;
  bankThrough: string | null;
  /** Expected before the bank data starts: can't be checked, not "missing". */
  beforeBank: ScanpayPayoutRecord[];
  /** Per ScanPay account per month: how many payouts reached the bank. */
  byMonth: Array<{ month: string; team: number; payouts: number; inBank: number; inBankAmt: number; notFound: number; notFoundAmt: number; waiting: number }>;
  lastBankSync: string | null;
  totals: { payouts: number; matched: number; missing: number; pending: number; unexplained: number; beforeBank: number };
}

export async function loadPayoutRecon(range: { from: string; to: string }): Promise<PayoutReconView> {
  await ensureFinanceIndexes();
  const db = await getDb();
  // Match with a margin on both sides so payouts and deposits at the edges of
  // the range find each other; only rows inside the range are reported.
  const pFrom = shift(range.from, -WINDOW.after);
  const pTo = shift(range.to, WINDOW.before);
  const allPayouts = await coll<ScanpayPayoutRecord>(FINANCE_COLLECTIONS.scanpayPayout)
    .find({ expectedBy: { $gte: pFrom, $lte: pTo } } as never)
    .sort({ expectedBy: -1 })
    .toArray();
  const inRange = (d: string | null) => !!d && d >= range.from && d <= range.to;
  const payouts = allPayouts.filter((p) => inRange(p.expectedBy));

  const accounts = await db.collection(FINANCE_COLLECTIONS.bankAccountSynced).find({}, { projection: { account_id: 1, name: 1, mask: 1 } }).toArray();
  const acctName = new Map(accounts.map((a) => [String(a.account_id), `${a.name ?? "Account"}${a.mask ? ` ··${a.mask}` : ""}`]));
  const txns = await db.collection(FINANCE_COLLECTIONS.bankTxnSynced).find({
    date: { $gte: shift(pFrom, -WINDOW.before), $lte: shift(pTo, WINDOW.after) },
    amount: { $gt: 0 },
    $or: [{ raw_name: { $regex: /scan\s*pay/i } }, { description: { $regex: /scan\s*pay/i } }],
  }, { projection: { date: 1, amount: 1, account_id: 1 } }).toArray();
  const deposits: DepositForMatch[] = txns.map((t) => ({
    id: String(t._id), date: String(t.date).slice(0, 10), amount: Number(t.amount), account: acctName.get(String(t.account_id)) ?? "",
  }));

  const last = await db.collection(FINANCE_COLLECTIONS.bankTxnSynced).find({}, { projection: { date: 1 } }).sort({ date: -1 }).limit(1).toArray();
  const first = await db.collection(FINANCE_COLLECTIONS.bankTxnSynced).find({}, { projection: { date: 1 } }).sort({ date: 1 }).limit(1).toArray();
  const bankThrough = last[0]?.date ? String(last[0].date).slice(0, 10) : null;
  const bankFrom = first[0]?.date ? String(first[0].date).slice(0, 10) : null;
  const sync = await db.collection(FINANCE_COLLECTIONS.bankSyncLog).find({}, { projection: { started_at: 1 } }).sort({ started_at: -1 }).limit(1).toArray();

  // "Overdue" is judged against what the bank data actually covers.
  const today = new Date().toISOString().slice(0, 10);
  const asOf = bankThrough && bankThrough < today ? bankThrough : today;
  const full = matchPayoutsToBank(
    allPayouts.map((p) => ({ id: p._id, team: p.team, amount: p.amount, expectedBy: p.expectedBy, status: p.status })),
    deposits,
    asOf,
  );
  // Report only what belongs to the range; a payout expected before the bank
  // data starts can't be checked, so it isn't called missing.
  const ids = new Set(payouts.map((p) => p._id));
  const before = (d: string | null) => !!bankFrom && !!d && d < shift(bankFrom, WINDOW.before);
  const usedDeposits = new Set(full.matched.map((m) => m.depositId));
  const result = {
    matched: full.matched.filter((m) => m.payoutIds.some((id) => ids.has(id))),
    missing: full.missing.filter((p) => ids.has(p.id) && !before(p.expectedBy)),
    pending: full.pending.filter((p) => ids.has(p.id)),
    unexplained: full.unexplained.filter((d) => !usedDeposits.has(d.id) && d.date >= range.from && d.date <= range.to),
  };
  const beforeBank = payouts.filter((p) => before(p.expectedBy) && full.missing.some((m) => m.id === p._id));
  const sumP = (ids: Set<string>) => payouts.filter((p) => ids.has(p._id)).reduce((s, p) => s + p.amount, 0);
  const matchedIds = new Set(result.matched.flatMap((m) => m.payoutIds).filter((id) => ids.has(id)));
  const missingIds = new Set(result.missing.map((p) => p.id));
  const months = new Map<string, PayoutReconView["byMonth"][number]>();
  for (const p of payouts) {
    const key = `${(p.expectedBy ?? "").slice(0, 7)}|${p.team}`;
    const r = months.get(key) ?? { month: (p.expectedBy ?? "").slice(0, 7), team: p.team, payouts: 0, inBank: 0, inBankAmt: 0, notFound: 0, notFoundAmt: 0, waiting: 0 };
    r.payouts++;
    if (matchedIds.has(p._id)) { r.inBank++; r.inBankAmt += p.amount; }
    else if (missingIds.has(p._id)) { r.notFound++; r.notFoundAmt += p.amount; }
    else r.waiting++;
    months.set(key, r);
  }
  const byMonth = [...months.values()].sort((a, b) => b.month.localeCompare(a.month) || a.team - b.team);
  return {
    range, payouts, deposits, result, bankFrom, bankThrough, beforeBank, byMonth,
    lastBankSync: sync[0]?.started_at ? String(sync[0].started_at) : null,
    totals: {
      payouts: payouts.reduce((s, p) => s + p.amount, 0),
      matched: sumP(matchedIds),
      missing: result.missing.reduce((s, p) => s + p.amount, 0),
      pending: result.pending.reduce((s, p) => s + p.amount, 0),
      unexplained: result.unexplained.reduce((s, d) => s + d.amount, 0),
      beforeBank: beforeBank.reduce((s, p) => s + p.amount, 0),
    },
  };
}
