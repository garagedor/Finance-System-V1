"use client";

import { useState } from "react";
import Papa from "papaparse";

type Target = "expense" | "income";

const FIELDS: Record<Target, string[]> = {
  expense: ["date", "amount", "category", "vendor_name", "payment_method", "notes", "status"],
  income: ["date", "amount", "source", "customer_name", "payment_method", "notes"],
};

interface PreviewResult {
  total_rows: number;
  valid: number;
  errors: number;
  error_messages: string[];
  sample: { ok: boolean; doc: Record<string, unknown>; errors: string[] }[];
}

export default function ImportClient() {
  const [target, setTarget] = useState<Target>("expense");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState<{ inserted: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onFile(file: File | null) {
    if (!file) return;
    setError(null);
    setPreview(null);
    setCommitted(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const hs = res.meta.fields ?? [];
        setHeaders(hs);
        setRows(res.data);
        // Auto-map by exact name match
        const auto: Record<string, string> = {};
        for (const h of hs) {
          const key = h.toLowerCase().replace(/[^a-z]/g, "");
          for (const f of FIELDS[target]) {
            if (key === f.toLowerCase().replace(/[^a-z]/g, "") || key === f.split("_")[0]) {
              auto[h] = f;
              break;
            }
          }
        }
        setMapping(auto);
      },
      error: (err) => setError(err.message),
    });
  }

  function setMap(h: string, field: string) {
    setMapping((m) => ({ ...m, [h]: field }));
  }

  async function runPreview() {
    setError(null);
    setCommitted(null);
    try {
      const res = await fetch("/api/portal/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, mapping, rows, dry_run: true }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Preview failed");
      setPreview(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    }
  }

  async function commit() {
    if (!preview || preview.errors > 0 || preview.valid === 0) return;
    if (!confirm(`Insert ${preview.valid} ${target} row(s)? This cannot be undone (delete manually if wrong).`)) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, mapping, rows, dry_run: false }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Commit failed");
      setCommitted({ inserted: j.inserted });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Commit failed");
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <label className="portal-label">Import into</label>
        <select
          className="portal-select"
          value={target}
          onChange={(e) => {
            setTarget(e.target.value as Target);
            setMapping({});
            setPreview(null);
            setCommitted(null);
          }}
        >
          <option value="expense">Expenses</option>
          <option value="income">Income</option>
        </select>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          style={{ fontSize: 13 }}
        />
        {rows.length > 0 && (
          <span className="muted small">
            {rows.length} row{rows.length === 1 ? "" : "s"} parsed
          </span>
        )}
      </div>

      {headers.length > 0 && (
        <div>
          <h4 style={{ margin: "8px 0" }}>Column mapping</h4>
          <p className="muted small">Map each CSV column to a field. Leave blank to skip.</p>
          <table className="portal-table">
            <thead>
              <tr>
                <th>CSV column</th>
                <th>→ Field</th>
                <th>Sample value</th>
              </tr>
            </thead>
            <tbody>
              {headers.map((h) => (
                <tr key={h}>
                  <td className="mono small">{h}</td>
                  <td>
                    <select
                      value={mapping[h] ?? ""}
                      onChange={(e) => setMap(h, e.target.value)}
                      className="portal-select"
                    >
                      <option value="">(skip)</option>
                      {FIELDS[target].map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                  </td>
                  <td className="muted small mono">{rows[0]?.[h] ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button className="portal-btn portal-btn-primary" onClick={runPreview}>
              Preview
            </button>
            {preview && preview.errors === 0 && preview.valid > 0 && (
              <button
                className="portal-btn"
                onClick={commit}
                disabled={committing}
                style={{ borderColor: "#22c55e", color: "#bbf7d0" }}
              >
                {committing ? "Inserting…" : `Insert ${preview.valid} row(s)`}
              </button>
            )}
          </div>
        </div>
      )}

      {error && <div className="portal-alert portal-alert-error">{error}</div>}

      {preview && !committed && (
        <div>
          <h4 style={{ margin: "8px 0" }}>
            Preview: {preview.valid} valid / {preview.errors} error{preview.errors === 1 ? "" : "s"} (of {preview.total_rows})
          </h4>
          {preview.error_messages.length > 0 && (
            <div className="portal-alert portal-alert-warn">
              <strong>Errors:</strong>
              <ul style={{ margin: "6px 0 0 20px", paddingLeft: 0 }}>
                {preview.error_messages.map((m, i) => (
                  <li key={i} className="small mono">{m}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="muted small" style={{ marginTop: 10 }}>First 5 rows (normalised):</p>
          <pre style={{ background: "#0a0f1c", padding: 10, borderRadius: 6, fontSize: 12, maxHeight: 220, overflowY: "auto" }}>
{JSON.stringify(preview.sample, null, 2)}
          </pre>
        </div>
      )}

      {committed && (
        <div className="portal-alert portal-alert-info">
          Imported <strong>{committed.inserted}</strong> {target} row(s). View them in the corresponding module.
        </div>
      )}
    </div>
  );
}
