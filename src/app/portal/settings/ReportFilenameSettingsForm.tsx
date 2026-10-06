"use client";

// Settings UI to manage the download-filename pattern for each report PDF.
// Loads the current patterns from the API, lets the user edit each one with
// clickable token chips + a live preview, and saves back. Applies everywhere a
// report is downloaded (balance / stats / finance / custom).

import { useCallback, useEffect, useRef, useState } from "react";
import {
  REPORT_FILENAME_DEFAULTS,
  REPORT_LABELS,
  REPORT_TOKENS,
  buildReportFilename,
  type ReportFilenamePatterns,
  type ReportKind,
} from "@/lib/report-filename-format";

const KINDS: ReportKind[] = ["balance", "stats", "finance", "custom"];

// Sample token values so the preview shows a realistic filename as you type.
const SAMPLE: Record<ReportKind, Record<string, string>> = {
  balance: { mode: "Tech", subject: "John Smith", tech: "John Smith", location: "Miami", start: "2026-01-01", end: "2026-01-31", today: "2026-10-06" },
  stats: { subject: "All Techs", start: "2026-01-01", end: "2026-01-31", today: "2026-10-06" },
  finance: { subject: "Monthly P&L", preparedFor: "Owner", start: "2026-01-01", end: "2026-01-31", today: "2026-10-06" },
  custom: { subject: "Equipment Review", preparedFor: "Owner", start: "2026-01-01", end: "2026-01-31", today: "2026-10-06" },
};

export default function ReportFilenameSettingsForm() {
  const [patterns, setPatterns] = useState<ReportFilenamePatterns>(REPORT_FILENAME_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const inputs = useRef<Partial<Record<ReportKind, HTMLInputElement | null>>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/portal/settings/report-filenames");
        const j = await r.json();
        if (alive && j.patterns) setPatterns({ ...REPORT_FILENAME_DEFAULTS, ...j.patterns });
      } catch {
        /* keep defaults */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const setOne = useCallback((kind: ReportKind, value: string) => {
    setPatterns((p) => ({ ...p, [kind]: value }));
    setMsg(null);
  }, []);

  // Insert a {token} at the cursor of that report's input.
  const insertToken = useCallback((kind: ReportKind, token: string) => {
    const el = inputs.current[kind];
    const piece = `{${token}}`;
    setPatterns((p) => {
      const cur = p[kind] ?? "";
      if (!el) return { ...p, [kind]: cur + piece };
      const s = el.selectionStart ?? cur.length;
      const e = el.selectionEnd ?? cur.length;
      const next = cur.slice(0, s) + piece + cur.slice(e);
      // Restore cursor after React re-renders.
      requestAnimationFrame(() => {
        el.focus();
        const pos = s + piece.length;
        el.setSelectionRange(pos, pos);
      });
      return { ...p, [kind]: next };
    });
    setMsg(null);
  }, []);

  async function save() {
    setSaving(true); setMsg(null);
    try {
      const r = await fetch("/api/portal/settings/report-filenames", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patterns),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      if (j.patterns) setPatterns({ ...REPORT_FILENAME_DEFAULTS, ...j.patterns });
      setMsg({ tone: "ok", text: "Saved — applies to new downloads." });
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof Error ? e.message : "Failed to save" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div style={{ padding: 16, color: "#94a3b8", fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 18 }}>
      <p style={{ margin: 0, fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
        Set how each downloaded report PDF is named. Click a token to insert it, or type your own
        text. Empty tokens are dropped automatically. The <code style={codeStyle}>.pdf</code> ending
        is added for you.
      </p>

      {KINDS.map((kind) => {
        const preview = buildReportFilename(patterns[kind], SAMPLE[kind], "Report");
        return (
          <div key={kind} style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 13.5, color: "#e2e8f0" }}>{REPORT_LABELS[kind]}</strong>
              <button
                type="button"
                className="portal-btn portal-btn-ghost"
                style={{ padding: "2px 8px", fontSize: 11 }}
                onClick={() => setOne(kind, REPORT_FILENAME_DEFAULTS[kind])}
              >
                Reset to default
              </button>
            </div>

            <input
              ref={(el) => { inputs.current[kind] = el; }}
              className="portal-input mono"
              value={patterns[kind]}
              onChange={(e) => setOne(kind, e.target.value)}
              placeholder={REPORT_FILENAME_DEFAULTS[kind]}
              spellCheck={false}
              style={{ fontSize: 13 }}
            />

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {REPORT_TOKENS[kind].map((t) => (
                <button
                  key={t.token}
                  type="button"
                  title={t.desc}
                  onClick={() => insertToken(kind, t.token)}
                  style={tokenChip}
                >
                  {"{" + t.token + "}"}
                </button>
              ))}
            </div>

            <div style={{ fontSize: 12, color: "#94a3b8" }}>
              Preview: <span className="mono" style={{ color: "#34d399" }}>{preview}</span>
            </div>
          </div>
        );
      })}

      <div style={{ display: "flex", alignItems: "center", gap: 12, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 14 }}>
        <button type="button" className="portal-btn portal-btn-primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save filename patterns"}
        </button>
        {msg && (
          <span style={{ fontSize: 12.5, color: msg.tone === "ok" ? "#34d399" : "#f87171" }}>{msg.text}</span>
        )}
      </div>
    </div>
  );
}

const codeStyle: React.CSSProperties = { color: "#cbd5e1", background: "rgba(255,255,255,0.05)", padding: "1px 6px", borderRadius: 4 };
const tokenChip: React.CSSProperties = {
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  fontSize: 11.5,
  color: "#a5b4fc",
  background: "rgba(129,140,248,0.12)",
  border: "1px solid rgba(129,140,248,0.25)",
  borderRadius: 999,
  padding: "2px 9px",
  cursor: "pointer",
};
