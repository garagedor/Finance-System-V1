"use client";

// Editable technician dispute/refund rates. The default is the CRM profit %;
// set an override here only for special agreements that differ from it.

import { useState } from "react";
import type { TechRateView } from "@/types/finance-ledger";

export default function TechRatesTable({ initial }: { initial: TechRateView[] }) {
  const [rows, setRows] = useState(initial);
  const [drafts, setDrafts] = useState<Record<string, string>>(
    Object.fromEntries(initial.map((r) => [r.name, r.override_pct != null ? String(r.override_pct) : ""])),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  async function save(name: string, clear: boolean) {
    setBusy(name);
    setErr(null);
    try {
      const res = await fetch("/api/portal/ledger/tech-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, dispute_pct: clear ? null : drafts[name] }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setRows((prev) =>
        prev.map((r) => {
          if (r.name !== name) return r;
          const override = clear ? null : Number(drafts[name]);
          return { ...r, override_pct: override, effective_pct: override ?? r.profit_pct };
        }),
      );
      if (clear) setDrafts((d) => ({ ...d, [name]: "" }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  const filtered = q
    ? rows.filter((r) =>
        r.name.toLowerCase().includes(q.toLowerCase()) ||
        (r.location ?? "").toLowerCase().includes(q.toLowerCase()))
    : rows;

  return (
    <>
      {err && <div className="portal-alert portal-alert-error" style={{ marginBottom: 10 }}>{err}</div>}
      <div style={{ marginBottom: 10 }}>
        <input
          className="portal-input"
          placeholder="Filter by name or location…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ maxWidth: 320 }}
        />
      </div>
      <table className="portal-table">
        <thead>
          <tr>
            <th>Technician</th>
            <th>Location</th>
            <th className="right">Profit %</th>
            <th className="right">Override %</th>
            <th className="right">Effective %</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => {
            const draft = drafts[r.name] ?? "";
            const hasOverride = r.override_pct != null;
            return (
              <tr key={r.name}>
                <td><strong>{r.name}</strong></td>
                <td className="muted small">{r.location ?? "—"}</td>
                <td className="right muted">{r.profit_pct}%</td>
                <td className="right">
                  <input
                    type="number"
                    step="0.5"
                    className="portal-input"
                    value={draft}
                    placeholder="—"
                    onChange={(e) => setDrafts((d) => ({ ...d, [r.name]: e.target.value }))}
                    style={{ width: 90, textAlign: "right", display: "inline-block" }}
                  />
                </td>
                <td className="right">
                  <strong className={hasOverride ? "money-pos" : undefined}>{r.effective_pct}%</strong>
                </td>
                <td className="right" style={{ whiteSpace: "nowrap" }}>
                  <button
                    className="portal-btn"
                    style={{ padding: "4px 10px", fontSize: 11 }}
                    disabled={busy === r.name}
                    onClick={() => save(r.name, false)}
                  >
                    {busy === r.name ? "…" : "Save"}
                  </button>
                  {hasOverride && (
                    <button
                      className="portal-btn portal-btn-ghost"
                      style={{ padding: "4px 10px", fontSize: 11, marginLeft: 6 }}
                      disabled={busy === r.name}
                      onClick={() => save(r.name, true)}
                    >
                      Clear
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
