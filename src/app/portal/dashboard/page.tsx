import Link from "next/link";
import { fetchDashboardData } from "@/lib/portal-data";
import { getDbConnectError } from "@/lib/finance-db";
import { fmt$, fmtPct, lastNDays, thisMonth, lastMonth, moneyClass, fmtDate, fmtDateTime } from "../format";
import { DbDownBanner } from "../_components/DbDownBanner";
import type { ManualIncomeRecord, ExpenseRecord, PayoutRecord } from "@/types/finance";

export const dynamic = "force-dynamic";

interface SP {
  from?: string;
  to?: string;
  preset?: "today" | "week" | "month" | "lastMonth" | "30d" | "90d";
}

function resolveRange(sp: SP): { range: { from: string; to: string }; preset: string } {
  if (sp.from && sp.to) return { range: { from: sp.from, to: sp.to }, preset: "custom" };
  const preset = sp.preset ?? "30d";
  switch (preset) {
    case "today": {
      const today = new Date().toISOString().slice(0, 10);
      return { range: { from: today, to: today }, preset };
    }
    case "week":     return { range: lastNDays(7), preset };
    case "month":    return { range: thisMonth(), preset };
    case "lastMonth":return { range: lastMonth(), preset };
    case "90d":      return { range: lastNDays(90), preset };
    case "30d":
    default:         return { range: lastNDays(30), preset };
  }
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { range, preset } = resolveRange(sp);
  let d: Awaited<ReturnType<typeof fetchDashboardData>> | null = null;
  let dbError: string | null = null;
  try {
    d = await fetchDashboardData(range);
  } catch (e) {
    dbError = (getDbConnectError()?.message) ?? (e instanceof Error ? e.message : String(e));
  }
  if (!d) {
    return (
      <div className="portal-page">
        <header className="portal-header">
          <div className="portal-header-left">
            <span className="portal-kicker">Overview</span>
            <h1 className="portal-title">Executive Dashboard</h1>
          </div>
        </header>
        <DbDownBanner error={dbError} />
      </div>
    );
  }

  const seriesMax = Math.max(1, ...d.byDay.map((x) => x.total));
  const areaMax = Math.max(1, ...d.topAreas.map((a) => a.total));
  const expByCatMax = Math.max(1, ...d.expenseByCategory.map((x) => x.total));
  const incomeMax = Math.max(1, ...d.incomeBySource.map((x) => x.total));

  return (
    <div className="portal-page">
      <header className="portal-header">
        <div className="portal-header-left">
          <span className="portal-kicker">Overview</span>
          <h1 className="portal-title">Executive Dashboard</h1>
          <p className="portal-subtitle">
            Operational view for{" "}
            <strong style={{ color: "#cbd5e1" }}>
              {range.from} → {range.to}
            </strong>{" "}
            · CRM jobs + portal entries
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="portal-range-pills">
            <PresetPill href="/portal/dashboard?preset=today" active={preset === "today"}>Today</PresetPill>
            <PresetPill href="/portal/dashboard?preset=week" active={preset === "week"}>Week</PresetPill>
            <PresetPill href="/portal/dashboard?preset=month" active={preset === "month"}>Month</PresetPill>
            <PresetPill href="/portal/dashboard?preset=lastMonth" active={preset === "lastMonth"}>Last Mo</PresetPill>
            <PresetPill href="/portal/dashboard?preset=30d" active={preset === "30d"}>30d</PresetPill>
            <PresetPill href="/portal/dashboard?preset=90d" active={preset === "90d"}>90d</PresetPill>
          </div>
          <form style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span className="portal-label">From</span>
              <input type="date" name="from" defaultValue={range.from} className="portal-input" />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span className="portal-label">To</span>
              <input type="date" name="to" defaultValue={range.to} className="portal-input" />
            </label>
            <button type="submit" className="portal-btn portal-btn-primary">Apply</button>
          </form>
        </div>
      </header>

      {/* ─── KPI strip ─── */}
      <section className="portal-grid-5">
        <Kpi
          label="Total Revenue"
          value={fmt$(d.totalRevenue)}
          sub={`${d.jobCount.toLocaleString()} closed jobs · +${fmt$(d.manualIncome)} manual`}
          anchorId="ai-revenue"
        />
        <Kpi
          label="Gross Profit"
          value={fmt$(d.grossProfit)}
          sub={d.totalRevenue > 0 ? `${fmtPct(d.grossProfit / d.totalRevenue)} margin` : "—"}
          tone="up"
          anchorId="ai-gross-profit"
        />
        <Kpi
          label="Net Profit"
          value={fmt$(d.netProfit)}
          sub="after expenses & payouts"
          tone={d.netProfit < 0 ? "down" : "up"}
          anchorId="ai-net-profit"
        />
        <Kpi
          label="Operating Expenses"
          value={fmt$(d.totalExpenses)}
          sub={d.unpaidExpenses > 0 ? `${fmt$(d.unpaidExpenses)} unpaid` : "all paid"}
          tone="down"
          anchorId="ai-expenses"
        />
        <Kpi
          label="Cash on Hand"
          value={fmt$(d.cashOnHand)}
          sub={`${d.bankAccounts.length} bank account(s)`}
          anchorId="ai-cash"
        />
      </section>

      <section className="portal-grid-2">
        <Kpi
          label="Outstanding Payables"
          value={fmt$(d.outstandingPayables)}
          sub="unpaid expenses + payouts + debts"
          tone="down"
          anchorId="ai-payables"
        />
        <Kpi
          label="Outstanding Receivables (disputes)"
          value={fmt$(d.outstandingReceivables)}
          sub={`${d.openDisputes} open dispute(s)`}
          anchorId="ai-receivables"
        />
      </section>

      {/* ─── Bank activity (Plaid) ─── */}
      {d.bankAccounts.length > 0 && (
        <>
          <section className="portal-grid-4">
            <Kpi
              label="Bank Money In"
              value={fmt$(d.bankInflow)}
              sub="deposits + payments received"
              tone="up"
            />
            <Kpi
              label="Bank Money Out"
              value={fmt$(d.bankOutflow)}
              sub="withdrawals + purchases"
              tone="down"
            />
            <Kpi
              label="Bank Net Flow"
              value={fmt$(d.bankNet)}
              sub="in − out (period)"
              tone={d.bankNet < 0 ? "down" : "up"}
            />
            <Kpi
              label="Unreconciled"
              value={d.bankUnmatched.toLocaleString()}
              sub={d.bankUnmatched > 0 ? "bank txns awaiting match" : "all matched"}
            />
          </section>

          <section className="portal-grid-3">
            <div className="portal-card" style={{ gridColumn: "span 2", padding: 0 }}>
              <div className="portal-card-head">
                <div>
                  <div className="portal-card-head-title">Bank Cash Flow</div>
                  <div className="portal-card-head-sub">
                    {d.bankByDay.length} day(s) with bank activity
                  </div>
                </div>
                <Link
                  href="/portal/banking/synced"
                  className="portal-card-head-sub"
                  style={{ color: "#818cf8" }}
                >
                  All transactions →
                </Link>
              </div>
              <div style={{ padding: "20px 22px 18px" }}>
                {d.bankByDay.length === 0 ? (
                  <div className="portal-empty">No bank activity in this window.</div>
                ) : (
                  <>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 160 }}>
                      {d.bankByDay.map((day) => {
                        const dayMax = Math.max(1, ...d.bankByDay.flatMap((x) => [x.inflow, Math.abs(x.outflow)]));
                        const hIn = Math.max(0, (day.inflow / dayMax) * 76);
                        const hOut = Math.max(0, (Math.abs(day.outflow) / dayMax) * 76);
                        return (
                          <div
                            key={day.day}
                            title={`${day.day}\n  +${fmt$(day.inflow)}\n  −${fmt$(Math.abs(day.outflow))}`}
                            style={{
                              flex: 1,
                              minWidth: 4,
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              gap: 1,
                            }}
                          >
                            <div
                              style={{
                                width: "100%",
                                height: hIn,
                                background: "#10b981",
                                borderRadius: "2px 2px 0 0",
                              }}
                            />
                            <div
                              style={{
                                width: "100%",
                                height: hOut,
                                background: "#ef4444",
                                borderRadius: "0 0 2px 2px",
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginTop: 10,
                        fontSize: 10.5,
                        color: "#64748b",
                      }}
                    >
                      <span className="mono">{d.bankByDay[0]?.day}</span>
                      <span>
                        <span style={{ color: "#10b981", marginRight: 12 }}>● In</span>
                        <span style={{ color: "#ef4444" }}>● Out</span>
                      </span>
                      <span className="mono">{d.bankByDay[d.bankByDay.length - 1]?.day}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="portal-card" style={{ padding: 0 }}>
              <div className="portal-card-head">
                <div className="portal-card-head-title">Recent Bank Activity</div>
                <Link
                  href="/portal/banking/synced"
                  className="portal-card-head-sub"
                  style={{ color: "#818cf8" }}
                >
                  All →
                </Link>
              </div>
              {d.recentBankTxns.length === 0 ? (
                <div className="portal-empty">No bank transactions in window.</div>
              ) : (
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th className="right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.recentBankTxns.map((t) => (
                      <tr key={t._id}>
                        <td className="small mono">{fmtDate(t.date)}</td>
                        <td className="small">
                          {t.description}
                          {t.merchant_name && t.merchant_name !== t.description && (
                            <div className="muted small">{t.merchant_name}</div>
                          )}
                        </td>
                        <td
                          className={`right money ${t.amount >= 0 ? "money-pos" : "money-neg"}`}
                          style={{ fontWeight: 600 }}
                        >
                          {t.amount >= 0 ? "+" : "−"}{fmt$(Math.abs(t.amount))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </>
      )}

      {/* ─── Cash flow trend + income mix ─── */}
      <section className="portal-grid-3">
        <div className="portal-card" style={{ gridColumn: "span 2", padding: 0 }}>
          <div className="portal-card-head">
            <div>
              <div className="portal-card-head-title">Cash Flow Overview</div>
              <div className="portal-card-head-sub">{d.byDay.length} day(s) with activity</div>
            </div>
          </div>
          <div style={{ padding: "20px 22px 18px" }}>
            {d.byDay.length === 0 ? (
              <div className="portal-empty">No data in window.</div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 160 }}>
                  {d.byDay.map((day) => {
                    const h = Math.max(2, (day.total / seriesMax) * 152);
                    return (
                      <div
                        key={day.day}
                        title={`${day.day}: ${fmt$(day.total)} · ${day.count} jobs`}
                        style={{
                          flex: 1,
                          height: h,
                          background: "linear-gradient(180deg, #818cf8, #6366f1)",
                          borderRadius: 2,
                          minWidth: 4,
                        }}
                      />
                    );
                  })}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 10.5, color: "#64748b" }}>
                  <span className="mono">{d.byDay[0]?.day}</span>
                  <span className="mono">{d.byDay[d.byDay.length - 1]?.day}</span>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="portal-card" style={{ padding: 0 }}>
          <div className="portal-card-head">
            <div className="portal-card-head-title">Income by Source</div>
          </div>
          <div style={{ padding: "16px 18px" }}>
            {d.incomeBySource.length === 0 ? (
              <div className="portal-empty">No income.</div>
            ) : (
              d.incomeBySource.map((s) => {
                const pct = Math.max(2, (s.total / incomeMax) * 100);
                return (
                  <div key={s.source} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12.5 }}>
                      <span>{labelForSource(s.source)}</span>
                      <span className="money">{fmt$(s.total)}</span>
                    </div>
                    <div className="portal-bar">
                      <div className="portal-bar-fill good" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>

      {/* ─── Top areas + expense breakdown + bank balances ─── */}
      <section className="portal-grid-3">
        <div className="portal-card" style={{ padding: 0 }}>
          <div className="portal-card-head">
            <div className="portal-card-head-title">Top Areas by Revenue</div>
            <Link href="/portal/area-managers" className="portal-card-head-sub" style={{ color: "#818cf8" }}>
              See all →
            </Link>
          </div>
          <div style={{ padding: "12px 14px" }}>
            {d.topAreas.length === 0 ? (
              <div className="portal-empty">No data.</div>
            ) : (
              d.topAreas.slice(0, 6).map((a) => {
                const pct = Math.max(2, (a.total / areaMax) * 100);
                return (
                  <div key={a.area} style={{ padding: "8px 4px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5 }}>
                      <span style={{ fontWeight: 500 }}>{a.area}</span>
                      <span className="money" style={{ fontWeight: 600 }}>{fmt$(a.total)}</span>
                    </div>
                    <div className="portal-bar">
                      <div className="portal-bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <div style={{ fontSize: 10.5, color: "#64748b", marginTop: 3 }}>
                      {a.count} job(s)
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="portal-card" style={{ padding: 0 }}>
          <div className="portal-card-head">
            <div className="portal-card-head-title">Expense Breakdown</div>
            <Link href="/portal/expenses" className="portal-card-head-sub" style={{ color: "#818cf8" }}>
              See all →
            </Link>
          </div>
          <div style={{ padding: "12px 14px" }}>
            {d.expenseByCategory.length === 0 ? (
              <div className="portal-empty">No expenses recorded.</div>
            ) : (
              d.expenseByCategory.slice(0, 7).map((c) => {
                const pct = Math.max(2, (c.total / expByCatMax) * 100);
                return (
                  <div key={c.category} style={{ padding: "8px 4px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5 }}>
                      <span style={{ fontWeight: 500 }}>{labelForCategory(c.category)}</span>
                      <span className="money" style={{ fontWeight: 600 }}>{fmt$(c.total)}</span>
                    </div>
                    <div className="portal-bar">
                      <div className="portal-bar-fill bad" style={{ width: `${pct}%` }} />
                    </div>
                    <div style={{ fontSize: 10.5, color: "#64748b", marginTop: 3 }}>
                      {c.count} entries
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="portal-card" style={{ padding: 0 }}>
          <div className="portal-card-head">
            <div className="portal-card-head-title">Account Balances</div>
            <Link href="/portal/banking" className="portal-card-head-sub" style={{ color: "#818cf8" }}>
              Banking →
            </Link>
          </div>
          <div style={{ padding: "12px 14px" }}>
            {d.bankAccounts.length === 0 ? (
              <div className="portal-empty">
                No bank accounts yet.
                <div style={{ marginTop: 8 }}>
                  <Link href="/portal/banking" className="portal-btn portal-btn-ghost">Add account</Link>
                </div>
              </div>
            ) : (
              d.bankAccounts.map((a) => (
                <div
                  key={a._id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 4px",
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{a.label}</div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>
                      {a.bank_name ?? "—"} {a.last4 ? `· ${a.last4}` : ""}
                    </div>
                  </div>
                  <span className={`money money-big ${moneyClass(a._balance ?? 0).replace("money", "")}`}>
                    {fmt$(a._balance ?? 0)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* ─── Pending approvals / upcoming payouts / recent activity ─── */}
      <section className="portal-grid-3">
        <div className="portal-card" style={{ padding: 0 }}>
          <div className="portal-card-head">
            <div className="portal-card-head-title">Pending Approvals</div>
            <span className="portal-card-head-sub">items needing action</span>
          </div>
          <div style={{ padding: "10px 14px" }}>
            {d.unpaidExpenses > 0 && (
              <ApprovalRow
                href="/portal/expenses?status=unpaid"
                label={`${fmt$(d.unpaidExpenses)} unpaid expenses`}
                tone="warn"
              />
            )}
            {d.pendingPayouts.length > 0 && (
              <ApprovalRow
                href="/portal/payouts?status=unpaid"
                label={`${d.pendingPayouts.length} payouts awaiting payment`}
                tone="warn"
              />
            )}
            {d.openDisputesAmount > 0 && (
              <ApprovalRow
                href="/portal/disputes"
                label={`${fmt$(d.openDisputesAmount)} disputes open`}
                tone="error"
              />
            )}
            {d.unpaidExpenses === 0 && d.pendingPayouts.length === 0 && d.openDisputesAmount === 0 && (
              <div className="portal-empty" style={{ padding: "20px 8px" }}>All clear.</div>
            )}
          </div>
        </div>

        <div className="portal-card" style={{ padding: 0 }}>
          <div className="portal-card-head">
            <div className="portal-card-head-title">Upcoming Payouts</div>
            <Link href="/portal/payouts" className="portal-card-head-sub" style={{ color: "#818cf8" }}>
              All →
            </Link>
          </div>
          {d.pendingPayouts.length === 0 ? (
            <div className="portal-empty">No payouts scheduled.</div>
          ) : (
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Recipient</th>
                  <th>Period</th>
                  <th className="right">Net</th>
                </tr>
              </thead>
              <tbody>
                {d.pendingPayouts.map((p: PayoutRecord) => (
                  <tr key={p._id}>
                    <td>
                      <Link href={`/portal/payouts/${p._id}`} style={{ color: "#cbd5e1" }}>
                        {p.recipient_name}
                      </Link>
                      <div className="muted small">{p.recipient_role}</div>
                    </td>
                    <td className="small muted">
                      {fmtDate(p.period_start)} – {fmtDate(p.period_end)}
                    </td>
                    <td className={`right ${moneyClass(p.net)}`}>{fmt$(p.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="portal-card" style={{ padding: 0 }}>
          <div className="portal-card-head">
            <div className="portal-card-head-title">Recent Transactions</div>
            <span className="portal-card-head-sub">income + expense entries</span>
          </div>
          {[...d.recentIncome, ...d.recentExpenses].length === 0 ? (
            <div className="portal-empty">
              Nothing yet.
              <div style={{ marginTop: 8, display: "flex", gap: 6, justifyContent: "center" }}>
                <Link href="/portal/income" className="portal-btn portal-btn-ghost">+ Income</Link>
                <Link href="/portal/expenses" className="portal-btn portal-btn-ghost">+ Expense</Link>
              </div>
            </div>
          ) : (
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Kind</th>
                  <th>Description</th>
                  <th className="right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {mergeTransactions(d.recentIncome, d.recentExpenses)
                  .slice(0, 8)
                  .map((row) => (
                    <tr key={`${row.kind}-${row._id}`}>
                      <td className="small mono">{fmtDate(row.date)}</td>
                      <td>
                        <span className={`pill ${row.kind === "income" ? "pill-paid" : "pill-unpaid"}`}>
                          {row.kind}
                        </span>
                      </td>
                      <td className="small">{row.description}</td>
                      <td className={`right ${row.kind === "income" ? "money-pos" : "money-neg"}`}>
                        {row.kind === "income" ? "+" : "−"}
                        {fmt$(row.amount)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* ─── Quick actions ─── */}
      <section className="portal-card">
        <div className="portal-section-label" style={{ marginBottom: 10 }}>Quick Actions</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/portal/expenses?new=1" className="portal-btn portal-btn-primary">+ New expense</Link>
          <Link href="/portal/income?new=1" className="portal-btn">+ Manual income</Link>
          <Link href="/portal/payouts?new=1" className="portal-btn">+ New payout</Link>
          <Link href="/portal/debts?new=1" className="portal-btn">+ Debt entry</Link>
          <Link href="/portal/disputes?new=1" className="portal-btn">+ Dispute / refund</Link>
          <Link href="/portal/reports" className="portal-btn">Generate report</Link>
          <Link href="/portal/banking?new=1" className="portal-btn portal-btn-ghost">+ Bank account</Link>
        </div>
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
  anchorId,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down";
  anchorId?: string;
}) {
  return (
    <div className="portal-kpi" id={anchorId}>
      <div className="portal-kpi-label">{label}</div>
      <div className={`portal-kpi-value ${tone === "up" ? "portal-kpi-trend-up" : tone === "down" ? "portal-kpi-trend-down" : ""}`}>
        {value}
      </div>
      {sub && <div className="portal-kpi-sub">{sub}</div>}
    </div>
  );
}

function PresetPill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={`portal-range-pill ${active ? "active" : ""}`}>
      {children}
    </Link>
  );
}

function ApprovalRow({
  href,
  label,
  tone,
}: {
  href: string;
  label: string;
  tone: "warn" | "error" | "info";
}) {
  return (
    <Link href={href} className={`portal-alert portal-alert-${tone}`} style={{ marginBottom: 6, textDecoration: "none" }}>
      <span>→</span>
      <span>{label}</span>
    </Link>
  );
}

function labelForSource(s: string): string {
  const m: Record<string, string> = {
    crm_jobs: "CRM Jobs",
    installations: "Installations",
    parts_sales: "Parts Sales (to AMs)",
    card_fee_margin: "Card Fee Margin",
    finance_fee_margin: "Finance Fee Margin",
    company_parts_margin: "Company Parts Margin",
    manual: "Manual",
    inventory: "Inventory",
    other: "Other",
  };
  return m[s] ?? s;
}

function labelForCategory(c: string): string {
  return c.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

type MergedTxn = { _id: string; kind: "income" | "expense"; date: string; description: string; amount: number };

function mergeTransactions(income: ManualIncomeRecord[], expense: ExpenseRecord[]): MergedTxn[] {
  const a: MergedTxn[] = income.map((r) => ({
    _id: r._id,
    kind: "income",
    date: r.date,
    description: r.description,
    amount: r.amount,
  }));
  const b: MergedTxn[] = expense.map((r) => ({
    _id: r._id,
    kind: "expense",
    date: r.date,
    description: r.description ?? labelForCategory(r.category),
    amount: r.amount,
  }));
  return [...a, ...b].sort((x, y) => y.date.localeCompare(x.date));
}
