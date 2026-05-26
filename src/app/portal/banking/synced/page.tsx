import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import type {
  BankAccountSyncedRecord,
  BankTransactionSyncedRecord,
} from "@/types/finance-plaid";
import type { Filter } from "mongodb";
import { fmt$, fmtDate, lastNDays } from "../../format";
import { PageHeader, StatPill, FilterBar, FilterField, CardShell, Empty, StatusPill } from "../../_components/page-helpers";
import BankingTabs from "../BankingTabs";
import SyncButton from "../SyncButton";

export const dynamic = "force-dynamic";

interface SP {
  from?: string;
  to?: string;
  account_id?: string;
  direction?: string;
  recon?: string;
  pending?: string;
  q?: string;
  page?: string;
}

const PAGE_SIZE = 100;

async function load(sp: SP) {
  await ensureFinanceIndexes();
  const range = {
    from: sp.from ?? lastNDays(30).from,
    to: sp.to ?? lastNDays(30).to,
  };
  const filter: Filter<BankTransactionSyncedRecord> = {
    date: { $gte: range.from, $lte: range.to },
  };
  if (sp.account_id) filter.account_id = sp.account_id;
  if (sp.direction === "in" || sp.direction === "out") filter.direction = sp.direction;
  if (sp.recon === "unmatched" || sp.recon === "matched" || sp.recon === "ignored" || sp.recon === "pending_review") {
    filter.recon_status = sp.recon;
  }
  if (sp.pending === "1") filter.pending = true;
  if (sp.pending === "0") filter.pending = false;
  if (sp.q) {
    filter.$or = [
      { description: { $regex: sp.q, $options: "i" } },
      { merchant_name: { $regex: sp.q, $options: "i" } },
    ];
  }

  const page = Math.max(1, Number(sp.page) || 1);
  const [accounts, rows, total] = await Promise.all([
    coll<BankAccountSyncedRecord>(FINANCE_COLLECTIONS.bankAccountSynced).find({ active: true }).toArray(),
    coll<BankTransactionSyncedRecord>(FINANCE_COLLECTIONS.bankTxnSynced)
      .find(filter)
      .sort({ date: -1, _id: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .toArray(),
    coll<BankTransactionSyncedRecord>(FINANCE_COLLECTIONS.bankTxnSynced).countDocuments(filter),
  ]);
  const inflow = rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const outflow = rows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0);
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
          <select name="account_id" defaultValue={sp.account_id ?? ""} className="portal-select">
            <option value="">All</option>
            {d.accounts.map((a) => (
              <option key={a.account_id} value={a.account_id}>
                {a.name} {a.mask ? `··${a.mask}` : ""}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Direction">
          <select name="direction" defaultValue={sp.direction ?? ""} className="portal-select">
            <option value="">Both</option>
            <option value="in">Money in</option>
            <option value="out">Money out</option>
          </select>
        </FilterField>
        <FilterField label="Reconciliation">
          <select name="recon" defaultValue={sp.recon ?? ""} className="portal-select">
            <option value="">All</option>
            <option value="unmatched">Unmatched</option>
            <option value="matched">Matched</option>
            <option value="ignored">Ignored</option>
          </select>
        </FilterField>
        <FilterField label="Pending?">
          <select name="pending" defaultValue={sp.pending ?? ""} className="portal-select">
            <option value="">Any</option>
            <option value="1">Pending</option>
            <option value="0">Posted</option>
          </select>
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
          <table className="portal-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Account</th>
                <th>Category</th>
                <th>Channel</th>
                <th>Status</th>
                <th>Recon</th>
                <th className="right">Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => {
                const acct = d.accounts.find((a) => a.account_id === r.account_id);
                return (
                  <tr key={r._id}>
                    <td className="small mono">{fmtDate(r.date)}</td>
                    <td>
                      <strong>{r.description}</strong>
                      {r.merchant_name && r.merchant_name !== r.description && (
                        <div className="muted small">{r.merchant_name}</div>
                      )}
                    </td>
                    <td className="muted small">
                      {acct?.name ?? "—"} {acct?.mask ? `··${acct.mask}` : ""}
                    </td>
                    <td className="muted small">{r.category ?? "—"}</td>
                    <td className="muted small">{r.payment_channel ?? r.payment_method ?? "—"}</td>
                    <td>
                      {r.pending ? (
                        <span className="pill pill-pending">pending</span>
                      ) : (
                        <span className="pill pill-closed">posted</span>
                      )}
                    </td>
                    <td>
                      <span className={`pill ${
                        r.recon_status === "matched" ? "pill-paid" :
                        r.recon_status === "ignored" ? "pill-draft" :
                        "pill-open"
                      }`}>{r.recon_status}</span>
                    </td>
                    <td className={`right money ${r.amount >= 0 ? "money-pos" : "money-neg"}`} style={{ fontWeight: 600 }}>
                      {r.amount >= 0 ? "+" : "−"}{fmt$(Math.abs(r.amount))}
                    </td>
                    <td className="right">
                      {r.recon_status === "unmatched" && (
                        <Link href={`/portal/banking/reconcile?txn=${r._id}`}
                          className="portal-btn" style={{ padding: "4px 10px", fontSize: 11 }}>
                          Match…
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardShell>
    </div>
  );
}
