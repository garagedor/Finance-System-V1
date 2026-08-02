import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import type { ManualIncomeRecord, RecurringIncomeRecord } from "@/types/finance";
import { fmt$, fmtDate } from "../../format";
import {
  PageHeader, StatPill, CardShell, Empty, BackLink,
} from "../../_components/page-helpers";
import EntryFormModal, { type FieldDef } from "../../_components/EntryFormModal";
import RowActions from "../../_components/RowActions";
import GenerateButton from "./GenerateButton";

export const dynamic = "force-dynamic";

const SOURCE_OPTIONS = [
  { value: "manual",               label: "Manual" },
  { value: "crm_jobs",             label: "CRM Jobs" },
  { value: "installations",        label: "Installations" },
  { value: "parts_sales",          label: "Parts Sales (to AMs)" },
  { value: "card_fee_margin",      label: "Card Fee Margin" },
  { value: "finance_fee_margin",   label: "Finance Fee Margin" },
  { value: "company_parts_margin", label: "Company Parts Margin" },
  { value: "inventory",            label: "Inventory" },
  { value: "other",                label: "Other" },
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

function buildFields(initial?: RecurringIncomeRecord): FieldDef[] {
  return [
    { name: "name", label: "Template name", kind: "text", required: true,
      placeholder: "e.g. Monthly retainer, Quarterly parts margin",
      defaultValue: initial?.name },
    { name: "source", label: "Income source", kind: "select", required: true,
      options: SOURCE_OPTIONS, defaultValue: initial?.source ?? "manual" },
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
    { name: "description", label: "Description", kind: "text",
      placeholder: "What is this income?", defaultValue: initial?.description },
    { name: "payment_method", label: "Payment method", kind: "select", width: "half",
      options: PAYMENT_METHODS, defaultValue: initial?.payment_method },
    { name: "related_area", label: "Related area (optional)", kind: "text", width: "half",
      defaultValue: initial?.related_area },
    { name: "active", label: "Active", kind: "boolean", width: "half",
      defaultValue: initial?.active ?? true,
      help: "Pause to stop generating without deleting the template." },
    { name: "notes", label: "Notes", kind: "textarea",
      defaultValue: initial?.notes },
  ];
}

async function load() {
  await ensureFinanceIndexes();
  const tColl = coll<RecurringIncomeRecord>(FINANCE_COLLECTIONS.recurringIncome);
  const iColl = coll<ManualIncomeRecord>(FINANCE_COLLECTIONS.income);
  const today = new Date().toISOString().slice(0, 10);
  const templates = await tColl.find({}).sort({ active: -1, next_due_date: 1, name: 1 }).toArray();

  // Per-template stats: how many income entries generated + total $ generated.
  const stats: Map<string, { count: number; total: number }> = new Map();
  if (templates.length > 0) {
    const rows = await iColl
      .find({ recurring_id: { $in: templates.map((t) => t._id) } })
      .toArray();
    for (const e of rows) {
      const cur = stats.get(e.recurring_id!) ?? { count: 0, total: 0 };
      cur.count++;
      cur.total += e.amount;
      stats.set(e.recurring_id!, cur);
    }
  }

  const activeCount = templates.filter((t) => t.active).length;
  const monthlyEstimate = templates
    .filter((t) => t.active)
    .reduce((s, t) => s + estimateMonthly(t), 0);
  const dueNow = templates.filter((t) => t.active && t.next_due_date <= today).length;

  return { templates, stats, today, activeCount, monthlyEstimate, dueNow };
}

function estimateMonthly(t: RecurringIncomeRecord): number {
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

export default async function RecurringIncomePage() {
  const d = await load();

  return (
    <div className="portal-page">
      <BackLink href="/portal/income" label="All income" />
      <PageHeader
        kicker="Money · Income"
        title="Recurring income"
        subtitle="Templates for retainers, recurring margins, subscriptions you collect. The generator creates real income entries on each due date."
        actions={
          <>
            <GenerateButton />
            <EntryFormModal
              endpoint="/api/portal/recurring-income"
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
        <StatPill label="Est. monthly income" value={<span className="money-pos">{fmt$(d.monthlyEstimate)}</span>} />
        <StatPill
          label="Due now"
          value={d.dueNow > 0 ? <span className="money-pos">{d.dueNow.toLocaleString()}</span> : d.dueNow.toString()}
        />
      </section>

      <CardShell
        title="Templates"
        subtitle="Each row generates one income entry per scheduled date"
      >
        {d.templates.length === 0 ? (
          <Empty
            message="No recurring income yet. Add one for each retainer, recurring margin, or subscription you collect."
            action={
              <EntryFormModal
                endpoint="/api/portal/recurring-income"
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
                <th>Source</th>
                <th>Frequency</th>
                <th className="right">Amount</th>
                <th>Next due</th>
                <th className="right">Generated</th>
                <th className="right">Total $</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {d.templates.map((t) => {
                const s = d.stats.get(t._id) ?? { count: 0, total: 0 };
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
                    <td className="small muted">{labelForSource(t.source)}</td>
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
                    <td className="right money money-pos" style={{ fontWeight: 600 }}>+{fmt$(t.amount)}</td>
                    <td className="small mono">
                      <span style={{ color: isDue ? "#34d399" : "#cbd5e1" }}>
                        {fmtDate(t.next_due_date)}
                      </span>
                      {isDue && <div className="muted small" style={{ color: "#34d399" }}>due</div>}
                    </td>
                    <td className="right small">{s.count}</td>
                    <td className="right money money-pos">{fmt$(s.total)}</td>
                    <td className="right" style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      {t.active && t.next_due_date <= d.today && (
                        <GenerateButton templateId={t._id} label="Run" />
                      )}
                      <EntryFormModal
                        endpoint="/api/portal/recurring-income"
                        title="Recurring template"
                        fields={buildFields(t)}
                        initial={t as unknown as Record<string, unknown> & { _id?: string }}
                        triggerLabel="Edit"
                      />
                      <RowActions
                        endpoint="/api/portal/recurring-income"
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
          <strong>How it works:</strong> templates are blueprints. When you click <em>Generate due income</em>{" "}
          (or Run on a specific row), the system creates real entries on the{" "}
          <Link href="/portal/income" style={{ color: "#818cf8" }}>Income page</Link>{" "}
          for every period that has come due. Generation is idempotent — running it twice never creates duplicates.
        </div>
      </div>
    </div>
  );
}

function labelForSource(s: string): string {
  return SOURCE_OPTIONS.find((o) => o.value === s)?.label ?? s;
}
function labelForFreq(f: string): string {
  return FREQ_OPTIONS.find((o) => o.value === f)?.label ?? f;
}
