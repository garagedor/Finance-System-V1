import Link from "next/link";
import { readSession, hasPermission } from "@/lib/rbac";
import { isStatsXlsxOwner } from "@/lib/stats-owner";
import { loadPayoutRecon } from "@/lib/scanpay/payout-recon";
import { GRACE_DAYS } from "@/lib/scanpay/payout-bank-match";
import type { ScanpayPayoutRecord } from "@/lib/scanpay/payouts";
import { fmt$, fmtDate, fmtDateTime, lastNDays } from "../../format";
import { PageHeader, StatPill, FilterBar, FilterField, CardShell, Empty } from "../../_components/page-helpers";
import BankingTabs from "../BankingTabs";
import { teamLabeler } from "@/lib/scanpay/team-names-server";
import SyncPayoutsButton from "./SyncPayoutsButton";

export const dynamic = "force-dynamic";

// Did every ScanPay payout reach the bank? Pairs each payout with a
// "SCANPAY USA" deposit (Plaid) by exact amount around the expected date.

interface SP { from?: string; to?: string }

export default async function ScanpayPayoutsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await readSession();
  if (!s || !(s.type === "admin" || hasPermission(s, "finance:banking:view"))) {
    return <div className="portal-page"><div className="portal-alert portal-alert-error">Restricted.</div></div>;
  }
  const sp = await searchParams;
  const def = lastNDays(60);
  const d = await loadPayoutRecon({ from: sp.from ?? def.from, to: sp.to ?? def.to });
  const byId = new Map(d.payouts.map((p) => [p._id, p]));
  const depById = new Map(d.deposits.map((x) => [x.id, x]));
  const team = await teamLabeler();

  const PayoutRows = ({ ids }: { ids: string[] }) => (
    <>
      {ids.map((id) => {
        const p = byId.get(id) as ScanpayPayoutRecord;
        return (
          <tr key={id}>
            <td>{fmtDate(p.expectedBy)}</td>
            <td><Link href={`/portal/banking/scanpay-payouts/${encodeURIComponent(id)}`} className="mono">{id}</Link></td>
            <td>{team(p.team)}</td>
            <td>{p.status}</td>
            <td className="right">{p.totals ? fmt$(p.totals.collected) : "—"}</td>
            <td className="right">{p.totals ? fmt$(-p.totals.fees) : "—"}</td>
            <td className="right">{p.totals ? fmt$(p.totals.refunds + p.totals.adjustments + p.totals.other) : "—"}</td>
            <td className="right"><b>{fmt$(p.amount)}</b></td>
          </tr>
        );
      })}
    </>
  );
  const PayoutHead = () => (
    <thead>
      <tr>
        <th>Expected</th><th>Payout</th><th>ScanPay account</th><th>Status</th>
        <th className="right">Payments</th><th className="right">Fees</th><th className="right">Refunds &amp; disputes</th><th className="right">Payout</th>
      </tr>
    </thead>
  );

  return (
    <div className="portal-page">
      <PageHeader
        kicker="System · Banking"
        title="ScanPay payouts"
        subtitle="Every ScanPay payout, matched to its deposit in the bank"
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {isStatsXlsxOwner(s) && <Link href="/portal/scanpay-actions" className="portal-btn">ScanPay actions →</Link>}
            <SyncPayoutsButton />
          </div>
        }
      />
      <BankingTabs active="scanpay-payouts" />

      <section className="portal-grid-4">
        <StatPill label={`Payouts (${d.payouts.length})`} value={fmt$(d.totals.payouts)} />
        <StatPill label={`Reached the bank (${d.result.matched.reduce((n, m) => n + m.payoutIds.length, 0)})`} value={<span className="money-pos">{fmt$(d.totals.matched)}</span>} />
        <StatPill label={`Not found (${d.result.missing.length})`} value={<span className={d.result.missing.length ? "money-neg" : ""}>{fmt$(d.totals.missing)}</span>} />
        <StatPill label={`Not arrived yet (${d.result.pending.length})`} value={fmt$(d.totals.pending)} />
      </section>

      <div className="muted small" style={{ margin: "4px 0 10px" }}>
        Bank data covers <b>{d.bankFrom ? fmtDate(d.bankFrom) : "—"}</b> → <b>{d.bankThrough ? fmtDate(d.bankThrough) : "—"}</b>
        {d.lastBankSync ? <> · last bank sync {fmtDateTime(d.lastBankSync)}</> : null}
        {" "}· a payout counts as missing {GRACE_DAYS} days after its expected date. Sync the bank on Connections to check the newest payouts.
      </div>

      <FilterBar>
        <FilterField label="Expected from">
          <input type="date" name="from" defaultValue={d.range.from} className="portal-input" />
        </FilterField>
        <FilterField label="To">
          <input type="date" name="to" defaultValue={d.range.to} className="portal-input" />
        </FilterField>
        <button type="submit" className="portal-btn portal-btn-primary">Apply</button>
        <Link href="/portal/banking/scanpay-payouts" className="portal-btn">Clear</Link>
      </FilterBar>

      <CardShell title="By ScanPay account and month" subtitle="A whole stretch of 'not found' for one account usually means that account paid out to a bank account the CRM isn't connected to">
        {d.byMonth.length === 0 ? <Empty message="No payouts in this range." /> : (
          <table className="portal-table">
            <thead><tr><th>Month</th><th>ScanPay account</th><th className="right">Payouts</th><th className="right">In the bank</th><th className="right">Not found</th><th className="right">Waiting</th></tr></thead>
            <tbody>
              {d.byMonth.map((r) => (
                <tr key={`${r.month}-${r.team}`}>
                  <td>{r.month}</td>
                  <td>{team(r.team)}</td>
                  <td className="right">{r.payouts}</td>
                  <td className="right">{r.inBank} · {fmt$(r.inBankAmt)}</td>
                  <td className="right"><span className={r.notFound ? "money-neg" : ""}>{r.notFound} · {fmt$(r.notFoundAmt)}</span></td>
                  <td className="right">{r.waiting}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardShell>

      {d.beforeBank.length > 0 && (
        <div className="muted small" style={{ margin: "8px 0" }}>
          {d.beforeBank.length} payout{d.beforeBank.length === 1 ? "" : "s"} ({fmt$(d.totals.beforeBank)}) were expected before the bank data starts, so they can&apos;t be checked.
        </div>
      )}

      <CardShell title={`Not found in the bank (${d.result.missing.length})`} subtitle="Paid out by ScanPay, but no deposit for this amount within the expected window in any connected account">
        {d.result.missing.length === 0 ? <Empty message="Every finished payout in this range reached the bank." /> : (
          <table className="portal-table"><PayoutHead /><tbody><PayoutRows ids={d.result.missing.map((p) => p.id)} /></tbody></table>
        )}
      </CardShell>

      <CardShell title={`ScanPay deposits no payout explains (${d.result.unexplained.length})`} subtitle={`Total ${fmt$(d.totals.unexplained)} — often a payout outside the date range, or several payouts combined differently`}>
        {d.result.unexplained.length === 0 ? <Empty message="None." /> : (
          <table className="portal-table">
            <thead><tr><th>Date</th><th>Account</th><th className="right">Amount</th></tr></thead>
            <tbody>
              {d.result.unexplained.map((x) => (
                <tr key={x.id}><td>{fmtDate(x.date)}</td><td>{x.account}</td><td className="right">{fmt$(x.amount)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </CardShell>

      <CardShell title={`Not arrived yet (${d.result.pending.length})`} subtitle="In transit, or still inside the expected window">
        {d.result.pending.length === 0 ? <Empty message="None." /> : (
          <table className="portal-table"><PayoutHead /><tbody><PayoutRows ids={d.result.pending.map((p) => p.id)} /></tbody></table>
        )}
      </CardShell>

      <CardShell title={`Reached the bank (${d.result.matched.length} deposits)`}>
        {d.result.matched.length === 0 ? <Empty message="No matches in this range yet." /> : (
          <table className="portal-table">
            <thead><tr><th>Deposit</th><th>Account</th><th className="right">Deposit</th><th>Payout(s)</th><th>Expected</th><th className="right">Days</th></tr></thead>
            <tbody>
              {d.result.matched.map((m) => {
                const dep = depById.get(m.depositId)!;
                const ps = m.payoutIds.map((id) => byId.get(id)!);
                return (
                  <tr key={m.depositId}>
                    <td>{fmtDate(dep.date)}</td>
                    <td>{dep.account}</td>
                    <td className="right">{fmt$(dep.amount)}</td>
                    <td>
                      {ps.map((p, i) => (
                        <span key={p._id}>{i ? ", " : ""}<Link href={`/portal/banking/scanpay-payouts/${encodeURIComponent(p._id)}`} className="mono">{p._id}</Link> ({team(p.team)}{ps.length > 1 ? ` · ${fmt$(p.amount)}` : ""})</span>
                      ))}
                    </td>
                    <td>{fmtDate(ps[0].expectedBy)}</td>
                    <td className="right">{m.dayDiff > 0 ? `+${m.dayDiff}` : m.dayDiff}</td>
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
