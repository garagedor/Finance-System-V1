"use client";

// A dropdown multi-select that plays nice with a plain GET <form>: the visible
// UI is a button + checkbox panel, and the selected values are submitted via
// hidden inputs (repeated `name`), so the server reads them as an array. No
// change to the surrounding form/submit flow.

import { useEffect, useRef, useState } from "react";

export default function MultiSelect({
  name,
  options,
  selected,
  labels,
  placeholder = "All",
}: {
  name: string;
  options: string[];
  selected: string[];
  labels?: Record<string, string>;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string[]>(selected);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const label = (v: string) => labels?.[v] ?? v;
  const toggle = (opt: string) =>
    setSel((s) => (s.includes(opt) ? s.filter((x) => x !== opt) : [...s, opt]));

  const summary =
    sel.length === 0 ? placeholder : sel.length === 1 ? label(sel[0]) : `${sel.length} selected`;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* Actual submitted values */}
      {sel.map((v) => <input key={v} type="hidden" name={name} value={v} />)}

      <button
        type="button"
        className="portal-select"
        onClick={() => setOpen((o) => !o)}
        style={{ textAlign: "left", minWidth: 150, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: sel.length ? undefined : "#94a3b8" }}>{summary}</span>
        <span style={{ opacity: 0.6, fontSize: 10 }}>▾</span>
      </button>

      {open && (
        <div
          className="portal-card"
          style={{ position: "absolute", zIndex: 60, top: "calc(100% + 4px)", left: 0, minWidth: "100%", width: "max-content", maxWidth: 280, maxHeight: 280, overflowY: "auto", padding: 6, boxShadow: "0 10px 30px rgba(0,0,0,0.4)" }}
        >
          {sel.length > 0 && (
            <button
              type="button"
              onClick={() => setSel([])}
              className="portal-btn portal-btn-ghost"
              style={{ width: "100%", justifyContent: "flex-start", padding: "4px 8px", fontSize: 11, marginBottom: 4 }}
            >
              Clear ({sel.length})
            </button>
          )}
          {options.length === 0 ? (
            <div className="muted small" style={{ padding: 8 }}>No options.</div>
          ) : (
            options.map((opt) => (
              <label key={opt} style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 6px", cursor: "pointer", borderRadius: 6 }}>
                <input type="checkbox" checked={sel.includes(opt)} onChange={() => toggle(opt)} />
                <span className="small">{label(opt)}</span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}
