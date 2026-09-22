"use client";

// Expandable breakdown for a CRM-report ledger entry. Organizes closed jobs into
// Monday–Sunday weeks; each row is one technician showing BOTH their Tech-report
// balance and their Location-report balance for that week, with buttons to open
// the CRM balance-report PDF (tech / location) for that tech + week.

import { useState } from "react";
import type { LedgerReportMeta } from "@/types/finance-ledger";

const money = (n: number | undefined, sign = false) => {
  if (n == null) return "—";
  const v = Math.round(n * 100) / 100;
  const s = `$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return v < 0 ? `-${s}` : sign && v > 0 ? `+${s}` : s;
};

function pdfUrl(mode: "tech" | "location", tech: string, start: string, end: string) {
  const p = new URLSearchParams({ mode, tech, startDate: start, endDate: end });
  return `/api/balance-report/pdf?${p.toString()}`;
}

const pdfBtn: React.CSSProperties = { padding: "2px 8px", fontSize: 11, marginRight: 4 };

export default function ReportBreakdown({ meta }: { meta: LedgerReportMeta }) {
  const [open, setOpen] = useState(false);

  // Provider report: a flat per-job table (date / address / tech / profit / share).
  if (meta.mode === "provider") {
    const jobs = meta.provider_jobs ?? [];
    if (jobs.length === 0) {
      return <div className="muted small" style={{ marginTop: 4, fontStyle: "italic" }}>No jobs in this provider report.</div>;
    }
    return (
      <div style={{ marginTop: 6 }}>
        <button type="button" onClick={() => setOpen((o) => !o)} className="portal-btn portal-btn-ghost" style={{ padding: "2px 8px", fontSize: 11 }}>
          {open ? "▾ Hide breakdown" : `▸ Job breakdown (${jobs.length} job${jobs.length > 1 ? "s" : ""})`}
        </button>
        {open && (
          <div style={{ marginTop: 8, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 10, background: "rgba(255,255,255,0.02)", overflowX: "auto" }}>
            <table className="portal-table" style={{ margin: 0, fontSize: 12 }}>
              <thead>
                <tr><th>Date</th><th>Address</th><th>Provider</th><th>Tech</th><th className="right">Payment</th><th className="right">Profit</th><th className="right">Provider share</th></tr>
              </thead>
              <tbody>
                {jobs.map((j, i) => (
                  <tr key={`${j.date}-${i}`}>
                    <td className="mono">{j.date || "—"}</td>
                    <td>{j.address || "—"}</td>
                    <td className="muted">{j.provider || "—"}</td>
                    <td>{j.tech || "—"}</td>
                    <td className="right">{money(j.total_payment)}</td>
                    <td className="right">{money(j.total_profit)}</td>
                    <td className="right">{money(j.provider_share)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} style={{ fontWeight: 700 }}>Total</td>
                  <td className="right" style={{ fontWeight: 700 }}>{money(jobs.reduce((s, j) => s + j.total_payment, 0))}</td>
                  <td className="right" style={{ fontWeight: 700 }}>{money(jobs.reduce((s, j) => s + j.total_profit, 0))}</td>
                  <td className="right" style={{ fontWeight: 700 }}>{money(meta.provider_share ?? jobs.reduce((s, j) => s + j.provider_share, 0))}</td>
                </tr>
              </tfoot>
            </table>
            <div className="muted small" style={{ marginTop: 4 }}>Posted as the company owing the provider (negative on the ledger).</div>
          </div>
        )}
      </div>
    );
  }

  const weeks = meta.weeks ?? [];
  const withTips = meta.include_tips;

  // Older report entries (pulled before the weekly breakdown) have no weeks[].
  if (weeks.length === 0) {
    return (
      <div className="muted small" style={{ marginTop: 4, fontStyle: "italic" }}>
        Re-pull this report to see the weekly technician breakdown.
      </div>
    );
  }

  return (
    <div style={{ marginTop: 6 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="portal-btn portal-btn-ghost"
        style={{ padding: "2px 8px", fontSize: 11 }}
      >
        {open ? "▾ Hide breakdown" : `▸ Weekly breakdown (${weeks.length} week${weeks.length > 1 ? "s" : ""})`}
      </button>

      {open && (
        <div style={{ marginTop: 8, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 10, background: "rgba(255,255,255,0.02)" }}>
          {weeks.map((w) => (
            <div key={w.week_start} style={{ marginBottom: 14 }}>
              <div className="muted small" style={{ fontWeight: 600, marginBottom: 4 }}>
                Week {w.week_start} → {w.week_end}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="portal-table" style={{ margin: 0, fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th>Technician</th>
                      <th className="right">Tech report</th>
                      <th className="right">Location report</th>
                      <th className="right">Jobs</th>
                      <th>Preview</th>
                    </tr>
                  </thead>
                  <tbody>
                    {w.techs.map((t) => (
                      <tr key={t.name}>
                        <td>{t.name}</td>
                        <td className="right">{money(withTips ? t.tech_balance_with_tips : t.tech_balance, true)}</td>
                        <td className="right">{money(withTips ? t.location_balance_with_tips : t.location_balance, true)}</td>
                        <td className="right">{t.job_count}</td>
                        <td>
                          <a href={pdfUrl("tech", t.name, w.week_start, w.week_end)} target="_blank" rel="noopener noreferrer" className="portal-btn portal-btn-ghost" style={pdfBtn}>Tech PDF</a>
                          <a href={pdfUrl("location", t.name, w.week_start, w.week_end)} target="_blank" rel="noopener noreferrer" className="portal-btn portal-btn-ghost" style={pdfBtn}>Loc PDF</a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {withTips && <div className="muted small" style={{ marginTop: 2 }}>Amounts include tips.</div>}
        </div>
      )}
    </div>
  );
}
