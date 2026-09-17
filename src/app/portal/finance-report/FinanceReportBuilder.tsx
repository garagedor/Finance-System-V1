"use client";

// The Financial Report builder. Picks the period + ledger scope, toggles and
// reorders the sections, previews the numbers live (from /api/portal/finance-
// report), and opens the branded PDF (/api/finance-report/pdf) with the exact
// same configuration. Type-only import of the data shape — no server code
// is pulled into the client bundle.

import { useCallback, useEffect, useMemo, useState } from "react";
import FilterMultiSelect from "../_components/FilterMultiSelect";
import type { FinancialReportData, SectionKey } from "@/lib/financial-report";

const SECTIONS: { key: SectionKey; label: string; hint: string }[] = [
  { key: "pnl", label: "P&L Summary", hint: "Revenue, gross profit, expenses, net profit" },
  { key: "income", label: "Income breakdown", hint: "Revenue by source (jobs + other income)" },
  { key: "expenses", label: "Expenses breakdown", hint: "Spend by category" },
  { key: "disputes", label: "Disputes & Refunds impact", hint: "Company-slice loss/recovery for the period" },
  { key: "disputesByParty", label: "Disputes by provider / tech / AM", hint: "Chargeback share per party" },
  { key: "byLocation", label: "Revenue by location", hint: "Collected per location" },
  { key: "payouts", label: "Payouts", hint: "Paid vs unpaid payouts + list" },
  { key: "debts", label: "Debts & balances", hint: "Open debts owed to / by the company" },
  { key: "equipment", label: "Equipment orders", hint: "AM-charged orders + gross profit" },
  { key: "banking", label: "Cash & banking", hint: "Account balances + money in/out" },
  { key: "ledgers", label: "Ledgers — balances to settle", hint: "Per-ledger opening → closing + current balance" },
];

const money = (n: number) => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const roleLabel = (r: string) => r === "area_manager" ? "Area Manager" : r === "technician" ? "Technician" : r.replace(/_/g, " ");

