"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

const REPORT_TYPES = [
  { value: "tech_report", label: "Tech Report" },
  { value: "area_manager_report", label: "Area Manager / Location Report" },
  { value: "provider_report", label: "Provider Report" },
  { value: "employee_payout_report", label: "Employee Payout Report" },
  { value: "debt_statement", label: "Debt Statement" },
  { value: "settlement_statement", label: "Settlement Statement" },
  { value: "expense_report", label: "Expense Report" },
];

export default function GenerateReportForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("tech_report");
  const [subject, setSubject] = useState({ id: "", name: "" });
  const [period, setPeriod] = useState({ start: firstOfMonth(), end: today() });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      // Generate snapshot from CRM endpoint depending on type
      let snapshot: unknown = null;
      let title = `${REPORT_TYPES.find((t) => t.value === type)?.label} · ${period.start} → ${period.end}`;
      if (type === "tech_report") {
        if (!subject.name) {
          setErr("Tech name is required for Tech Report");
          return;
        }
        const url = `/api/balance-report?tech=${encodeURIComponent(subject.name)}&mode=tech&startDate=${period.start}&endDate=${period.end}`;
        const r = await fetch(url);
        snapshot = await r.json();
        title = `Tech Report · ${subject.name} · ${period.start} → ${period.end}`;
      } else if (type === "area_manager_report") {
        if (!subject.name) {
          setErr("Location/Area name is required for Area Manager Report");
          return;
        }
        const url = `/api/balance-report?tech=${encodeURIComponent(subject.name)}&mode=location&startDate=${period.start}&endDate=${period.end}`;
        const r = await fetch(url);
        snapshot = await r.json();
        title = `Area Manager Report · ${subject.name} · ${period.start} → ${period.end}`;
      } else if (type === "expense_report") {
        const r = await fetch(`/api/portal/expenses?from=${period.start}&to=${period.end}&limit=1000`);
        snapshot = await r.json();
      } else if (type === "debt_statement") {
        const r = await fetch(`/api/portal/debts?status=open`);
        snapshot = await r.json();
      } else if (type === "settlement_statement") {
        const r = await fetch(`/api/portal/settlements`);
        snapshot = await r.json();
      } else if (type === "employee_payout_report") {
        const r = await fetch(`/api/portal/payouts?from=${period.start}&to=${period.end}`);
        snapshot = await r.json();
      } else if (type === "provider_report") {
        const r = await fetch(`/api/report?type=provider&startDate=${period.start}&endDate=${period.end}`);
        snapshot = await r.json();
      }
      // Save
      const saveRes = await fetch("/api/portal/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          title,
          subject_id: subject.id || null,
          subject_name: subject.name || null,
          period_start: period.start,
          period_end: period.end,
          snapshot,
          status: "unpaid",
        }),
      });
      if (!saveRes.ok) {
        const j = await saveRes.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${saveRes.status}`);
      }
      const saved = await saveRes.json();
      setOpen(false);
      router.push(`/portal/reports/${saved.row._id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="portal-btn portal-btn-primary" onClick={() => setOpen(true)}>+ Generate report</button>

      {open && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "flex-start", justifyContent: "center",
            zIndex: 100, paddingTop: 60, overflowY: "auto",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            style={{
              background: "#111827", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14,
              padding: 24, width: "min(560px, 95vw)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Generate new report</h2>
              <button onClick={() => setOpen(false)} className="portal-btn portal-btn-ghost"
                style={{ padding: "4px 10px", fontSize: 12 }}>✕</button>
            </div>

            <form onSubmit={onSubmit}>
              <div style={{ marginBottom: 12 }}>
                <label className="portal-label">Report type *</label>
                <select className="portal-select" value={type} onChange={(e) => setType(e.target.value)} required>
                  {REPORT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              {(type === "tech_report" || type === "area_manager_report") && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                  <div>
                    <label className="portal-label">
                      {type === "tech_report" ? "Tech name *" : "Location / Area *"}
                    </label>
                    <input className="portal-input" required
                      value={subject.name}
                      onChange={(e) => setSubject({ ...subject, name: e.target.value })}
                      placeholder={type === "tech_report" ? "e.g. Bar" : "e.g. Indianapolis"} />
                  </div>
                  <div>
                    <label className="portal-label">Subject ID (optional)</label>
                    <input className="portal-input"
                      value={subject.id}
                      onChange={(e) => setSubject({ ...subject, id: e.target.value })} />
                  </div>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                <div>
                  <label className="portal-label">Period start *</label>
                  <input type="date" className="portal-input" required
                    value={period.start}
                    onChange={(e) => setPeriod({ ...period, start: e.target.value })} />
                </div>
                <div>
                  <label className="portal-label">Period end *</label>
                  <input type="date" className="portal-input" required
                    value={period.end}
                    onChange={(e) => setPeriod({ ...period, end: e.target.value })} />
                </div>
              </div>

              {err && <div className="portal-alert portal-alert-error" style={{ marginBottom: 10 }}>{err}</div>}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="portal-btn portal-btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
                <button type="submit" className="portal-btn portal-btn-primary" disabled={busy}>
                  {busy ? "Generating…" : "Generate"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function today(): string { return new Date().toISOString().slice(0, 10); }
function firstOfMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
