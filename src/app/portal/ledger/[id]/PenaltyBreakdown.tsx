"use client";

// Expandable breakdown for a CONSOLIDATED penalty ledger entry. The entry is one
// line (Σ AM 50%); clicking reveals each X-close job that made it up.

import { useState } from "react";

export type PenaltyLine = {
  job_ref: string;
  address: string;
  tech: string;
  provider: string;
  date: string;
  job_profit: number;
  total_loss: number;
  am_loss: number;
  company_loss: number;
  provider_percent: number;
};

const money = (n: number | undefined) => {
  if (n == null) return "—";
  const v = Math.round(n * 100) / 100;
  const s = `$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return v < 0 ? `-${s}` : s;
};

export default function PenaltyBreakdown({ penalties }: { penalties: PenaltyLine[] }) {
  const [open, setOpen] = useState(false);
  if (!Array.isArray(penalties) || penalties.length === 0) return null;

  return (
    <div style={{ marginTop: 6 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="portal-btn portal-btn-ghost"
        style={{ padding: "2px 8px", fontSize: 11 }}
      >
        {open ? "▾ Hide breakdown" : `▸ Breakdown (${penalties.length} penalt${penalties.length > 1 ? "ies" : "y"})`}
      </button>

      {open && (
        <div style={{ marginTop: 8, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 10, background: "rgba(255,255,255,0.02)", overflowX: "auto" }}>
          <table className="portal-table" style={{ margin: 0, fontSize: 12 }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Address</th>
                <th>Tech</th>
                <th>Provider</th>
                <th className="right">Job profit</th>
                <th className="right">Total loss</th>
                <th className="right">AM 50%</th>
              </tr>
            </thead>
            <tbody>
              {penalties.map((p, i) => (
                <tr key={`${p.job_ref}-${i}`}>
                  <td className="mono">{p.date || "—"}</td>
                  <td>{p.address || "—"}</td>
                  <td>{p.tech || "—"}</td>
                  <td className="muted">{p.provider || "—"}</td>
                  <td className="right">{money(p.job_profit)}</td>
                  <td className="right">{money(p.total_loss)}</td>
                  <td className="right">{money(p.am_loss)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} style={{ fontWeight: 700 }}>Total</td>
                <td className="right" style={{ fontWeight: 700 }}>{money(penalties.reduce((s, p) => s + p.job_profit, 0))}</td>
                <td className="right" style={{ fontWeight: 700 }}>{money(penalties.reduce((s, p) => s + p.total_loss, 0))}</td>
                <td className="right" style={{ fontWeight: 700 }}>{money(penalties.reduce((s, p) => s + p.am_loss, 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
