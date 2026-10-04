"use client";

// Renders a precomputed DisputeDetail (address + cost-share lines) for the web —
// used by the ledger page's "view more" and inline under report lines.

import type { DisputeDetail, DisputeLine } from "@/lib/dispute-detail";

function Line({ l }: { l: DisputeLine }) {
  if (l.head) {
    return <div className="muted small" style={{ textTransform: "uppercase", letterSpacing: 0.5, marginTop: 8, marginBottom: 2 }}>{l.label}</div>;
  }
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "2px 0", paddingLeft: l.sub ? 12 : 0 }}>
      <span className="small" style={{ color: l.hi ? "#c7d2fe" : l.sub ? "#94a3b8" : undefined, fontWeight: l.strong ? 700 : undefined }}>{l.label}</span>
      <span className="small money" style={{ fontWeight: l.strong ? 700 : undefined, color: l.hi ? "#c7d2fe" : undefined }}>{l.value}</span>
    </div>
  );
}

export default function DisputeDetailLines({ detail, inline = false }: { detail: DisputeDetail; inline?: boolean }) {
  if (!detail || detail.lines.length === 0) return null;
  return (
    <div style={{ marginTop: inline ? 4 : 8, border: inline ? "none" : "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: inline ? "0 0 0 8px" : 10, background: inline ? "transparent" : "rgba(255,255,255,0.02)", maxWidth: 460 }}>
      {detail.address && <div className="small" style={{ marginBottom: 2 }}><span className="muted">Address: </span>{detail.address}</div>}
      {detail.customer && <div className="small" style={{ marginBottom: 2 }}><span className="muted">Customer: </span>{detail.customer}</div>}
      {detail.tech && <div className="small" style={{ marginBottom: 2 }}><span className="muted">Technician: </span>{detail.tech}</div>}
      {detail.lines.map((l, i) => <Line key={i} l={l} />)}
    </div>
  );
}