export default function FinanceReportBuilder() {
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(() => fmt(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(() => fmt(today));
  const [roles, setRoles] = useState<string[]>([]);
  const [locs, setLocs] = useState<string[]>([]);
  const [holders, setHolders] = useState<string[]>([]);
  const [title, setTitle] = useState("Financial Report");
  const [preparedFor, setPreparedFor] = useState("");
  const [order, setOrder] = useState(() => SECTIONS.map((s) => ({ key: s.key, enabled: true })));

  const [opts, setOpts] = useState<{ roles: string[]; locations: string[]; holders: string[] }>({ roles: [], locations: [], holders: [] });
  const [data, setData] = useState<FinancialReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ledger-scope option lists (derived from the active ledgers).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/portal/ledger?status=active&pageSize=2000");
        const j = await r.json();
        const rows: Array<{ holder_name?: string; role?: string; location?: string }> = Array.isArray(j) ? j : (j.rows ?? []);
        if (cancelled) return;
        const uniq = (arr: string[]) => [...new Set(arr.filter(Boolean))].sort();
        setOpts({
          roles: uniq(rows.map((x) => String(x.role ?? ""))),
          locations: uniq(rows.map((x) => String(x.location ?? ""))),
          holders: uniq(rows.map((x) => String(x.holder_name ?? ""))),
        });
      } catch { /* filters still work if empty; scope defaults to all ledgers */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const p = new URLSearchParams({ from, to });
      if (roles.length) p.set("roles", roles.join(","));
      if (locs.length) p.set("locations", locs.join(","));
      if (holders.length) p.set("holders", holders.join(","));
      const r = await fetch(`/api/portal/finance-report?${p.toString()}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setData(j);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); } finally { setLoading(false); }
  }, [from, to, roles, locs, holders]);

  useEffect(() => { const t = setTimeout(load, 400); return () => clearTimeout(t); }, [load]);

  // Section toggle + reorder
  const toggle = (key: SectionKey) => setOrder((o) => o.map((s) => s.key === key ? { ...s, enabled: !s.enabled } : s));
  const move = (i: number, dir: -1 | 1) => setOrder((o) => {
    const j = i + dir;
    if (j < 0 || j >= o.length) return o;
    const next = [...o];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const enabledKeys = order.filter((o) => o.enabled).map((o) => o.key);
  const allOn = order.every((o) => o.enabled);
  const setAllSections = (enabled: boolean) => setOrder((o) => o.map((s) => ({ ...s, enabled })));

  // One-click "everything": canonical order, every section on, scope cleared
  // (all ledgers), period = year-to-date. The preview auto-refreshes.
  function fullSystemReport() {
    setOrder(SECTIONS.map((s) => ({ key: s.key, enabled: true })));
    setRoles([]); setLocs([]); setHolders([]);
    const n = new Date();
    setFrom(fmt(new Date(n.getFullYear(), 0, 1)));
    setTo(fmt(n));
  }

  function preset(kind: "thisMonth" | "lastMonth" | "quarter" | "ytd") {
    const n = new Date();
    if (kind === "thisMonth") { setFrom(fmt(new Date(n.getFullYear(), n.getMonth(), 1))); setTo(fmt(n)); }
    else if (kind === "lastMonth") { setFrom(fmt(new Date(n.getFullYear(), n.getMonth() - 1, 1))); setTo(fmt(new Date(n.getFullYear(), n.getMonth(), 0))); }
    else if (kind === "quarter") { const q = Math.floor(n.getMonth() / 3) * 3; setFrom(fmt(new Date(n.getFullYear(), q, 1))); setTo(fmt(n)); }
    else { setFrom(fmt(new Date(n.getFullYear(), 0, 1))); setTo(fmt(n)); }
  }

  function openPdf() {
    const p = new URLSearchParams({ from, to, title: title || "Financial Report", sections: enabledKeys.join(",") });
    if (preparedFor.trim()) p.set("preparedFor", preparedFor.trim());
    if (roles.length) p.set("roles", roles.join(","));
    if (locs.length) p.set("locations", locs.join(","));
    if (holders.length) p.set("holders", holders.join(","));
    window.open(`/api/finance-report/pdf?${p.toString()}`, "_blank", "noopener");
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 340px) 1fr", gap: 18, alignItems: "start" }}>
      {/* ── Left: configuration ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14, position: "sticky", top: 12, maxHeight: "calc(100vh - 24px)", overflowY: "auto", overflowX: "hidden", paddingRight: 4 }}>
        <button className="portal-btn portal-btn-primary" style={{ width: "100%", padding: "10px 12px", fontSize: 14 }} onClick={fullSystemReport}>
          ⚡ Full System Report — everything, YTD
        </button>

        <div className="portal-card" style={{ padding: 14 }}>
          <div className="portal-card-head-title" style={{ marginBottom: 8 }}>Period</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}><span className="portal-label">From</span>
              <input type="date" className="portal-input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}><span className="portal-label">To</span>
              <input type="date" className="portal-input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {([["thisMonth", "This month"], ["lastMonth", "Last month"], ["quarter", "This quarter"], ["ytd", "YTD"]] as const).map(([k, l]) => (
              <button key={k} type="button" className="portal-btn portal-btn-ghost" style={{ padding: "3px 9px", fontSize: 11 }} onClick={() => preset(k)}>{l}</button>
            ))}
          </div>
        </div>

        <div className="portal-card" style={{ padding: 14 }}>
          <div className="portal-card-head-title" style={{ marginBottom: 2 }}>Ledger scope</div>
          <div className="muted small" style={{ marginBottom: 8 }}>Narrows only the Ledgers section. The P&L, income and expenses are always business-wide for the period.</div>
          <div style={{ display: "grid", gap: 8 }}>
            <FilterMultiSelect label="Role" values={roles} onChange={setRoles} options={opts.roles} />
            <FilterMultiSelect label="Location" values={locs} onChange={setLocs} options={opts.locations} />
            <FilterMultiSelect label="Holder" values={holders} onChange={setHolders} options={opts.holders} />
          </div>
        </div>

        <div className="portal-card" style={{ padding: 14 }}>
          <div className="portal-card-head-title" style={{ marginBottom: 8 }}>PDF layout</div>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}><span className="portal-label">Report title</span>
            <input className="portal-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Financial Report" /></label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}><span className="portal-label">Prepared for (optional)</span>
            <input className="portal-input" value={preparedFor} onChange={(e) => setPreparedFor(e.target.value)} placeholder="e.g. Jane Smith, CPA" /></label>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span className="portal-label">Sections — toggle & reorder</span>
            <button type="button" className="portal-btn portal-btn-ghost" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => setAllSections(!allOn)}>
              {allOn ? "Clear all" : "Select all"}
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {order.map((o, i) => {
              const meta = SECTIONS.find((s) => s.key === o.key)!;
              return (
                <div key={o.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, background: o.enabled ? "rgba(129,140,248,0.06)" : "transparent", textAlign: "left" }}>
                  <input type="checkbox" checked={o.enabled} onChange={() => toggle(o.key)} style={{ width: 16, height: 16, flexShrink: 0, margin: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9" }}>{meta.label}</div>
                    <div className="muted small" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{meta.hint}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
                    <button type="button" className="portal-btn portal-btn-ghost" style={{ padding: "0 6px", fontSize: 11, lineHeight: "16px" }} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                    <button type="button" className="portal-btn portal-btn-ghost" style={{ padding: "0 6px", fontSize: 11, lineHeight: "16px" }} disabled={i === order.length - 1} onClick={() => move(i, 1)}>↓</button>
                  </div>
                </div>
              );
            })}
          </div>

          <button className="portal-btn portal-btn-primary" style={{ width: "100%", marginTop: 12 }} onClick={openPdf} disabled={!data || enabledKeys.length === 0}>
            ⬇ Export PDF
          </button>
        </div>
      </div>

      {/* ── Right: live preview ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {error && <div className="portal-alert portal-alert-error">{error}</div>}
        {loading && !data && <div className="portal-card" style={{ padding: 24, textAlign: "center" }}><span className="muted">Building report…</span></div>}
        {data && (
          <>
            <div className="muted small">{loading ? "Refreshing…" : `Period ${from} → ${to}`}</div>
            {enabledKeys.length === 0 && <div className="portal-card" style={{ padding: 24, textAlign: "center" }}><span className="muted">No sections selected — enable at least one on the left.</span></div>}
            {enabledKeys.map((key) => <Section key={key} sk={key} d={data} />)}
          </>
        )}
      </div>
    </div>
  );
}

function KpiRow({ items }: { items: Array<{ label: string; value: number; tone?: boolean }> }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
      {items.map((it) => (
        <div className="portal-kpi" key={it.label} style={{ padding: "12px 14px" }}>
          <div className="portal-kpi-label">{it.label}</div>
          <div className="portal-kpi-value" style={{ fontSize: 18, color: it.tone ? (it.value >= 0 ? "#34d399" : "#f87171") : undefined }}>{money(it.value)}</div>
        </div>
      ))}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="portal-card" style={{ padding: 0, overflow: "hidden" }}>
      <div className="portal-card-head"><div className="portal-card-head-title">{title}</div></div>
      <div style={{ padding: 14 }}>{children}</div>
    </div>
  );
}

function Section({ sk, d }: { sk: SectionKey; d: FinancialReportData }) {
  if (sk === "pnl") {
    const p = d.pnl;
    return (
      <Card title="P&L Summary">
        <KpiRow items={[
          { label: "Total Revenue", value: p.totalRevenue },
          { label: "Gross Profit", value: p.grossProfit, tone: true },
          { label: "Operating Expenses", value: p.totalExpenses },
          { label: "Net Profit", value: p.netProfit, tone: true },
          { label: "Net After Disputes", value: p.netAfterDisputes, tone: true },
          { label: "Cash on Hand", value: p.cashOnHand, tone: true },
        ]} />
        <table className="portal-table" style={{ marginTop: 12 }}>
          <tbody>
            <PnlRow label="Job revenue" v={p.jobRevenue} sub />
            <PnlRow label="Manual income" v={p.manualIncome} sub />
            <PnlRow label="Total revenue" v={p.totalRevenue} strong />
            <PnlRow label="Gross profit" v={p.grossProfit} strong tone />
            <PnlRow label="Operating expenses" v={-p.totalExpenses} tone />
            <PnlRow label="Payouts" v={-p.payouts} tone />
            <PnlRow label="Net profit" v={p.netProfit} strong tone />
            <PnlRow label="Dispute impact (period)" v={p.disputeImpact} tone />
            <PnlRow label="Refund loss" v={-p.refundLoss} tone />
            <PnlRow label="Net after disputes" v={p.netAfterDisputes} strong tone />
          </tbody>
        </table>
      </Card>
    );
  }
  if (sk === "income") {
    const total = d.income.reduce((s, r) => s + r.total, 0);
    return (
      <Card title="Income breakdown">
        <table className="portal-table">
          <thead><tr><th>Source</th><th className="right">Amount</th></tr></thead>
          <tbody>
            {d.income.map((r) => <tr key={r.source}><td>{r.source === "crm_jobs" ? "CRM jobs (collected)" : r.source}</td><td className="right money">{money(r.total)}</td></tr>)}
            {d.income.length === 0 && <tr><td colSpan={2} className="muted" style={{ textAlign: "center" }}>No income in range.</td></tr>}
          </tbody>
          {d.income.length > 0 && <tfoot><tr><td style={{ fontWeight: 700 }}>Total income</td><td className="right money" style={{ fontWeight: 700 }}>{money(total)}</td></tr></tfoot>}
        </table>
      </Card>
    );
  }
  if (sk === "expenses") {
    const total = d.expenses.reduce((s, r) => s + r.total, 0);
    return (
      <Card title="Expenses breakdown">
        <table className="portal-table">
          <thead><tr><th>Category</th><th className="right">Count</th><th className="right">Amount</th></tr></thead>
          <tbody>
            {d.expenses.map((r) => <tr key={r.category}><td>{r.category || "Uncategorized"}</td><td className="right">{r.count}</td><td className="right money">{money(r.total)}</td></tr>)}
            {d.expenses.length === 0 && <tr><td colSpan={3} className="muted" style={{ textAlign: "center" }}>No expenses in range.</td></tr>}
          </tbody>
          {d.expenses.length > 0 && <tfoot><tr><td style={{ fontWeight: 700 }}>Total expenses</td><td /><td className="right money" style={{ fontWeight: 700 }}>{money(total)}</td></tr></tfoot>}
        </table>
        <div className="muted small" style={{ marginTop: 6 }}>Unpaid portion: {money(d.pnl.unpaidExpenses)}</div>
      </Card>
    );
  }
  if (sk === "disputes") {
    const x = d.disputes;
    return (
      <Card title="Disputes & Refunds impact">
        <table className="portal-table">
          <tbody>
            <PnlRow label={`Disputes filed (${x.disputeCount})`} v={x.disputeTotalAmount} sub />
            <PnlRow label="Won (returned)" v={x.disputeWonAmount} sub tone />
            <PnlRow label="Lost" v={-x.disputeLostAmount} sub tone />
            <PnlRow label="Company slice lost (filed)" v={-x.filedLoss} tone />
            <PnlRow label="Company slice recovered (won)" v={x.recoveredSlice} tone />
            <PnlRow label="Net dispute impact" v={x.impact} strong tone />
            <PnlRow label="Refund loss (company slice)" v={-x.refundLoss} strong tone />
          </tbody>
        </table>
      </Card>
    );
  }
  if (sk === "byLocation") {
    const total = d.byLocation.reduce((s, r) => s + r.total, 0);
    const count = d.byLocation.reduce((s, r) => s + r.count, 0);
    return (
      <Card title="Revenue by location">
        <table className="portal-table">
          <thead><tr><th>Location</th><th className="right">Jobs</th><th className="right">Collected</th></tr></thead>
          <tbody>
            {d.byLocation.map((r) => <tr key={r.area}><td>{r.area || "—"}</td><td className="right">{r.count}</td><td className="right money">{money(r.total)}</td></tr>)}
            {d.byLocation.length === 0 && <tr><td colSpan={3} className="muted" style={{ textAlign: "center" }}>No jobs in range.</td></tr>}
          </tbody>
          {d.byLocation.length > 0 && <tfoot><tr><td style={{ fontWeight: 700 }}>Total</td><td className="right" style={{ fontWeight: 700 }}>{count}</td><td className="right money" style={{ fontWeight: 700 }}>{money(total)}</td></tr></tfoot>}
        </table>
      </Card>
    );
  }
  if (sk === "disputesByParty") {
    const p = d.disputesByParty;
    const tbl = (title: string, rows: FinancialReportData["disputesByParty"]["byProvider"]) => (
      <div style={{ marginBottom: 12 }}>
        <div className="portal-label" style={{ marginBottom: 4 }}>{title}</div>
        <table className="portal-table">
          <thead><tr><th>Name</th><th className="right">Count</th><th className="right">Disputed</th><th className="right">Charged share</th></tr></thead>
          <tbody>
            {rows.map((g) => <tr key={g.name}><td>{g.name}</td><td className="right">{g.count}</td><td className="right money">{money(g.disputed)}</td><td className="right money">{money(g.share)}</td></tr>)}
            {rows.length === 0 && <tr><td colSpan={4} className="muted" style={{ textAlign: "center" }}>None in range.</td></tr>}
          </tbody>
        </table>
      </div>
    );
    return <Card title="Disputes by provider / tech / AM">{tbl("By provider", p.byProvider)}{tbl("By technician", p.byTechnician)}{tbl("By area manager", p.byAreaManager)}</Card>;
  }
  if (sk === "payouts") {
    const p = d.payouts;
    return (
      <Card title="Payouts">
        <KpiRow items={[{ label: "Paid", value: p.paid }, { label: "Unpaid", value: p.unpaid }]} />
        <table className="portal-table" style={{ marginTop: 12 }}>
          <thead><tr><th>Recipient</th><th>Role</th><th>Period end</th><th>Status</th><th className="right">Net</th></tr></thead>
          <tbody>
            {p.rows.map((r, i) => <tr key={i}><td>{r.recipient}</td><td className="small muted">{r.role || "—"}</td><td className="small mono">{r.periodEnd}</td><td className="small">{r.status}</td><td className="right money">{money(r.net)}</td></tr>)}
            {p.rows.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: "center" }}>No payouts in range.</td></tr>}
          </tbody>
          {p.rows.length > 0 && <tfoot><tr><td colSpan={4} style={{ fontWeight: 700 }}>Total</td><td className="right money" style={{ fontWeight: 700 }}>{money(p.paid + p.unpaid)}</td></tr></tfoot>}
        </table>
      </Card>
    );
  }
  if (sk === "debts") {
    const p = d.debts;
    return (
      <Card title="Debts & balances (open)">
        <KpiRow items={[{ label: "Open debts", value: p.openTotal, tone: true }]} />
        <table className="portal-table" style={{ marginTop: 12 }}>
          <thead><tr><th>Owes</th><th>Owed to</th><th>Reason</th><th>Due</th><th className="right">Amount</th></tr></thead>
          <tbody>
            {p.rows.map((r, i) => <tr key={i}><td>{r.from}</td><td>{r.to}</td><td className="small muted">{r.reason || "—"}</td><td className="small mono">{r.dueDate || "—"}</td><td className="right money">{money(r.amount)}</td></tr>)}
            {p.rows.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: "center" }}>No open debts.</td></tr>}
          </tbody>
          {p.rows.length > 0 && <tfoot><tr><td colSpan={4} style={{ fontWeight: 700 }}>Total open</td><td className="right money" style={{ fontWeight: 700 }}>{money(p.openTotal)}</td></tr></tfoot>}
        </table>
      </Card>
    );
  }
  if (sk === "equipment") {
    const p = d.equipment;
    return (
      <Card title="Equipment orders">
        <KpiRow items={[{ label: "AM charged", value: p.amCharge }, { label: "Company cost", value: p.companyCost }, { label: "Gross profit", value: p.grossProfit, tone: true }]} />
        <table className="portal-table" style={{ marginTop: 12 }}>
          <thead><tr><th>Order</th><th>Area manager</th><th>Date</th><th>Status</th><th className="right">AM charge</th><th className="right">Gross profit</th></tr></thead>
          <tbody>
            {p.rows.map((r, i) => <tr key={i}><td className="small mono">{r.order}</td><td>{r.areaManager}</td><td className="small mono">{r.date}</td><td className="small">{r.status}</td><td className="right money">{money(r.amCharge)}</td><td className="right money">{money(r.grossProfit)}</td></tr>)}
            {p.rows.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: "center" }}>No orders in range.</td></tr>}
          </tbody>
          {p.rows.length > 0 && <tfoot><tr><td colSpan={4} style={{ fontWeight: 700 }}>Total</td><td className="right money" style={{ fontWeight: 700 }}>{money(p.amCharge)}</td><td className="right money" style={{ fontWeight: 700 }}>{money(p.grossProfit)}</td></tr></tfoot>}
        </table>
      </Card>
    );
  }
  if (sk === "banking") {
    const p = d.banking;
    return (
      <Card title="Cash & banking">
        <KpiRow items={[{ label: "Total balance", value: p.balanceTotal, tone: true }, { label: "Money in", value: p.inflow, tone: true }, { label: "Money out", value: p.outflow, tone: true }, { label: "Net flow", value: p.net, tone: true }]} />
        <table className="portal-table" style={{ marginTop: 12 }}>
          <thead><tr><th>Account</th><th>Bank</th><th>Type</th><th className="right">Balance</th></tr></thead>
          <tbody>
            {p.accounts.map((a, i) => <tr key={i}><td>{a.label}</td><td className="small muted">{a.bank || "—"}</td><td className="small">{a.isCredit ? "Credit" : "Cash"}</td><td className="right money">{money(a.balance)}</td></tr>)}
            {p.accounts.length === 0 && <tr><td colSpan={4} className="muted" style={{ textAlign: "center" }}>No accounts synced.</td></tr>}
          </tbody>
          {p.accounts.length > 0 && <tfoot><tr><td colSpan={3} style={{ fontWeight: 700 }}>Total</td><td className="right money" style={{ fontWeight: 700 }}>{money(p.balanceTotal)}</td></tr></tfoot>}
        </table>
      </Card>
    );
  }
  // ledgers
  const L = d.ledgers;
  return (
    <Card title="Ledgers — balances to settle">
      <KpiRow items={[
        { label: "Owed to company", value: L.totalOwedToCompany, tone: true },
        { label: "Company owes", value: -L.totalCompanyOwes, tone: true },
        { label: "Net position", value: L.netPosition, tone: true },
      ]} />
      <div style={{ overflowX: "auto", marginTop: 12 }}>
        <table className="portal-table">
          <thead><tr><th>Holder</th><th>Role</th><th>Location</th><th className="right">Opening</th><th className="right">Movement</th><th className="right">Closing</th><th className="right">Current</th></tr></thead>
          <tbody>
            {L.rows.map((r) => (
              <tr key={r.id}>
                <td>{r.holderName}</td>
                <td className="small muted">{roleLabel(r.role)}</td>
                <td className="small muted">{r.location || "—"}</td>
                <td className="right money">{money(r.opening)}</td>
                <td className="right money">{money(r.movement)}</td>
                <td className="right money">{money(r.closing)}</td>
                <td className="right money" style={{ fontWeight: 700, color: r.current > 0 ? "#34d399" : r.current < 0 ? "#f87171" : undefined }}>{money(r.current)}</td>
              </tr>
            ))}
            {L.rows.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: "center" }}>No ledgers match the scope.</td></tr>}
          </tbody>
          {L.rows.length > 0 && <tfoot><tr><td style={{ fontWeight: 700 }} colSpan={6}>Net position</td><td className="right money" style={{ fontWeight: 700 }}>{money(L.netPosition)}</td></tr></tfoot>}
        </table>
      </div>
      <div className="muted small" style={{ marginTop: 8 }}>Positive = they owe the company (collect); negative = the company owes them (pay out). Opening/Movement/Closing are for the period; Current is the live balance to settle now.</div>
    </Card>
  );
}

function PnlRow({ label, v, sub, strong, tone }: { label: string; v: number; sub?: boolean; strong?: boolean; tone?: boolean }) {
  return (
    <tr>
      <td style={{ paddingLeft: sub ? 24 : undefined, color: sub ? "#94a3b8" : undefined, fontWeight: strong ? 700 : undefined }}>{sub ? "↳ " : ""}{label}</td>
      <td className="right money" style={{ fontWeight: strong ? 700 : undefined, color: tone ? (v >= 0 ? "#34d399" : "#f87171") : undefined }}>{money(v)}</td>
    </tr>
  );
}
