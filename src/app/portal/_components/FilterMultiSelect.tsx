"use client";

// A controlled multi-select for the ledger dispute/refund/penalty picker filters:
// a button showing how many are chosen, expanding inline to a searchable checkbox
// list. Controlled via values/onChange (distinct from the form-based MultiSelect).

import { useState } from "react";

export default function FilterMultiSelect({
  label, values, onChange, options,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  options: string[];
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const toggle = (v: string) => onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  const shown = q.trim() ? options.filter((o) => o.toLowerCase().includes(q.trim().toLowerCase())) : options;

  return (
    <div>
      <label className="portal-label" style={{ fontSize: 11 }}>{label}{values.length ? ` · ${values.length}` : ""}</label>
      <button
        type="button"
        className="portal-input"
        onClick={() => setOpen((o) => !o)}
        style={{ padding: "6px 8px", textAlign: "left", cursor: "pointer", width: "100%" }}
      >
        {values.length === 0 ? "All" : values.length <= 2 ? values.join(", ") : `${values.length} selected`} {open ? "▲" : "▼"}
      </button>
      {open && (
        <div style={{ marginTop: 4, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, background: "#0b1220", maxHeight: 200, overflowY: "auto" }}>
          <input className="portal-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" style={{ padding: "5px 8px", margin: 6, width: "calc(100% - 12px)", fontSize: 12 }} />
          {values.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="portal-btn portal-btn-ghost" style={{ padding: "2px 8px", fontSize: 11, margin: "0 6px 4px" }}>Clear</button>
          )}
          {shown.length === 0 ? (
            <div className="muted small" style={{ padding: "6px 10px" }}>No matches.</div>
          ) : shown.map((o) => (
            <label key={o} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>
              <input type="checkbox" checked={values.includes(o)} onChange={() => toggle(o)} style={{ width: 14, height: 14 }} />
              {o}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
