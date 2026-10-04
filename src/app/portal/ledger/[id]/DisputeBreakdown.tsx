"use client";

// "View more" breakdown for a dispute/refund ledger entry. Reads the stored
// charge_snapshot and shows the address + the full cost-share split, so the
// Area Manager can see exactly how much to charge the technician.

import { useState } from "react";

const money = (n: number) => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const partyLabel = (p: string) =>
  p === "area_manager" ? "area manager" : p === "combined" ? "AM + technician" : p;

function Line({ label, v, strong, hi }: { label: string; v: number; strong?: boolean; hi?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "2px 0" }}>
      <span className="small" style={{ color: hi ? "#c7d2fe" : undefined, fontWeight: strong ? 700 : undefined }}>{label}</span>
      <span className="small money" style={{ fontWeight: strong ? 700 : undefined, color: hi ? "#c7d2fe" : undefined }}>{money(v)}</span>
    </div>
  );
}

export default function DisputeBreakdown({ snapshot }: { snapshot?: Record<string, unknown> | null }) {
  const [open, setOpen] = useState(false);
  if (!snapshot) return null;
  const n = (k: string) => Number(snapshot[k]) || 0;
  const str = (k: string) => (snapshot[k] == null ? "" : String(snapshot[k]));
  const party = str("posted_party");

  return (
    <div style={{ marginTop: 6 }}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="portal-btn portal-btn-ghost" style={{ padding: "2px 8px", fontSize: 11 }}>
        {open ? "▾ Hide details" : "▸ View more"}
      </button>
      {open && (
        <div style={{ marginTop: 8, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 10, background: "rgba(255,255,255,0.02)", maxWidth: 420 }}>
          {str("address") && <div className="small" style={{ marginBottom: 2 }}><span className="muted">Address: </span>{str("address")}</div>}
          {str("customer_name") && <div className="small" style={{ marginBottom: 6 }}><span className="muted">Customer: </span>{str("customer_name")}</div>}

          <div className="muted small" style={{ textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Cost-share breakdown</div>
          <Line label="Technician share — charge the tech this" v={n("technicianPortion")} strong hi />
          <Line label="Area manager own share" v={n("areaManagerOwnPortion")} />
          <Line label="Provider" v={n("providerCharge")} />
          <Line label="Company" v={n("companyCharge")} />
          <Line label="Total AM ledger charge (tech + AM)" v={n("amLedgerCharge")} strong />

          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", marginTop: 6, paddingTop: 6 }}>
            <Line label={`Dispute / refund amount${str("disputeClassification") ? ` · ${str("disputeClassification")}` : ""}`} v={n("disputeOrRefundAmount")} />
            {party && <Line label={`Posted to this ledger · ${partyLabel(party)}`} v={n("posted_amount")} strong />}
          </div>
        </div>
      )}
    </div>
  );
}
