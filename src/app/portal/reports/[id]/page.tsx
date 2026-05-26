import { notFound } from "next/navigation";
import { coll, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import type { SavedReportRecord } from "@/types/finance";
import { fmt$, fmtDate, fmtDateTime } from "../../format";
import { PageHeader, CardShell, StatusPill, BackLink } from "../../_components/page-helpers";

export const dynamic = "force-dynamic";

async function load(id: string) {
  return coll<SavedReportRecord>(FINANCE_COLLECTIONS.report).findOne({ _id: id });
}

// CRM balance-report shape (matches /api/balance-report response)
interface BalanceRow {
  jobId?: string;
  date?: string;
  jobName?: string;
  customerName?: string;
  address?: string;
  status?: string;
  totalAmount?: number;
  paidSum?: number;
  totalProfit?: number;
  shareAmount?: number;
  balance?: number;
  techPaidCash?: number;
  totalPaidCard?: number;
  totalPaidCompanyCheck?: number;
  totalPaidFinance?: number;
  totalPaidCompanyCash?: number;
  lmCash?: number;
  lmCheck?: number;
  techParts?: number;
  companyParts?: number;
  lmParts?: number;
  tipsCard?: number;
  tipsFinance?: number;
  tipsCompanyCash?: number;
  tipsCheck?: number;
  lmOwesCompany?: number;
  companyOwesLm?: number;
  paymentFee?: number;
  approvals?: string;
}

interface BalanceReportSnapshot {
  rows?: BalanceRow[];
  totals?: Record<string, number>;
  meta?: Record<string, unknown>;
}

export default async function ReportDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const report = await load(id);
  if (!report) notFound();

  const isBalanceReport =
    report.type === "tech_report" || report.type === "area_manager_report";
  const snap = (report.snapshot ?? {}) as BalanceReportSnapshot;
  const rows = snap.rows ?? [];

  // Aggregates for summary cards
  const sumOf = (key: keyof BalanceRow) =>
    rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
  const totalRevenue = sumOf("paidSum");
  const totalProfit = sumOf("totalProfit");
  const totalShare = sumOf("shareAmount");
  const totalCash = sumOf("techPaidCash") + sumOf("lmCash");
  const totalParts = sumOf("techParts") + sumOf("companyParts") + sumOf("lmParts");
  const totalTips =
    sumOf("tipsCard") + sumOf("tipsFinance") + sumOf("tipsCompanyCash") + sumOf("tipsCheck");
  const totalBalance = sumOf("balance");
  const totalLmOwes = sumOf("lmOwesCompany");
  const totalCompanyOwes = sumOf("companyOwesLm");
  const avgTicket = rows.length > 0 ? totalRevenue / rows.length : 0;

  return (
    <div className="portal-page">
      <BackLink href="/portal/reports" label="All reports" />
      <PageHeader
        kicker={`Report · ${labelForType(report.type)}`}
        title={report.title}
        subtitle={
          <>
            {fmtDate(report.period_start)} → {fmtDate(report.period_end)} · generated{" "}
            {fmtDateTime(report.generated_at)}
            {report.generated_by ? ` by ${report.generated_by}` : ""} ·{" "}
            <StatusPill status={report.status} />
          </>
        }
      />

      {isBalanceReport && rows.length > 0 && (
        <>
          <section className="portal-grid-4">
            <Stat label="Closed jobs" value={rows.length.toLocaleString()} />
            <Stat label="Total revenue (paid)" value={fmt$(totalRevenue)} />
            <Stat label="Total profit" value={fmt$(totalProfit)} />
            <Stat label="Share earned" value={fmt$(totalShare)} />
          </section>
          <section className="portal-grid-4">
            <Stat label="Cash collected" value={fmt$(totalCash)} />
            <Stat label="Parts (all kinds)" value={fmt$(totalParts)} />
            <Stat label="Tips total" value={fmt$(totalTips)} />
            <Stat label="Avg ticket" value={fmt$(avgTicket)} />
          </section>
          <section className="portal-grid-3">
            <Stat
              label={report.type === "tech_report" ? "Balance" : "LM owes company"}
              value={fmt$(report.type === "tech_report" ? totalBalance : totalLmOwes)}
            />
            <Stat
              label="Balance + tips"
              value={fmt$((report.type === "tech_report" ? totalBalance : totalLmOwes) + totalTips)}
            />
            {report.type === "area_manager_report" && (
              <Stat label="Company owes LM" value={fmt$(totalCompanyOwes)} />
            )}
          </section>

          <CardShell title="Job-level breakdown" subtitle={`${rows.length} rows`}>
            <div style={{ overflowX: "auto" }}>
              <table className="portal-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Customer / Address</th>
                    <th>Status</th>
                    <th>Method</th>
                    <th>Approvals</th>
                    <th className="right">Total</th>
                    <th className="right">Profit</th>
                    <th className="right">Share</th>
                    <th className="right">Cash</th>
                    <th className="right">Tech parts</th>
                    <th className="right">Co. parts</th>
                    <th className="right">LM parts</th>
                    <th className="right">Fee</th>
                    <th className="right">LM cash</th>
                    <th className="right">LM check</th>
                    <th className="right">Tips</th>
                    <th className="right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const tipsRow =
                      (r.tipsCard ?? 0) + (r.tipsFinance ?? 0) + (r.tipsCompanyCash ?? 0) + (r.tipsCheck ?? 0);
                    const cashRow = (r.techPaidCash ?? 0) + (r.lmCash ?? 0);
                    return (
                      <tr key={r.jobId ?? i}>
                        <td className="small mono">{fmtDate(r.date)}</td>
                        <td className="small">
                          <div>{r.customerName ?? r.jobName ?? "—"}</div>
                          {r.address && <div className="muted">{r.address}</div>}
                        </td>
                        <td>
                          <span className="pill pill-closed">{r.status ?? "—"}</span>
                        </td>
                        <td className="small muted">{summarizeMethods(r)}</td>
                        <td className="small muted">{r.approvals ?? "—"}</td>
                        <td className="right money">{fmt$(r.totalAmount || r.paidSum)}</td>
                        <td className="right money">{fmt$(r.totalProfit)}</td>
                        <td className="right money" style={{ fontWeight: 600 }}>{fmt$(r.shareAmount)}</td>
                        <td className="right money">{fmt$(cashRow)}</td>
                        <td className="right money muted">{fmt$(r.techParts)}</td>
                        <td className="right money muted">{fmt$(r.companyParts)}</td>
                        <td className="right money muted">{fmt$(r.lmParts)}</td>
                        <td className="right money muted">{fmt$(r.paymentFee)}</td>
                        <td className="right money muted">{fmt$(r.lmCash)}</td>
                        <td className="right money muted">{fmt$(r.lmCheck)}</td>
                        <td className="right money">{fmt$(tipsRow)}</td>
                        <td
                          className={`right money ${
                            (r.balance ?? r.lmOwesCompany ?? 0) > 0
                              ? "money-pos"
                              : (r.balance ?? r.lmOwesCompany ?? 0) < 0
                                ? "money-neg"
                                : "money-zero"
                          }`}
                          style={{ fontWeight: 600 }}
                        >
                          {fmt$(r.balance ?? r.lmOwesCompany ?? 0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardShell>
        </>
      )}

      {!isBalanceReport && (
        <CardShell title="Snapshot">
          <pre
            style={{
              padding: 16,
              background: "#0a0f1c",
              color: "#cbd5e1",
              fontSize: 11.5,
              overflowX: "auto",
              maxHeight: 560,
              fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
            }}
          >
            {JSON.stringify(report.snapshot, null, 2)}
          </pre>
        </CardShell>
      )}

      {report.notes && (
        <CardShell title="Notes">
          <div style={{ padding: 16, fontSize: 13 }}>{report.notes}</div>
        </CardShell>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="portal-kpi">
      <div className="portal-kpi-label">{label}</div>
      <div className="portal-kpi-value" style={{ fontSize: 18 }}>{value}</div>
    </div>
  );
}

function summarizeMethods(r: BalanceRow): string {
  const m: string[] = [];
  if ((r.totalPaidCard ?? 0) > 0) m.push("card");
  if ((r.totalPaidCompanyCheck ?? 0) > 0) m.push("check");
  if ((r.totalPaidFinance ?? 0) > 0) m.push("fin");
  if ((r.totalPaidCompanyCash ?? 0) > 0 || (r.techPaidCash ?? 0) > 0) m.push("cash");
  return m.join(", ") || "—";
}

function labelForType(t: string): string {
  return {
    tech_report: "Tech Report",
    area_manager_report: "Area Manager Report",
    provider_report: "Provider Report",
    employee_payout_report: "Employee Payout Report",
    debt_statement: "Debt Statement",
    settlement_statement: "Settlement Statement",
    expense_report: "Expense Report",
  }[t] ?? t;
}
