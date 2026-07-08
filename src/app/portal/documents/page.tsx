import Link from "next/link";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import type { SavedReportRecord } from "@/types/finance";
import { fmtDate, fmtDateTime } from "../format";
import { PageHeader, StatPill, CardShell, Empty, StatusPill } from "../_components/page-helpers";

export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = {
  tech_report: "Tech Report",
  area_manager_report: "Area Manager Report",
  provider_report: "Provider Report",
  employee_payout_report: "Employee Payout Report",
  debt_statement: "Debt Statement",
  settlement_statement: "Settlement Statement",
  expense_report: "Expense Report",
};

async function load() {
  await ensureFinanceIndexes();
  const reports = await coll<SavedReportRecord>(FINANCE_COLLECTIONS.report)
    .find({})
    .sort({ generated_at: -1 })
    .limit(500)
    .toArray();
  const byType: Record<string, number> = {};
  for (const r of reports) byType[r.type] = (byType[r.type] ?? 0) + 1;
  return { reports, byType };
}

export default async function DocumentsPage() {
  const d = await load();

  return (
    <div className="portal-page">
      <PageHeader
        kicker="Tracking"
        title="Reports & Documents"
        subtitle="Archive of all generated reports + uploaded financial documents."
        actions={
          <Link href="/portal/reports" className="portal-btn portal-btn-primary">
            Generate new report →
          </Link>
        }
      />

      <section className="portal-grid-4">
        <StatPill label="Total saved reports" value={d.reports.length.toLocaleString()} />
        <StatPill label="Tech reports" value={(d.byType.tech_report ?? 0).toLocaleString()} />
        <StatPill label="AM reports" value={(d.byType.area_manager_report ?? 0).toLocaleString()} />
        <StatPill label="Other types" value={(
          Object.entries(d.byType)
            .filter(([k]) => k !== "tech_report" && k !== "area_manager_report")
            .reduce((s, [, v]) => s + v, 0)
        ).toLocaleString()} />
      </section>

      <CardShell title="All saved reports" subtitle="Most recent first">
        {d.reports.length === 0 ? (
          <Empty
            message="No saved documents yet."
            action={<Link href="/portal/reports" className="portal-btn">Go to Reports →</Link>}
          />
        ) : (
          <table className="portal-table">
            <thead>
              <tr>
                <th>Generated</th>
                <th>Type</th>
                <th>Title</th>
                <th>Subject</th>
                <th>Period</th>
                <th>By</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {d.reports.map((r) => (
                <tr key={r._id}>
                  <td className="small mono">{fmtDateTime(r.generated_at)}</td>
                  <td className="small">{TYPE_LABELS[r.type] ?? r.type}</td>
                  <td>
                    <Link href={`/portal/reports/${r._id}`} style={{ color: "#cbd5e1", fontWeight: 500 }}>
                      {r.title}
                    </Link>
                  </td>
                  <td className="muted small">{r.subject_name ?? "—"}</td>
                  <td className="muted small mono">
                    {fmtDate(r.period_start)} – {fmtDate(r.period_end)}
                  </td>
                  <td className="muted small">{r.generated_by ?? "—"}</td>
                  <td><StatusPill status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardShell>

      <CardShell title="Uploaded documents" subtitle="Receipts, invoices, attachments">
        <Empty
          message="Document uploads coming next iteration. For now, paste attachment URLs on expense/dispute entries."
        />
      </CardShell>
    </div>
  );
}
