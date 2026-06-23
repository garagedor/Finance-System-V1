import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import type {
  BankAccountSyncedRecord,
  BankTransactionSyncedRecord,
} from "@/types/finance-plaid";
import type { Filter } from "mongodb";
import { fmt$, lastNDays } from "../../format";
import { PageHeader, StatPill, FilterBar, FilterField, CardShell, Empty, StatusPill } from "../../_components/page-helpers";
import { PortalMultiFilter } from "../../_components/PortalMultiFilter";
import BankingTabs from "../BankingTabs";
import SyncButton from "../SyncButton";
import SyncedTxnsTable, { type SlimTxn, type SlimAccount } from "./SyncedTxnsTable";

export const dynamic = "force-dynamic";

interface SP {
  from?: string;
  to?: string;
  // Multi-value filters arrive as string[] via URLSearchParams.getAll().
  // Next's resolved searchParams type uses `string | string[]` for any key
  // that appears more than once in the URL.
  account_id?: string | string[];
  direction?: string | string[];
  recon?: string | string[];
  pending?: string | string[];
  q?: string;
  page?: string;
}

const asArray = (v: string | string[] | undefined): string[] => {
  if (!v) return [];
  return Array.isArray(v) ? v.filter(Boolean) : [v].filter(Boolean);
};

const PAGE_SIZE = 100;

