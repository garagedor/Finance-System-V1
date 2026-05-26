import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import type { BankTransactionSyncedRecord } from "@/types/finance-plaid";
import { fmt$, lastNDays } from "../../format";
import { PageHeader, StatPill, FilterBar, FilterField } from "../../_components/page-helpers";
import BankingTabs from "../BankingTabs";
import ReconcileClient from "./ReconcileClient";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

interface SP {
  from?: string;
  to?: string;
}

async function load(sp: SP) {
  await ensureFinanceIndexes();
  const range = {
    from: sp.from ?? lastNDays(60).from,
    to: sp.to ?? lastNDays(60).to,
  };

  const c = coll<BankTransactionSyncedRecord>(FINANCE_COLLECTIONS.bankTxnSynced);
  const [unmatched, matchedCount, ignoredCount, totalCount] = await Promise.all([
    c.find({
      date: { $gte: range.from, $lte: range.to },
      recon_status: "unmatched",
    })
      .sort({ date: -1 })
      .limit(500)
      .toArray(),
    c.countDocuments({
      date: { $gte: range.from, $lte: range.to },
      recon_status: "matched",
    }),
    c.countDocuments({
      date: { $gte: range.from, $lte: range.to },
      recon_status: "ignored",
    }),
    c.countDocuments({ date: { $gte: range.from, $lte: range.to } }),
  ]);

  const unmatchedTotal = unmatched.length;
  const unmatchedSum = unmatched.reduce((s, t) => s + Math.abs(t.amount), 0);
  const matchPct = totalCount > 0 ? (matchedCount / totalCount) * 100 : 0;

  return { range, unmatched, unmatchedTotal, unmatchedSum, matchedCount, ignoredCount, totalCount, matchPct };
}

export default async function ReconcilePage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const d = await load(sp);

  return (
    <div className="portal-page">
      <PageHeader
        kicker="System · Banking"
        title="Reconciliation"
        subtitle="Match bank activity against your portal expenses, payouts, settlements, and income."
      />

      <BankingTabs active="reconcile" />

      <section className="portal-grid-4">
        <StatPill label="Unmatched (period)" value={d.unmatchedTotal.toLocaleString()} />
        <StatPill label="Unmatched $" value={<span className="money-neg">{fmt$(d.unmatchedSum)}</span>} />
        <StatPill label="Matched" value={<span className="money-pos">{d.matchedCount.toLocaleString()}</span>} />
        <StatPill label="Match rate" value={`${d.matchPct.toFixed(0)}%`} />
      </section>

      <FilterBar>
        <FilterField label="From">
          <input type="date" name="from" defaultValue={d.range.from} className="portal-input" />
        </FilterField>
        <FilterField label="To">
          <input type="date" name="to" defaultValue={d.range.to} className="portal-input" />
        </FilterField>
        <button type="submit" className="portal-btn portal-btn-primary">Apply</button>
        <Link href="/portal/banking/reconcile" className="portal-btn">Clear</Link>
      </FilterBar>

      <Suspense fallback={<div className="portal-empty">Loading…</div>}>
        <ReconcileClient unmatched={d.unmatched} />
      </Suspense>
    </div>
  );
}
