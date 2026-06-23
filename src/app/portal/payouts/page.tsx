import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import type { FollowUpCommission, PayoutProfile, PayoutRecord } from "@/types/finance";
import { fmt$, fmtDate } from "../format";
import { PageHeader, StatPill, FilterBar, FilterField, CardShell, Empty, StatusPill } from "../_components/page-helpers";
import RowActions from "../_components/RowActions";
import NewPayoutForm from "./NewPayoutForm";
import NewFollowUpForm from "./NewFollowUpForm";

export const dynamic = "force-dynamic";

interface SP {
  status?: string;
  recipient?: string;
  tab?: "payouts" | "followups";
}

async function load(sp: SP) {
  await ensureFinanceIndexes();
  const filter: Record<string, unknown> = {};
  if (sp.status === "paid" || sp.status === "unpaid") filter.status = sp.status;
  if (sp.recipient) filter.recipient_name = { $regex: sp.recipient, $options: "i" };

  const [payouts, followups, profiles] = await Promise.all([
    coll<PayoutRecord>(FINANCE_COLLECTIONS.payout).find(filter).sort({ period_end: -1 }).limit(200).toArray(),
    coll<FollowUpCommission>(FINANCE_COLLECTIONS.followUpComm).find({}).sort({ created_at: -1 }).limit(200).toArray(),
    coll<PayoutProfile>(FINANCE_COLLECTIONS.payoutProfile).find({ active: true }).toArray(),
  ]);

  const totalNet = payouts.reduce((s, p) => s + p.net, 0);
  const unpaidNet = payouts.filter((p) => p.status === "unpaid").reduce((s, p) => s + p.net, 0);
  const followupTotal = followups.reduce((s, f) => s + f.computed_amount, 0);
  const unattachedFollowups = followups.filter((f) => !f.paid_via_payout_id);
  const unattachedTotal = unattachedFollowups.reduce((s, f) => s + f.computed_amount, 0);

  return { payouts, followups, profiles, totalNet, unpaidNet, followupTotal, unattachedFollowups, unattachedTotal };
}

export default async function PayoutsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const d = await load(sp);
  const tab = sp.tab ?? "payouts";

  return (
    <div className="portal-page">
      <PageHeader
        kicker="Money"
        title="Payouts"
        subtitle="Salaries, commissions, bonuses, deductions — managed per-person per-period."
        actions={
          <>
            <NewFollowUpForm />
            <NewPayoutForm profiles={d.profiles} />
          </>
        }
      />

      <section className="portal-grid-4">
        <StatPill label="Total payouts" value={fmt$(d.totalNet)} />
        <StatPill label="Unpaid" value={<span className="money-neg">{fmt$(d.unpaidNet)}</span>} />
        <StatPill label="Follow-up commissions" value={fmt$(d.followupTotal)} />
        <StatPill label="Unattached follow-ups" value={fmt$(d.unattachedTotal)} />
      </section>

      <div style={{ display: "flex", gap: 4 }}>
        <Link
          href="/portal/payouts?tab=payouts"
          className={`portal-range-pill ${tab === "payouts" ? "active" : ""}`}
        >
          Payouts ({d.payouts.length})
        </Link>
        <Link
          href="/portal/payouts?tab=followups"
          className={`portal-range-pill ${tab === "followups" ? "active" : ""}`}
        >
          Follow-up commissions ({d.followups.length})
        </Link>
      </div>

      {tab === "payouts" ? (
        <>
          <FilterBar>
            <FilterField label="Status">
              <select name="status" defaultValue={sp.status ?? ""} className="portal-select">
                <option value="">All</option>
                <option value="paid">Paid</option>
                <option value="unpaid">Unpaid</option>
              </select>
            </FilterField>
            <FilterField label="Recipient name contains">
              <input type="text" name="recipient" defaultValue={sp.recipient ?? ""} className="portal-input" />
            </FilterField>
            <input type="hidden" name="tab" value="payouts" />
            <button type="submit" className="portal-btn portal-btn-primary">Apply</button>
            <Link href="/portal/payouts" className="portal-btn">Clear</Link>
          </FilterBar>

          <CardShell title="Payouts" subtitle={`${d.payouts.length} records`}>
            {d.payouts.length === 0 ? (
              <Empty
                message="No payouts yet."
                action={<NewPayoutForm profiles={d.profiles} />}
              />
            ) : (
              <table className="portal-table">
                <thead>
                  <tr>
                    <th>Recipient</th>
                    <th>Role</th>
                    <th>Period</th>
                    <th>Lines</th>
                    <th>Status</th>
                    <th className="right">Gross</th>
                    <th className="right">Deductions</th>
                    <th className="right">Net</th>
                    <th className="right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {d.payouts.map((p) => (
                    <tr key={p._id}>
                      <td><strong>{p.recipient_name}</strong></td>
                      <td className="muted small">{p.recipient_role ?? "—"}</td>
                      <td className="muted small mono">
                        {fmtDate(p.period_start)} – {fmtDate(p.period_end)}
                      </td>
                      <td className="muted small">{p.line_items.length}</td>
                      <td><StatusPill status={p.status} /></td>
                      <td className="right money">{fmt$(p.gross)}</td>
                      <td className="right money money-neg">−{fmt$(p.deductions)}</td>
                      <td className="right money" style={{ fontWeight: 700, color: p.net >= 0 ? "#10b981" : "#ef4444" }}>
                        {fmt$(p.net)}
                      </td>
                      <td className="right">
                        <RowActions
                          endpoint="/api/portal/payouts"
                          id={p._id}
                          currentStatus={p.status}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardShell>
        </>
      ) : (
        <CardShell title="Follow-up commissions" subtitle={`${d.followups.length} records · ${fmt$(d.followupTotal)} total`}>
          {d.followups.length === 0 ? (
            <Empty
              message="No follow-up commissions logged."
              action={<NewFollowUpForm />}
            />
          ) : (
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Job</th>
                  <th>Job details</th>
                  <th>Recipient</th>
                  <th>Kind</th>
                  <th className="right">Amount</th>
                  <th>Attached to</th>
                  <th className="right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {d.followups.map((f) => (
                  <tr key={f._id}>
                    <td className="small mono">{fmtDate(f.created_at)}</td>
                    <td className="small mono">{f.job_id.slice(0, 10)}</td>
                    <td className="small muted">
                      {f.job_snapshot.tech ?? "?"} · {f.job_snapshot.area ?? "?"}<br />
                      {f.job_snapshot.customer ?? "—"}
                    </td>
                    <td>
                      <strong>{f.recipient_name}</strong>
                      <div className="muted small">{f.recipient_role ?? "—"}</div>
                    </td>
                    <td className="small">
                      {f.kind}
                      {f.kind === "percent" && f.rate ? ` (${(f.rate * 100).toFixed(1)}%)` : ""}
                    </td>
                    <td className="right money money-pos">+{fmt$(f.computed_amount)}</td>
                    <td className="small muted">
                      {f.paid_via_payout_id ? (
                        <span className="pill pill-paid">In payout</span>
                      ) : (
                        <span className="pill pill-pending">Unattached</span>
                      )}
                    </td>
                    <td className="right">
                      <RowActions
                        endpoint="/api/portal/followup-commissions"
                        id={f._id}
                        canToggleStatus={false}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardShell>
      )}
    </div>
  );
}
