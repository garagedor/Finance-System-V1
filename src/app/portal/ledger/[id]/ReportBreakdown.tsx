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