async function load(sp: SP) {
  await ensureFinanceIndexes();
  const range = {
    from: sp.from ?? lastNDays(30).from,
    to: sp.to ?? lastNDays(30).to,
  };
  const accountIds = asArray(sp.account_id);
  const directions = asArray(sp.direction).filter((d) => d === "in" || d === "out");
  const recons = asArray(sp.recon).filter((r) =>
    r === "unmatched" || r === "matched" || r === "ignored" || r === "pending_review",
  );
  const pendings = asArray(sp.pending).filter((p) => p === "0" || p === "1");

  const filter: Filter<BankTransactionSyncedRecord> = {
    date: { $gte: range.from, $lte: range.to },
  };
  if (accountIds.length > 0) filter.account_id = { $in: accountIds } as any;
  if (directions.length > 0) filter.direction = { $in: directions } as any;
  if (recons.length > 0) filter.recon_status = { $in: recons } as any;
  if (pendings.length === 1) filter.pending = pendings[0] === "1";
  // pendings.length === 2 → both Pending and Posted → no filter applied
  if (sp.q) {
    filter.$or = [
      { description: { $regex: sp.q, $options: "i" } },
      { merchant_name: { $regex: sp.q, $options: "i" } },
    ];
  }

  const page = Math.max(1, Number(sp.page) || 1);
  // Aggregate the inflow / outflow across the FULL filtered set, not just the
  // current page. Using $cond instead of two separate $match passes so the
  // collection is scanned once.
  const aggPipeline = [
    { $match: filter },
    {
      $group: {
        _id: null,
        inflow: { $sum: { $cond: [{ $gt: ["$amount", 0] }, "$amount", 0] } },
        outflow: { $sum: { $cond: [{ $lt: ["$amount", 0] }, "$amount", 0] } },
        total: { $sum: 1 },
      },
    },
  ];
  const [accounts, rows, aggResult] = await Promise.all([
    coll<BankAccountSyncedRecord>(FINANCE_COLLECTIONS.bankAccountSynced).find({ active: true }).toArray(),
    coll<BankTransactionSyncedRecord>(FINANCE_COLLECTIONS.bankTxnSynced)
      .find(filter)
      .sort({ date: -1, _id: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .toArray(),
    coll<BankTransactionSyncedRecord>(FINANCE_COLLECTIONS.bankTxnSynced).aggregate(aggPipeline).toArray(),
  ]);
  const agg = aggResult[0] as { inflow?: number; outflow?: number; total?: number } | undefined;
  const inflow = agg?.inflow ?? 0;
  const outflow = agg?.outflow ?? 0;
  const total = agg?.total ?? 0;
  return { range, accounts, rows, total, page, inflow, outflow };
}

export default async function SyncedTxnsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const d = await load(sp);
  const totalPages = Math.max(1, Math.ceil(d.total / PAGE_SIZE));

  // Slim the rows before handing them to the client component — the raw Plaid
  // payload on each record is large and not needed for the table/calculator.
  const slimRows: SlimTxn[] = d.rows.map((r) => ({
    _id: r._id,
    date: r.date,
    description: r.description,
    merchant_name: r.merchant_name ?? null,
    account_id: r.account_id,
    category: r.category ?? null,
    payment_channel: r.payment_channel ?? null,
    payment_method: r.payment_method ?? null,
    pending: Boolean(r.pending),
    recon_status: r.recon_status,
    amount: r.amount,
  }));
  const slimAccounts: SlimAccount[] = d.accounts.map((a) => ({
    account_id: a.account_id,
    name: a.name,
    mask: a.mask ?? null,
  }));

  return (
    <div className="portal-page">
      <PageHeader
        kicker="System · Banking"
        title="Bank Transactions"
        subtitle="Live from Plaid · read-only · use Reconciliation to link to expenses/payouts"
        actions={<SyncButton />}
      />

      <BankingTabs active="synced" />

      <section className="portal-grid-4">
        <StatPill label="Transactions (window)" value={d.total.toLocaleString()} />
        <StatPill label="Money in" value={<span className="money-pos">+{fmt$(d.inflow)}</span>} />
        <StatPill label="Money out" value={<span className="money-neg">{fmt$(d.outflow)}</span>} />
        <StatPill label="Net flow" value={fmt$(d.inflow + d.outflow)} />
      </section>

      <FilterBar>
        <FilterField label="From">
          <input type="date" name="from" defaultValue={d.range.from} className="portal-input" />
        </FilterField>
        <FilterField label="To">
          <input type="date" name="to" defaultValue={d.range.to} className="portal-input" />
        </FilterField>
        <FilterField label="Account">
          <PortalMultiFilter
            name="account_id"
            defaultSelected={asArray(sp.account_id)}
            options={d.accounts.map((a) => ({
              value: a.account_id,
              label: `${a.name}${a.mask ? ` ··${a.mask}` : ""}`,
            }))}
            placeholder="All accounts"
            allLabel="All accounts"
          />
        </FilterField>
        <FilterField label="Direction">
          <PortalMultiFilter
            name="direction"
            defaultSelected={asArray(sp.direction)}
            options={[
              { value: "in", label: "Money in" },
              { value: "out", label: "Money out" },
            ]}
            placeholder="Both"
            allLabel="Both"
          />
        </FilterField>
        <FilterField label="Reconciliation">
          <PortalMultiFilter
            name="recon"
            defaultSelected={asArray(sp.recon)}
            options={[
              { value: "unmatched", label: "Unmatched" },
              { value: "matched", label: "Matched" },
              { value: "ignored", label: "Ignored" },
              { value: "pending_review", label: "Pending review" },
            ]}
            placeholder="All"
            allLabel="All"
          />
        </FilterField>
        <FilterField label="Pending?">
          <PortalMultiFilter
            name="pending"
            defaultSelected={asArray(sp.pending)}
            options={[
              { value: "1", label: "Pending" },
              { value: "0", label: "Posted" },
            ]}
            placeholder="Any"
            allLabel="Any"
          />
        </FilterField>
        <FilterField label="Search">
          <input type="text" name="q" defaultValue={sp.q ?? ""} className="portal-input" placeholder="Merchant…" />
        </FilterField>
        <button type="submit" className="portal-btn portal-btn-primary">Apply</button>
        <Link href="/portal/banking/synced" className="portal-btn">Clear</Link>
      </FilterBar>

      <CardShell title="Bank transactions" subtitle={`${d.total.toLocaleString()} match · page ${d.page} of ${totalPages}`}>
        {d.rows.length === 0 ? (
          <Empty
            message={d.accounts.length === 0
              ? "No bank connections yet — link your first bank in Connections."
              : "No transactions match these filters."}
            action={d.accounts.length === 0 ? (
              <Link href="/portal/banking/connections" className="portal-btn portal-btn-primary">
                Connect a bank →
              </Link>
            ) : undefined}
          />
        ) : (
          <SyncedTxnsTable
            rows={slimRows}
            accounts={slimAccounts}
            windowTotals={{ inflow: d.inflow, outflow: d.outflow, total: d.total }}
          />
        )}
      </CardShell>
    </div>
  );
}
