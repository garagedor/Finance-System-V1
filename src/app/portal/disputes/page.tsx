import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import type { DisputeRecord, RefundRecord } from "@/types/finance";
import { fmt$, fmtDate, lastNDays } from "../format";
import { PageHeader, StatPill, FilterBar, FilterField, CardShell, Empty, StatusPill } from "../_components/page-helpers";
import EntryFormModal, { type FieldDef } from "../_components/EntryFormModal";
import RowActions from "../_components/RowActions";

export const dynamic = "force-dynamic";

interface SP {
  tab?: "disputes" | "refunds";
  from?: string;
  to?: string;
  status?: string;
}

const SHARED_FIELDS: FieldDef[] = [
  { name: "date", label: "Date", kind: "date", required: true, width: "half",
    defaultValue: new Date().toISOString().slice(0, 10) },
  { name: "customer_name", label: "Customer", kind: "text", width: "half" },
  { name: "address", label: "Address", kind: "text" },
  { name: "job_id", label: "Related CRM Job ID", kind: "text", width: "half" },
  { name: "tech_name", label: "Technician", kind: "text", width: "half" },
  { name: "area", label: "Area / Location", kind: "text", width: "half" },
  { name: "provider_name", label: "Provider", kind: "text", width: "half" },
];

const DISPUTE_FIELDS: FieldDef[] = [
  ...SHARED_FIELDS,
  { name: "amount_disputed", label: "Amount disputed", kind: "money", required: true, width: "half" },
  { name: "amount_recovered", label: "Amount recovered", kind: "money", width: "half",
    defaultValue: 0, help: "Update over time as money is recovered." },
  {
    name: "status", label: "Status", kind: "select", required: true,
    options: [
      { value: "open", label: "Open" },
      { value: "won", label: "Won" },
      { value: "lost", label: "Lost" },
      { value: "partial", label: "Partial" },
    ],
    defaultValue: "open",
  },
  { name: "notes", label: "Notes", kind: "textarea" },
];

const REFUND_FIELDS: FieldDef[] = [
  ...SHARED_FIELDS,
  { name: "amount", label: "Refund amount", kind: "money", required: true, width: "half" },
  { name: "reason", label: "Reason", kind: "text", required: true, width: "half" },
  {
    name: "status", label: "Status", kind: "select", required: true,
    options: [
      { value: "unpaid", label: "Unpaid (pending)" },
      { value: "paid", label: "Paid (refund issued)" },
    ],
    defaultValue: "unpaid",
  },
  { name: "notes", label: "Notes", kind: "textarea" },
];

async function load(sp: SP) {
  await ensureFinanceIndexes();
  const range = {
    from: sp.from ?? lastNDays(90).from,
    to: sp.to ?? lastNDays(90).to,
  };
  const baseFilter: Record<string, unknown> = { date: { $gte: range.from, $lte: range.to } };
  const disputeFilter = { ...baseFilter };
  if (sp.status && ["open", "won", "lost", "partial"].includes(sp.status))
    Object.assign(disputeFilter, { status: sp.status });

  const [disputes, refunds] = await Promise.all([
    coll<DisputeRecord>(FINANCE_COLLECTIONS.dispute).find(disputeFilter).sort({ date: -1 }).toArray(),
    coll<RefundRecord>(FINANCE_COLLECTIONS.refund).find(baseFilter).sort({ date: -1 }).toArray(),
  ]);

  const openDisputes = disputes.filter((d) => d.status === "open" || d.status === "partial");
  const totalDisputed = disputes.reduce((s, d) => s + d.amount_disputed, 0);
  const totalRecovered = disputes.reduce((s, d) => s + (d.amount_recovered ?? 0), 0);
  const stillOpen = totalDisputed - totalRecovered;
  const totalRefunded = refunds.reduce((s, r) => s + r.amount, 0);
  const unpaidRefunds = refunds.filter((r) => r.status === "unpaid").reduce((s, r) => s + r.amount, 0);

  return { range, disputes, refunds, openDisputes, totalDisputed, totalRecovered, stillOpen, totalRefunded, unpaidRefunds };
}

