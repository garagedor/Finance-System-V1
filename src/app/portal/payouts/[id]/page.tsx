import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import { readSession, hasPermission } from "@/lib/rbac";
import type { PayoutProfile, PayoutRecord } from "@/types/finance";
import type { LedgerRecord } from "@/types/finance-ledger";
import { fmt$, fmtDate } from "../../format";
import { PageHeader, StatPill, CardShell, Empty, BackLink, StatusPill } from "../../_components/page-helpers";
import PayoutActions from "../PayoutActions";
import type { PayoutLedgerOption } from "../NewPayoutForm";

export const dynamic = "force-dynamic";

export default async function PayoutDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await readSession();
  if (!hasPermission(session, "finance:payouts:view")) {
    return (
      <div className="portal-page">
        <PageHeader kicker="Money" title="Payout" />
        <CardShell title="No access"><Empty message="You don't have permission to view payouts." /></CardShell>
      </div>
    );
  }
  await ensureFinanceIndexes();
  const payout = await coll<PayoutRecord>(FINANCE_COLLECTIONS.payout).findOne({ _id: id });
  if (!payout) {
    return (
      <div className="portal-page">
        <PageHeader kicker="Money" title="Payout not found" subtitle={<BackLink href="/portal/payouts" label="Back to payouts" />} />
      </div>
    );
  }
  const [profiles, ledgers] = await Promise.all([
    coll<PayoutProfile>(FINANCE_COLLECTIONS.payoutProfile).find({ active: true }).toArray(),
    coll<LedgerRecord>(FINANCE_COLLECTIONS.ledger).find({ status: { $ne: "archived" } }).sort({ holder_name: 1 }).toArray(),
  ]);
  const ledgerOpts: PayoutLedgerOption[] = ledgers.map((l) => ({ _id: l._id, holder_name: l.holder_name, role: l.role, location: l.location }));
  const linkedLedger = payout.ledger_id ? ledgers.find((l) => l._id === payout.ledger_id) : null;

  return (
    <div className="portal-page">
      <PageHeader
        kicker="Money · Payout"
        title={payout.recipient_name + (payout.recipient_role ? ` · ${payout.recipient_role}` : "")}
        subtitle={<BackLink href="/portal/payouts" label="Back to payouts" />}
        actions={<PayoutActions payout={payout} profiles={profiles} ledgers={ledgerOpts} onDeletedHref="/portal/payouts" />}
      />

      <section className="portal-grid-4">
        <StatPill label="Net pay" value={<span className="money" style={{ color: payout.net >= 0 ? "#10b981" : "#ef4444", fontWeight: 700 }}>{fmt$(payout.net)}</span>} />
        <StatPill label="Status" value={<StatusPill status={payout.status} />} />
        <StatPill label="Period" value={`${fmtDate(payout.period_start)} – ${fmtDate(payout.period_end)}`} />
        <StatPill label="Payment method" value={payout.payment_method || "—"} />
        <StatPill label="Ledger" value={linkedLedger ? linkedLedger.holder_name : "—"} />
        <StatPill label="Paid on" value={payout.paid_at ? fmtDate(payout.paid_at) : "—"} />
        <StatPill label="Gross" value={fmt$(payout.gross)} />
        <StatPill label="Deductions" value={<span className="money-neg">−{fmt$(payout.deductions)}</span>} />
      </section>

      {payout.status === "paid" && payout.ledger_entry_id && linkedLedger && (
        <div className="portal-alert" style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)" }}>
          <span>✓</span>
          <div className="small">
            A payment of <strong>{fmt$(payout.net)}</strong> is posted to{" "}
            <Link href={`/portal/ledger/${linkedLedger._id}`} style={{ color: "#818cf8", textDecoration: "none" }}>{linkedLedger.holder_name}&apos;s ledger</Link>.
          </div>
        </div>
      )}

      <CardShell title="Line items" subtitle={`${payout.line_items.length} line${payout.line_items.length === 1 ? "" : "s"}`}>
        <table className="portal-table">
          <thead><tr><th>Kind</th><th>Label</th><th className="right">Amount</th></tr></thead>
          <tbody>
            {payout.line_items.map((it) => (
              <tr key={it.id}>
                <td className="small">{it.kind}</td>
                <td>{it.label}{it.notes && <div className="muted small">{it.notes}</div>}</td>
                <td className={`right money ${it.amount < 0 ? "money-neg" : "money-pos"}`}>{fmt$(it.amount, { showSign: true })}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={2} className="right"><strong>Net</strong></td><td className="right money"><strong>{fmt$(payout.net)}</strong></td></tr>
          </tfoot>
        </table>
      </CardShell>

      {payout.notes && <CardShell title="Notes"><div style={{ padding: 16 }} className="muted">{payout.notes}</div></CardShell>}

      <p className="muted small">
        <a href={`/payout-statement/${payout._id}`} target="_blank" rel="noopener noreferrer" style={{ color: "#818cf8" }}>Open printable statement (PDF) →</a>
      </p>
    </div>
  );
}
