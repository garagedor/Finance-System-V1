import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import type { SavedReportRecord } from "@/types/finance";
import { fmtDate, fmtDateTime } from "../format";
import { PageHeader, StatPill, FilterBar, FilterField, CardShell, Empty, StatusPill } from "../_components/page-helpers";
import GenerateReportForm from "./GenerateReportForm";
import ImportHistoricalButton from "./ImportHistoricalButton";
import RowActions from "../_components/RowActions";

export const dynamic = "force-dynamic";

interface SP {
  type?: string;
  subject?: string;
}

const REPORT_TYPE_LABELS: Record<string, string> = {
  tech_report: "Tech Report",
  area_manager_report: "Area Manager Report",
  provider_report: "Provider Report",
  employee_payout_report: "Employee Payout Report",
  debt_statement: "Debt Statement",
  settlement_statement: "Settlement Statement",
  expense_report: "Expense Report",
};

async function load(sp: SP) {
  await ensureFinanceIndexes();
  const filter: Record<string, unknown> = {};
  if (sp.type) filter.type = sp.type;
  if (sp.subject) filter.subject_name = { $regex: sp.subject, $options: "i" };
  const rows = await coll<SavedReportRecord>(FINANCE_COLLECTIONS.report)
    .find(filter)
    .sort({ generated_at: -1 })
    .limit(200)
    .toArray();
  const byType: Record<string, number> = {};
  for (const r of rows) byType[r.type] = (byType[r.type] ?? 0) + 1;
  return { rows, byType };
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const d = await load(sp);

  return (
    <div className="portal-page">
      <PageHeader
        kicker="Money"
        title="Balance Reports"
        subtitle="Generate Tech / Area Manager / Provider / Debt / Settlement / Expense reports. Saved snapshots persist for audit."
        actions={
          <>
            <ImportHistoricalButton />
            <GenerateReportForm />
          </>
        }
      />

      <section className="portal-grid-4">
        <StatPill label="Total saved" value={d.rows.length.toLocaleString()} />
        <StatPill label="Tech reports" value={(d.byType.tech_report ?? 0).toLocaleString()} />
        <StatPill label="AM reports" value={(d.byType.area_manager_report ?? 0).toLocaleString()} />
        <StatPill label="Expense reports" value={(d.byType.expense_report ?? 0).toLocaleString()} />
      </section>

      <FilterBar>
        <FilterField label="Report type">
          <select name="type" defaultValue={sp.type ?? ""} className="portal-select">
            <option value="">All types</option>
            {Object.entries(REPORT_TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Subject contains">
          <input type="text" name="subject" defaultValue={sp.subject ?? ""} className="portal-input" />
        </FilterField>
        <button type="submit" className="portal-btn portal-btn-primary">Apply</button>
        <Link href="/portal/reports" className="portal-btn">Clear</Link>
      </FilterBar>

      <CardShell title="Saved reports" subtitle={`${d.rows.length} matching`}>
        {d.rows.length === 0 ? (
          <Empty
            message="No saved reports. Generate your first one."
            action={<GenerateReportForm />}
          />
        ) : (
          <table className="portal-table">
            <thead>
              <tr>
                <th>Generated</th>
                <th>Type</th>
                <th>Subject</th>
                <th>Period</th>
                <th>Status</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r._id}>
                  <td className="small mono">{fmtDateTime(r.generated_at)}</td>
                  <td className="small">{REPORT_TYPE_LABELS[r.type] ?? r.type}</td>
                  <td>
                    <Link href={`/portal/reports/${r._id}`} style={{ color: "#cbd5e1", fontWeight: 500 }}>
                      {r.title}
                    </Link>
                    {r.subject_name && <div className="muted small">{r.subject_name}</div>}
                  </td>
                  <td className="small mono">
                    {fmtDate(r.period_start)} – {fmtDate(r.period_end)}
                  </td>
                  <td><StatusPill status={r.status} /></td>
                  <td className="right">
                    <RowActions
                      endpoint="/api/portal/reports"
                      id={r._id}
                      currentStatus={r.status}
                    />
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
