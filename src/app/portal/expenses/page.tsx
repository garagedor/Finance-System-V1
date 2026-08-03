import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import type { ExpenseRecord } from "@/types/finance";
import { fmt$, fmtDate, lastNDays } from "../format";
import { PageHeader, StatPill, FilterBar, FilterField, CardShell, Empty, StatusPill } from "../_components/page-helpers";
import EntryFormModal, { type FieldDef } from "../_components/EntryFormModal";
import RowActions from "../_components/RowActions";
import LedgerExpenseModal, { type LedgerOption } from "./LedgerExpenseModal";
import type { LedgerRecord } from "@/types/finance-ledger";

const LEDGER_EXPENSE_ENDPOINT = "/api/portal/expenses/from-ledger";

export const dynamic = "force-dynamic";

interface SP {
  from?: string;
  to?: string;
  category?: string;
  status?: string;
  vendor?: string;
}

const CATEGORY_OPTIONS = [
  { value: "office",            label: "Office Expenses" },
  { value: "payroll",           label: "Payroll" },
  { value: "office_staff",      label: "Office Staff" },
  { value: "manager_salary",    label: "Manager Salaries" },
  { value: "installer_payment", label: "Installer Payments" },
  { value: "equipment_purchase",label: "Equipment Purchases" },
  { value: "parts_purchase",    label: "Parts Purchases" },
  { value: "door_purchase",     label: "Door Purchases" },
  { value: "marketing",         label: "Marketing" },
  { value: "software",          label: "Software" },
  { value: "insurance",         label: "Insurance" },
  { value: "fuel",              label: "Fuel" },
  { value: "rent",              label: "Rent" },
  { value: "subscription",      label: "Subscriptions" },
  { value: "refund",            label: "Refunds" },
  { value: "dispute",           label: "Disputes" },
  { value: "chargeback",        label: "Chargebacks" },
  { value: "misc",              label: "Miscellaneous" },
];

const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "check", label: "Check" },
  { value: "ach", label: "ACH" },
  { value: "wire", label: "Wire" },
  { value: "zelle", label: "Zelle" },
  { value: "venmo", label: "Venmo" },
  { value: "other", label: "Other" },
];

const EXPENSE_FIELDS: FieldDef[] = [
  { name: "date", label: "Date", kind: "date", width: "half", required: true,
    defaultValue: new Date().toISOString().slice(0, 10) },
  { name: "amount", label: "Amount (USD)", kind: "money", width: "half", required: true, placeholder: "0.00" },
  { name: "category", label: "Category", kind: "select", required: true, options: CATEGORY_OPTIONS, defaultValue: "misc" },
  { name: "description", label: "Description", kind: "text", required: true,
    placeholder: "What is this expense for?" },
  { name: "vendor_name", label: "Vendor / Recipient", kind: "text", width: "half",
    placeholder: "Name or company" },
  { name: "payment_method", label: "Payment method", kind: "select", width: "half", options: PAYMENT_METHODS },
  { name: "related_area", label: "Related area", kind: "text", width: "half",
    placeholder: "Optional" },
  { name: "related_person_id", label: "Related person", kind: "text", width: "half",
    placeholder: "Optional" },
  { name: "status", label: "Status", kind: "select", required: true,
    options: [{ value: "unpaid", label: "Unpaid" }, { value: "paid", label: "Paid" }],
    defaultValue: "unpaid" },
  { name: "receipt_url", label: "Receipt URL", kind: "text", width: "half",
    help: "Paste an attachment URL; upload UI coming soon" },
  { name: "notes", label: "Notes", kind: "textarea" },
];

