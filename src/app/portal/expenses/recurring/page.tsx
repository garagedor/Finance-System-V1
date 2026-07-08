import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import type { ExpenseRecord, RecurringExpenseRecord } from "@/types/finance";
import { fmt$, fmtDate, fmtDateTime } from "../../format";
import {
  PageHeader, StatPill, CardShell, Empty, StatusPill, BackLink,
} from "../../_components/page-helpers";
import EntryFormModal, { type FieldDef } from "../../_components/EntryFormModal";
import RowActions from "../../_components/RowActions";
import GenerateButton from "./GenerateButton";

export const dynamic = "force-dynamic";

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
  { value: "misc",              label: "Miscellaneous" },
];

const FREQ_OPTIONS = [
  { value: "daily",     label: "Daily" },
  { value: "weekly",    label: "Weekly" },
  { value: "biweekly",  label: "Bi-weekly (every 14d)" },
  { value: "monthly",   label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual",    label: "Annual" },
  { value: "custom",    label: "Custom interval (N days)" },
];

const PAYMENT_METHODS = [
  { value: "ach", label: "ACH" }, { value: "wire", label: "Wire" },
  { value: "zelle", label: "Zelle" }, { value: "venmo", label: "Venmo" },
  { value: "check", label: "Check" }, { value: "card", label: "Card" },
  { value: "cash", label: "Cash" }, { value: "other", label: "Other" },
];

function buildFields(initial?: RecurringExpenseRecord): FieldDef[] {
  return [
    { name: "name", label: "Template name", kind: "text", required: true,
      placeholder: "e.g. Office rent, Salary — Yonatan, Stripe subscription",
      defaultValue: initial?.name },
    { name: "category", label: "Category", kind: "select", required: true,
      options: CATEGORY_OPTIONS, defaultValue: initial?.category ?? "subscription" },
    { name: "amount", label: "Amount per occurrence", kind: "money", required: true, width: "half",
      placeholder: "0.00", defaultValue: initial?.amount },
    { name: "frequency", label: "Frequency", kind: "select", required: true, width: "half",
      options: FREQ_OPTIONS, defaultValue: initial?.frequency ?? "monthly" },
    { name: "start_date", label: "Start date (first due)", kind: "date", required: true, width: "half",
      defaultValue: initial?.start_date ?? new Date().toISOString().slice(0, 10),
      help: "Generation runs from this date forward." },
    { name: "end_date", label: "End date (optional)", kind: "date", width: "half",
      defaultValue: initial?.end_date,
      help: "Stops generating after this date." },
    { name: "day_of_month", label: "Day of month (1-31, or -1 for last day)", kind: "number", width: "half",
      defaultValue: initial?.day_of_month,
      help: "Only used for monthly / quarterly / annual." },
    { name: "custom_interval_days", label: "Custom interval (days)", kind: "number", width: "half",
      defaultValue: initial?.custom_interval_days,
      help: "Only used when frequency = Custom." },
    { name: "vendor_name", label: "Vendor / Recipient", kind: "text",
      placeholder: "Who gets paid?", defaultValue: initial?.vendor_name },
    { name: "payment_method", label: "Payment method", kind: "select", width: "half",
      options: PAYMENT_METHODS, defaultValue: initial?.payment_method },
    { name: "default_status", label: "Mark generated expenses as", kind: "select", required: true, width: "half",
      options: [
        { value: "unpaid", label: "Unpaid (needs reconciliation)" },
        { value: "paid", label: "Paid (auto-mark)" },
      ],
      defaultValue: initial?.default_status ?? "unpaid",
      help: "Auto-paid: subscriptions on autopay, salaries via ACH. Unpaid: rent, vendor invoices." },
    { name: "active", label: "Active", kind: "boolean", width: "half",
      defaultValue: initial?.active ?? true,
      help: "Pause to stop generating without deleting the template." },
    { name: "notes", label: "Notes", kind: "textarea",
      defaultValue: initial?.notes },
  ];
}

async function load() {
  await ensureFinanceIndexes();
  const tColl = coll<RecurringExpenseRecord>(FINANCE_COLLECTIONS.recurringExpense);
  const eColl = coll<ExpenseRecord>(FINANCE_COLLECTIONS.expense);
  const today = new Date().toISOString().slice(0, 10);
  const templates = await tColl.find({}).sort({ active: -1, next_due_date: 1, name: 1 }).toArray();

  // Per-template stats: how many expenses generated, total $ generated
  const stats: Map<string, { count: number; total: number; unpaid: number }> = new Map();
  if (templates.length > 0) {
    const rows = await eColl
      .find({ recurring_id: { $in: templates.map((t) => t._id) } })
      .toArray();
    for (const e of rows) {
      const cur = stats.get(e.recurring_id!) ?? { count: 0, total: 0, unpaid: 0 };
      cur.count++;
      cur.total += e.amount;
      if (e.status === "unpaid") cur.unpaid += e.amount;
      stats.set(e.recurring_id!, cur);
    }
  }

  const activeCount = templates.filter((t) => t.active).length;
  const monthlyEstimate = templates
    .filter((t) => t.active)
    .reduce((s, t) => s + estimateMonthlyCost(t), 0);
  const dueNow = templates.filter((t) => t.active && t.next_due_date <= today).length;

  return { templates, stats, today, activeCount, monthlyEstimate, dueNow };
}

function estimateMonthlyCost(t: RecurringExpenseRecord): number {
  // Rough monthly equivalent for the "estimated monthly cost" KPI.
  switch (t.frequency) {
    case "daily":     return t.amount * 30;
    case "weekly":    return t.amount * 4.33;
    case "biweekly":  return t.amount * 2.17;
    case "monthly":   return t.amount;
    case "quarterly": return t.amount / 3;
    case "annual":    return t.amount / 12;
    case "custom":    return t.amount * (30 / Math.max(1, t.custom_interval_days ?? 30));
  }
}

export default async function RecurringExpensesPage() {
  const d = await load();

  return (
    <div className="portal-page">
      <BackLink href="/portal/expenses" label="All expenses" />
      <PageHeader
        kicker="Money · Expenses"
        title="Recurring expenses"
        subtitle="Templates for rent, salaries, subscriptions, insurance. The generator creates actual expense entries on each due date."
        actions={
          <>
            <GenerateButton />
            <EntryFormModal
              endpoint="/api/portal/recurring-expenses"
              title="Recurring template"
              fields={buildFields()}
              triggerLabel="+ New template"
              primary
            />
          </>
        }
      />

      <section className="portal-grid-4">
        <StatPill label="Templates" value={d.templates.length.toLocaleString()} />
        <StatPill label="Active" value={d.activeCount.toLocaleString()} />
        <StatPill label="Est. monthly cost" value={fmt$(d.monthlyEstimate)} />
        <StatPill
          label="Due now"
          value={d.dueNow > 0 ? <span className="money-neg">{d.dueNow.toLocaleString()}</span> : d.dueNow.toString()}
        />
      </section>

      <CardShell
        title="Templates"
        subtitle="Each row generates one expense entry per scheduled date"
      >
        {d.templates.length === 0 ? (
          <Empty
            message="No recurring expenses yet. Add one for each subscription / rent / salary / insurance."
            action={
              <EntryFormModal
                endpoint="/api/portal/recurring-expenses"
                title="Recurring template"
                fields={buildFields()}
                triggerLabel="+ Add your first template"
              />
            }
          />
        ) : (
          <table className="portal-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Name</th>
                <th>Category</th>
                <th>Frequency</th>
                <th>Vendor</th>
                <th className="right">Amount</th>
                <th>Next due</th>
                <th className="right">Generated</th>
                <th className="right">Total $</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {d.templates.map((t) => {
                const s = d.stats.get(t._id) ?? { count: 0, total: 0, unpaid: 0 };
                const isDue = t.active && t.next_due_date <= d.today;
                return (
                  <tr key={t._id}>
                    <td>
                      {t.active
                        ? <span className="pill pill-paid">active</span>
                        : <span className="pill pill-draft">paused</span>}
                    </td>
                    <td>
                      <strong>{t.name}</strong>
                      {t.notes && <div className="muted small">{t.notes.split("\n")[0]}</div>}
                    </td>
                    <td className="small muted">{labelForCat(t.category)}</td>
                    <td className="small">
                      {labelForFreq(t.frequency)}
                      {t.frequency === "custom" && t.custom_interval_days && (
                        <div className="muted small">every {t.custom_interval_days}d</div>
                      )}
                      {(t.frequency === "monthly" || t.frequency === "quarterly" || t.frequency === "annual") && t.day_of_month && (
                        <div className="muted small">
                          day {t.day_of_month === -1 ? "last" : t.day_of_month}
                        </div>
                      )}
                    </td>
                    <td className="muted small">{t.vendor_name ?? "—"}</td>
                    <td className="right money" style={{ fontWeight: 600 }}>{fmt$(t.amount)}</td>
                    <td className="small mono">
                      <span style={{ color: isDue ? "#f87171" : "#cbd5e1" }}>
                        {fmtDate(t.next_due_date)}
                      </span>
                      {isDue && <div className="muted small" style={{ color: "#f87171" }}>due</div>}
                    </td>
                    <td className="right small">{s.count}</td>
                    <td className="right money">
                      {fmt$(s.total)}
                      {s.unpaid > 0 && (
                        <div className="muted small">{fmt$(s.unpaid)} unpaid</div>
                      )}
                    </td>
                    <td className="right" style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      {t.active && t.next_due_date <= d.today && (
                        <GenerateButton templateId={t._id} label="Run" />
                      )}
                      <EntryFormModal
                        endpoint="/api/portal/recurring-expenses"
                        title="Recurring template"
                        fields={buildFields(t)}
                        initial={t as unknown as Record<string, unknown> & { _id?: string }}
                        triggerLabel="Edit"
                      />
                      <RowActions
                        endpoint="/api/portal/recurring-expenses"
                        id={t._id}
                        canToggleStatus={false}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardShell>

      <div className="portal-alert portal-alert-info">
        <span>ℹ</span>
        <div>
          <strong>How it works:</strong> templates are blueprints. When you click <em>Generate due expenses</em>{" "}
          (or Run on a specific row), the system creates real entries on the <Link href="/portal/expenses" style={{ color: "#818cf8" }}>Expenses page</Link>{" "}
          for every period that has come due. Generation is idempotent — running it twice never creates duplicates.
          Templates marked <em>Paid</em> auto-mark the generated expense as paid; <em>Unpaid</em> requires reconciliation
          (e.g. matching a Plaid bank transaction).
        </div>
      </div>
    </div>
  );
}

function labelForCat(c: string): string {
  return CATEGORY_OPTIONS.find((o) => o.value === c)?.label ?? c;
}
function labelForFreq(f: string): string {
  return FREQ_OPTIONS.find((o) => o.value === f)?.label ?? f;
}