export default async function DisputesPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const d = await load(sp);
  const tab = sp.tab ?? "disputes";

  return (
    <div className="portal-page">
      <PageHeader
        kicker="Tracking"
        title="Disputes & Refunds"
        subtitle="Manual entry — replaces the Excel tracking workflow. Later: connect to Stripe/Bank."
        actions={
          <>
            <EntryFormModal
              endpoint="/api/portal/refunds"
              title="Refund"
              fields={REFUND_FIELDS}
              triggerLabel="+ Refund"
            />
            <EntryFormModal
              endpoint="/api/portal/disputes"
              title="Dispute"
              fields={DISPUTE_FIELDS}
              triggerLabel="+ Dispute"
              primary
            />
          </>
        }
      />

      <section className="portal-grid-4">
        <StatPill label="Open disputes" value={d.openDisputes.length.toLocaleString()} />
        <StatPill label="Disputed (period)" value={<span className="money-neg">{fmt$(d.totalDisputed)}</span>} />
        <StatPill label="Recovered" value={<span className="money-pos">{fmt$(d.totalRecovered)}</span>} />
        <StatPill label="Still open" value={fmt$(d.stillOpen)} />
      </section>

      <div style={{ display: "flex", gap: 4 }}>
        <Link href="/portal/disputes?tab=disputes" className={`portal-range-pill ${tab === "disputes" ? "active" : ""}`}>
          Disputes ({d.disputes.length})
        </Link>
        <Link href="/portal/disputes?tab=refunds" className={`portal-range-pill ${tab === "refunds" ? "active" : ""}`}>
          Refunds ({d.refunds.length})
        </Link>
      </div>

      <FilterBar>
        <FilterField label="From">
          <input type="date" name="from" defaultValue={d.range.from} className="portal-input" />
        </FilterField>
        <FilterField label="To">
          <input type="date" name="to" defaultValue={d.range.to} className="portal-input" />
        </FilterField>
        {tab === "disputes" && (
          <FilterField label="Status">
            <select name="status" defaultValue={sp.status ?? ""} className="portal-select">
              <option value="">All</option>
              <option value="open">Open</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
              <option value="partial">Partial</option>
            </select>
          </FilterField>
        )}
        <input type="hidden" name="tab" value={tab} />
        <button type="submit" className="portal-btn portal-btn-primary">Apply</button>
        <Link href="/portal/disputes" className="portal-btn">Clear</Link>
      </FilterBar>

      {tab === "disputes" ? (
        <CardShell title="Disputes" subtitle={`${d.disputes.length} entries`}>
          {d.disputes.length === 0 ? (
            <Empty
              message="No disputes recorded."
              action={<EntryFormModal endpoint="/api/portal/disputes" title="Dispute" fields={DISPUTE_FIELDS} triggerLabel="+ Add first dispute" />}
            />
          ) : (
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Tech / Area</th>
                  <th>Provider</th>
                  <th>Job</th>
                  <th>Status</th>
                  <th className="right">Disputed</th>
                  <th className="right">Recovered</th>
                  <th className="right">Open</th>
                  <th className="right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {d.disputes.map((r) => (
                  <tr key={r._id}>
                    <td className="small mono">{fmtDate(r.date)}</td>
                    <td>
                      <div>{r.customer_name ?? "—"}</div>
                      {r.address && <div className="muted small">{r.address}</div>}
                    </td>
                    <td className="muted small">
                      {r.tech_name ?? "—"} {r.area ? `· ${r.area}` : ""}
                    </td>
                    <td className="muted small">{r.provider_name ?? "—"}</td>
                    <td className="muted small mono">{r.job_id?.slice(0, 10) ?? "—"}</td>
                    <td><StatusPill status={r.status} /></td>
                    <td className="right money money-neg">−{fmt$(r.amount_disputed)}</td>
                    <td className="right money money-pos">+{fmt$(r.amount_recovered ?? 0)}</td>
                    <td className="right money" style={{ fontWeight: 600 }}>{fmt$(r.amount_open ?? 0)}</td>
                    <td className="right">
                      <RowActions endpoint="/api/portal/disputes" id={r._id} canToggleStatus={false} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardShell>
      ) : (
        <CardShell
          title="Refunds"
          subtitle={`${d.refunds.length} entries · ${fmt$(d.totalRefunded)} total · ${fmt$(d.unpaidRefunds)} unpaid`}
        >
          {d.refunds.length === 0 ? (
            <Empty
              message="No refunds recorded."
              action={<EntryFormModal endpoint="/api/portal/refunds" title="Refund" fields={REFUND_FIELDS} triggerLabel="+ Add first refund" />}
            />
          ) : (
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Tech / Area</th>
                  <th>Reason</th>
                  <th>Job</th>
                  <th>Status</th>
                  <th className="right">Amount</th>
                  <th className="right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {d.refunds.map((r) => (
                  <tr key={r._id}>
                    <td className="small mono">{fmtDate(r.date)}</td>
                    <td>
                      <div>{r.customer_name ?? "—"}</div>
                      {r.address && <div className="muted small">{r.address}</div>}
                    </td>
                    <td className="muted small">
                      {r.tech_name ?? "—"} {r.area ? `· ${r.area}` : ""}
                    </td>
                    <td className="small">{r.reason ?? "—"}</td>
                    <td className="muted small mono">{r.job_id?.slice(0, 10) ?? "—"}</td>
                    <td><StatusPill status={r.status} /></td>
                    <td className="right money money-neg">−{fmt$(r.amount)}</td>
                    <td className="right">
                      <RowActions endpoint="/api/portal/refunds" id={r._id} currentStatus={r.status} />
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
