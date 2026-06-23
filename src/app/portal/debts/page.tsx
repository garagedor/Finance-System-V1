import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import type { DebtRecord } from "@/types/finance";
import { fmt$, fmtDate } from "../format";
import { PageHeader, StatPill, FilterBar, FilterField, CardShell, Empty, StatusPill } from "../_components/page-helpers";
import EntryFormModal, { type FieldDef } from "../_components/EntryFormModal";
import RowActions from "../_components/RowActions";

export const dynamic = "force-dynamic";

interface SP {
  status?: string;
  party?: string;
}

const DEBT_FIELDS: FieldDef[] = [
  { name: "from_party_name", label: "Who owes (from)", kind: "text", required: true, width: "half",
    placeholder: "Person or company name" },
  { name: "to_party_name", label: "Who is owed (to)", kind: "text", required: true, width: "half",
    placeholder: "Person or company name" },
  { name: "from_party_role", label: "From role", kind: "text", width: "half" },
  { name: "to_party_role", label: "To role", kind: "text", width: "half" },
  { name: "amount", label: "Amount (USD)", kind: "money", required: true, width: "half" },
  { name: "due_date", label: "Due date", kind: "date", width: "half" },
  { name: "reason", label: "Reason", kind: "text", required: true,
    placeholder: "Why this debt exists" },
  { name: "related_job_id", label: "Related Job ID", kind: "text", width: "half" },
  { name: "related_expense_id", label: "Related Expense ID", kind: "text", width: "half" },
  { name: "deduct_from_payout", label: "Deduct from next payout?", kind: "boolean", width: "half",
    help: "If yes, this debt will surface as a payout deduction." },
  { name: "status", label: "Status", kind: "select", required: true, width: "half",
    options: [
      { value: "open", label: "Open" },
      { value: "settled", label: "Settled" },
      { value: "deducted", label: "Deducted from payout" },
    ],
    defaultValue: "open" },
  { name: "notes", label: "Notes", kind: "textarea" },
];

async function load(sp: SP) {
  await ensureFinanceIndexes();
  const filter: Record<string, unknown> = {};
  if (sp.status) filter.status = sp.status;
  if (sp.party)
    Object.assign(filter, {
      $or: [
        { from_party_name: { $regex: sp.party, $options: "i" } },
        { to_party_name: { $regex: sp.party, $options: "i" } },
      ],
    });

  const rows = await coll<DebtRecord>(FINANCE_COLLECTIONS.debt)
    .find(filter)
    .sort({ created_at: -1 })
    .limit(300)
    .toArray();
  const totalOpen = rows.filter((r) => r.status === "open").reduce((s, r) => s + r.amount, 0);
  const totalSettled = rows.filter((r) => r.status !== "open").reduce((s, r) => s + r.amount, 0);
  return { rows, totalOpen, totalSettled };
}

export default async function DebtsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const d = await load(sp);

  return (
    <div className="portal-page">
      <PageHeader
        kicker="Tracking"
        title="Debts & Balances"
        subtitle="Who owes who — across techs, area managers, providers, vendors, employees."
        actions={
          <EntryFormModal
            endpoint="/api/portal/debts"
            title="Debt entry"
            fields={DEBT_FIELDS}
            triggerLabel="+ Record debt"
            primary
          />
        }
      />

      <section className="portal-grid-3">
        <StatPill label="Open debts" value={d.rows.filter((r) => r.status === "open").length.toLocaleString()} />
        <StatPill label="Open amount" value={<span className="money-neg">{fmt$(d.totalOpen)}</span>} />
        <StatPill label="Settled / deducted" value={fmt$(d.totalSettled)} />
      </section>

      <FilterBar>
        <FilterField label="Status">
          <select name="status" defaultValue={sp.status ?? ""} className="portal-select">
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="settled">Settled</option>
            <option value="deducted">Deducted</option>
          </select>
        </FilterField>
        <FilterField label="Party contains">
          <input type="text" name="party" defaultValue={sp.party ?? ""} className="portal-input" />
        </FilterField>
        <button type="submit" className="portal-btn portal-btn-primary">Apply</button>
        <Link href="/portal/debts" className="portal-btn">Clear</Link>
      </FilterBar>

      <CardShell title="Debt ledger" subtitle={`${d.rows.length} entries`}>
        {d.rows.length === 0 ? (
          <Empty
            message="No debts recorded."
            action={
              <EntryFormModal
                endpoint="/api/portal/debts"
                title="Debt entry"
                fields={DEBT_FIELDS}
                triggerLabel="+ Record first debt"
              />
            }
          />
        ) : (
          <table className="portal-table">
            <thead>
              <tr>
                <th>Created</th>
                <th>From (owes)</th>
                <th>To (owed)</th>
                <th>Reason</th>
                <th>Due</th>
                <th>Status</th>
                <th>Deduct?</th>
                <th className="right">Amount</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r._id}>
                  <td className="small mono">{fmtDate(r.created_at)}</td>
                  <td>
                    <strong>{r.from_party_name}</strong>
                    <div className="muted small">{r.from_party_role ?? "—"}</div>
                  </td>
                  <td>
                    <strong>{r.to_party_name}</strong>
                    <div className="muted small">{r.to_party_role ?? "—"}</div>
                  </td>
                  <td className="small">{r.reason ?? "—"}</td>
                  <td className="small mono">{r.due_date ? fmtDate(r.due_date) : "—"}</td>
                  <td><StatusPill status={r.status} /></td>
                  <td className="small">{r.deduct_from_payout ? "Yes" : "—"}</td>
                  <td className="right money money-neg" style={{ fontWeight: 600 }}>−{fmt$(r.amount)}</td>
                  <td className="right">
                    <RowActions endpoint="/api/portal/debts" id={r._id} canToggleStatus={false} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardShell>
    </div>
  );
}
