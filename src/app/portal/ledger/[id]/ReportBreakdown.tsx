"use client";

// Expandable breakdown for a CRM-report ledger entry. Renders the stored
// report_meta snapshot: each technician (for a location report) with their
// closed jobs and per-job money detail — so a location report can be read
// technician-by-technician instead of as one combined number.

import { useState } from "react";
import type { LedgerReportMeta } from "@/types/finance-ledger";

const money = (n: number | undefined, sign = false) => {
  if (n == null) return "—";
  const v = Math.round(n * 100) / 100;
  const s = `$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return v < 0 ? `-${s}` : sign && v > 0 ? `+${s}` : s;
};

type JobRow = NonNullable<LedgerReportMeta["jobs"]>[number];

function JobTable({ jobs }: { jobs: JobRow[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="portal-table" style={{ margin: 0, fontSize: 12 }}>
        <thead>
          <tr>
            <th>Date</th><th>Address</th>
            <th className="right">Job total</th><th className="right">Fee</th>
            <th className="right">Parts</th><th className="right">Profit</th>
            <th className="right">Payout</th><th className="right">Balance</th><th className="right">+Tips</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id || `${j.date}-${j.address}`}>
              <td className="small mono">{j.date || "—"}</td>
              <td className="small">{j.address || "—"}</td>
              <td className="right">{money(j.job_total)}</td>
              <td className="right">{money(j.payment_fee)}</td>
              <td className="right">{money(j.parts)}</td>
              <td className="right">{money(j.total_profit)}</td>
              <td className="right">{money(j.payout)}</td>
              <td className="right">{money(j.balance, true)}</td>
              <td className="right">{money(j.balance_with_tips, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ReportBreakdown({ meta }: { meta: LedgerReportMeta }) {
  const [open, setOpen] = useState(false);
  const jobs = meta.jobs ?? [];
  const techs = meta.techs ?? [];

  // Group jobs by technician (the "see each, not all together" split).
  const jobsByTech = new Map<string, JobRow[]>();
  for (const j of jobs) {
    const k = j.tech || "—";
    const arr = jobsByTech.get(k);
    if (arr) arr.push(j); else jobsByTech.set(k, [j]);
  }

  if (jobs.length === 0 && techs.length === 0) return null;

  return (
    <div style={{ marginTop: 6 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="portal-btn portal-btn-ghost"
        style={{ padding: "2px 8px", fontSize: 11 }}
      >
        {open ? "▾ Hide breakdown" : `▸ Breakdown (${techs.length ? `${techs.length} techs · ` : ""}${jobs.length} jobs)`}
      </button>

      {open && (
        <div style={{ marginTop: 8, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 10, background: "rgba(255,255,255,0.02)" }}>
          {techs.length > 0 ? (
            // Location report → one section per technician.
            techs.map((t) => (
              <div key={t.name} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
                  <strong style={{ fontSize: 13 }}>{t.name}</strong>
                  <span className="muted small">
                    {t.job_count} job(s) · Balance {money(t.balance, true)} · +Tips {money(t.balance_with_tips, true)}
                  </span>
                </div>
                {(jobsByTech.get(t.name)?.length)
                  ? <JobTable jobs={jobsByTech.get(t.name)!} />
                  : <div className="muted small" style={{ padding: "2px 0" }}>No closed jobs.</div>}
              </div>
            ))
          ) : (
            // Tech report → a single job table.
            <JobTable jobs={jobs} />
          )}
        </div>
      )}
    </div>
  );
}