async function loadExpenses(sp: SP) {
  await ensureFinanceIndexes();
  const range = {
    from: sp.from ?? lastNDays(30).from,
    to: sp.to ?? lastNDays(30).to,
  };
  const filter: Record<string, unknown> = {
    date: { $gte: range.from, $lte: range.to },
  };
  if (sp.category) filter.category = sp.category;
  if (sp.status === "paid" || sp.status === "unpaid") filter.status = sp.status;
  if (sp.vendor) filter.vendor_name = { $regex: sp.vendor, $options: "i" };

  const c = await coll<ExpenseRecord>(FINANCE_COLLECTIONS.expense);
  const rows = await c.find(filter).sort({ date: -1, _id: -1 }).limit(500).toArray();

  const total = rows.reduce((s, r) => s + r.amount, 0);
  const unpaid = rows.filter((r) => r.status === "unpaid").reduce((s, r) => s + r.amount, 0);
  const paid = total - unpaid;
  const byCat: Record<string, number> = {};
  for (const r of rows) byCat[r.category] = (byCat[r.category] ?? 0) + r.amount;

  // Active ledgers for the "expense to a ledger" picker.
  const ledgerRows = await coll<LedgerRecord>(FINANCE_COLLECTIONS.ledger)
    .find({ status: "active" })
    .sort({ holder_name: 1 })
    .toArray();
  const ledgers: LedgerOption[] = ledgerRows.map((l) => ({
    _id: l._id,
    holder_name: l.holder_name,
    location: l.location,
    role: l.role,
  }));

  return { range, rows, total, unpaid, paid, byCat, ledgers };
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const d = await loadExpenses(sp);

  return (
    <div className="portal-page">
      <PageHeader
        kicker="Money"
        title="Expenses"
        subtitle={
          <>
            {d.range.from} → {d.range.to} · all expense categories tracked here
          </>
        }
        actions={
          <>
            <Link href="/portal/expenses/recurring" className="portal-btn">
              ↻ Recurring
            </Link>
            <Link href="/portal/expenses/groups" className="portal-btn">
              ⊞ Unexpected
            </Link>
            <LedgerExpenseModal ledgers={d.ledgers} />
            <EntryFormModal
              endpoint="/api/portal/expenses"
              title="Expense"
              fields={EXPENSE_FIELDS}
              triggerLabel="+ New expense"
              primary
            />
          </>
        }
      />

      <section className="portal-grid-4">
        <StatPill label="Total" value={fmt$(d.total)} anchorId="ai-exp-total" />
        <StatPill label="Paid" value={<span className="money-pos">{fmt$(d.paid)}</span>} anchorId="ai-exp-paid" />
        <StatPill label="Unpaid" value={<span className="money-neg">{fmt$(d.unpaid)}</span>} anchorId="ai-exp-unpaid" />
        <StatPill label="Entries" value={d.rows.length.toLocaleString()} />
      </section>

      <FilterBar>
        <FilterField label="From">
          <input type="date" name="from" defaultValue={d.range.from} className="portal-input" />
        </FilterField>
        <FilterField label="To">
          <input type="date" name="to" defaultValue={d.range.to} className="portal-input" />
        </FilterField>
        <FilterField label="Category">
          <select name="category" defaultValue={sp.category ?? ""} className="portal-select">
            <option value="">All</option>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Status">
          <select name="status" defaultValue={sp.status ?? ""} className="portal-select">
            <option value="">All</option>
            <option value="paid">Paid</option>
            <option value="unpaid">Unpaid</option>
          </select>
        </FilterField>
        <FilterField label="Vendor contains">
          <input type="text" name="vendor" defaultValue={sp.vendor ?? ""} className="portal-input" />
        </FilterField>
        <button type="submit" className="portal-btn portal-btn-primary">Apply</button>
        <Link href="/portal/expenses" className="portal-btn">Clear</Link>
      </FilterBar>

      <CardShell title="Entries" subtitle={`${d.rows.length} matching`}>
        {d.rows.length === 0 ? (
          <Empty
            message="No expenses match these filters."
            action={
              <EntryFormModal
                endpoint="/api/portal/expenses"
                title="Expense"
                fields={EXPENSE_FIELDS}
                triggerLabel="+ Record your first expense"
              />
            }
          />
        ) : (
          <table className="portal-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Description</th>
                <th>Vendor</th>
                <th>Method</th>
                <th>Status</th>
                <th className="right">Amount</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r._id}>
                  <td className="small mono">{fmtDate(r.date)}</td>
                  <td className="small">
                    {labelForCat(r.category)}
                    {r.ledger_id && (
                      <div className="small" style={{ color: "#818cf8" }}>
                        ↪ to {r.ledger_holder ?? "ledger"}
                      </div>
                    )}
                  </td>
                  <td>
                    {r.description ?? "—"}
                    {r.notes && <div className="muted small">{r.notes}</div>}
                  </td>
                  <td className="muted small">{r.vendor_name ?? "—"}</td>
                  <td className="muted small">{r.payment_method ?? "—"}</td>
                  <td><StatusPill status={r.status} /></td>
                  <td className="right money money-neg">−{fmt$(r.amount)}</td>
                  <td className="right">
                    {r.ledger_id ? (
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <LedgerExpenseModal
                          ledgers={d.ledgers}
                          initial={{
                            _id: r._id,
                            ledger_id: r.ledger_id,
                            ledger_holder: r.ledger_holder,
                            amount: r.amount,
                            date: r.date,
                            description: r.description,
                            category: r.category,
                            payment_method: r.payment_method,
                            related_area: r.related_area,
                            status: r.status,
                            notes: r.notes,
                          }}
                        />
                        <RowActions endpoint={LEDGER_EXPENSE_ENDPOINT} id={r._id} canToggleStatus={false} />
                      </div>
                    ) : (
                      <RowActions
                        endpoint="/api/portal/expenses"
                        id={r._id}
                        currentStatus={r.status}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardShell>

      {Object.keys(d.byCat).length > 0 && (
        <CardShell title="Breakdown by category">
          <table className="portal-table">
            <thead>
              <tr>
                <th>Category</th>
                <th className="right">Total</th>
                <th className="right">% of period</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(d.byCat)
                .sort(([, a], [, b]) => b - a)
                .map(([cat, total]) => (
                  <tr key={cat}>
                    <td>{labelForCat(cat)}</td>
                    <td className="right money">{fmt$(total)}</td>
                    <td className="right muted small">
                      {d.total > 0 ? `${((total / d.total) * 100).toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </CardShell>
      )}
    </div>
  );
}

function labelForCat(c: string): string {
  return CATEGORY_OPTIONS.find((o) => o.value === c)?.label ?? c;
}
