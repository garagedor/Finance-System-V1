import "server-only";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { fetchDashboardData } from "@/lib/portal-data";
import type { BankTransactionSyncedRecord } from "@/types/finance-plaid";
import type { DateWindow, DetectorContext, LedgerBalance } from "./framework";

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function win(fromDaysAgo: number, toDaysAgo: number): DateWindow {
  const now = new Date();
  const f = new Date(now);
  f.setUTCDate(f.getUTCDate() - fromDaysAgo);
  const t = new Date(now);
  t.setUTCDate(t.getUTCDate() - toDaysAgo);
  return { from: ymd(f), to: ymd(t) };
}

/** Build the shared inputs once. Every detector reads from this — the database
 *  is queried a fixed number of times regardless of how many detectors run. */
export async function buildDetectorContext(): Promise<Omit<DetectorContext, "cfg">> {
  await ensureFinanceIndexes();
  const last7 = win(7, 0);
  const last30 = win(30, 0);
  const prev30 = win(60, 31);

  const [dashboard30, dashboardPrev30, bankTxns, balAgg, ledgers] = await Promise.all([
    fetchDashboardData(last30),
    fetchDashboardData(prev30),
    coll<BankTransactionSyncedRecord>(FINANCE_COLLECTIONS.bankTxnSynced)
      .find({ date: { $gte: prev30.from } })
      .sort({ date: -1 })
      .limit(5000)
      .toArray(),
    coll<Record<string, unknown>>(FINANCE_COLLECTIONS.ledgerEntry)
      .aggregate([{ $group: { _id: "$ledger_id", balance: { $sum: "$amount" } } }])
      .toArray(),
    coll<Record<string, unknown>>(FINANCE_COLLECTIONS.ledger).find({}).toArray(),
  ]);

  const byId = new Map(ledgers.map((l) => [String(l._id), l]));
  const ledgerBalances: LedgerBalance[] = balAgg.map((b) => {
    const l = byId.get(String(b._id));
    return {
      ledgerId: String(b._id),
      name: (l?.name as string) ?? (l?.person as string) ?? String(b._id),
      role: (l?.role as string) ?? null,
      location: (l?.location as string) ?? null,
      balance: Number(b.balance) || 0,
    };
  });

  return {
    today: ymd(new Date()),
    windows: { last7, last30, prev30 },
    dashboard30,
    dashboardPrev30,
    bankTxns,
    ledgerBalances,
  };
}
