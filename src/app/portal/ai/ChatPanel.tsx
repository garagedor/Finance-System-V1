"use client";

// The conversational surface for an executive (or the whole team). Answers are
// NOT chat-only: the engine returns structured blocks (text + KPI cards +
// charts + tables + recommendations + alerts) plus a trace, which we render as
// a mini executive dashboard. When the engine isn't connected (no key), it
// shows an "activate" state instead.

import { useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";

type ApiMsg = { role: "user" | "assistant"; content: string };

// Structured blocks (mirror src/lib/ai/types.ts — kept loose on the client).
type Block =
  | { type: "text"; text: string }
  | { type: "kpis"; items: { label: string; value: string; delta?: string; tone?: string }[] }
  | { type: "table"; title?: string; columns: string[]; rows: (string | number)[][] }
  | {
      type: "chart";
      chartType: "line" | "bar";
      title?: string;
      xKey: string;
      series: { key: string; label: string }[];
      data: Record<string, unknown>[];
    }
  | { type: "recommendations"; items: { title: string; detail: string; priority?: string }[] }
  | { type: "alerts"; items: { severity: string; title: string; detail: string }[] };

type Trace = {
  provider?: string;
  model?: string;
  dateRange?: string;
  location?: string;
  technician?: string;
  areaManager?: string;
  sources?: string[];
  toolsUsed?: { name: string; summary: string }[];
  freshness?: { source: string; lastSync: string }[];
  notes?: string;
};

type ViewMsg =
  | { role: "user"; text: string }
  | { role: "assistant"; blocks: Block[]; trace?: Trace };

const SEVERITY_COLOR: Record<string, string> = {
  high: "#f87171",
  medium: "#f59e0b",
  low: "#60a5fa",
  info: "#94a3b8",
};
const PRIORITY_COLOR: Record<string, string> = { high: "#f87171", medium: "#f59e0b", low: "#60a5fa" };

function textFromBlocks(blocks: Block[]): string {
  const parts = blocks
    .map((b) => {
      if (b.type === "text") return b.text;
      if (b.type === "kpis") return b.items.map((i) => `${i.label}: ${i.value}`).join("; ");
      if (b.type === "recommendations") return b.items.map((i) => `Rec: ${i.title}`).join("; ");
      if (b.type === "alerts") return b.items.map((i) => `Alert: ${i.title}`).join("; ");
      return "";
    })
    .filter(Boolean);
  return parts.join("\n") || "(structured answer)";
}

function BlockView({ b }: { b: Block }) {
  if (b.type === "text") {
    return <p style={{ margin: "0 0 4px", fontSize: 13.5, lineHeight: 1.65, color: "#e2e8f0", whiteSpace: "pre-wrap" }}>{b.text}</p>;
  }
  if (b.type === "kpis") {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px,1fr))", gap: 10 }}>
        {b.items.map((k, i) => (
          <div key={i} className="portal-kpi" style={{ padding: "12px 14px" }}>
            <div className="portal-kpi-label">{k.label}</div>
            <div
              className="portal-kpi-value"
              style={{ fontSize: 19, color: k.tone === "neg" ? "#f87171" : k.tone === "pos" ? "#34d399" : undefined }}
            >
              {k.value}
            </div>
            {k.delta && <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 2 }}>{k.delta}</div>}
          </div>
        ))}
      </div>
    );
  }
  if (b.type === "table") {
    return (
      <div>
        {b.title && <div style={{ fontSize: 12.5, fontWeight: 600, color: "#cbd5e1", marginBottom: 6 }}>{b.title}</div>}
        <div style={{ overflowX: "auto" }}>
          <table className="portal-table">
            <thead>
              <tr>{b.columns.map((c, i) => <th key={i}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri}>{r.map((cell, ci) => <td key={ci}>{String(cell)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  if (b.type === "chart") {
    const colors = ["#818cf8", "#34d399", "#f59e0b", "#f472b6"];
    return (
      <div>
        {b.title && <div style={{ fontSize: 12.5, fontWeight: 600, color: "#cbd5e1", marginBottom: 6 }}>{b.title}</div>}
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            {b.chartType === "bar" ? (
              <BarChart data={b.data}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey={b.xKey} tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
                <RTooltip contentStyle={{ background: "#1a2236", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 12 }} />
                {b.series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={colors[i % colors.length]} radius={[4, 4, 0, 0]} />)}
              </BarChart>
            ) : (
              <LineChart data={b.data}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey={b.xKey} tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
                <RTooltip contentStyle={{ background: "#1a2236", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 12 }} />
                {b.series.map((s, i) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={colors[i % colors.length]} dot={false} strokeWidth={2} />)}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>
    );
  }
  if (b.type === "recommendations") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {b.items.map((r, i) => (
          <div key={i} style={{ borderLeft: `3px solid ${PRIORITY_COLOR[r.priority ?? "low"] ?? "#60a5fa"}`, paddingLeft: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>💡 {r.title}</div>
            <div style={{ fontSize: 12.5, color: "#94a3b8", lineHeight: 1.55 }}>{r.detail}</div>
          </div>
        ))}
      </div>
    );
  }
  if (b.type === "alerts") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {b.items.map((a, i) => {
          const c = SEVERITY_COLOR[a.severity] ?? "#94a3b8";
          return (
            <div key={i} style={{ background: `${c}14`, border: `1px solid ${c}44`, borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: c }}>⚠ {a.title}</div>
              <div style={{ fontSize: 12.5, color: "#cbd5e1", lineHeight: 1.55 }}>{a.detail}</div>
            </div>
          );
        })}
      </div>
    );
  }
  return null;
}

function TracePanel({ trace }: { trace?: Trace }) {
  const [open, setOpen] = useState(false);
  if (!trace) return null;
  const chips = [
    trace.dateRange && `📅 ${trace.dateRange}`,
    trace.location && `📍 ${trace.location}`,
    trace.technician && `👷 ${trace.technician}`,
    trace.areaManager && `🗺 ${trace.areaManager}`,
  ].filter(Boolean) as string[];
  return (
    <div style={{ marginTop: 10, borderTop: "1px dashed rgba(255,255,255,0.08)", paddingTop: 8 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ background: "none", border: "none", color: "#64748b", fontSize: 11.5, cursor: "pointer", padding: 0 }}
      >
        {open ? "▾" : "▸"} Sources &amp; method{trace.model ? ` · ${trace.model}` : ""}
      </button>
      {chips.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          {chips.map((c) => <span key={c} className="pill pill-draft">{c}</span>)}
        </div>
      )}
      {open && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: "#94a3b8", lineHeight: 1.7 }}>
          {trace.toolsUsed && trace.toolsUsed.length > 0 && (
            <div>
              <strong style={{ color: "#cbd5e1" }}>Tools used:</strong>{" "}
              {trace.toolsUsed.map((t) => `${t.name} (${t.summary})`).join(" · ")}
            </div>
          )}
          {trace.freshness && trace.freshness.length > 0 && (
            <div>
              <strong style={{ color: "#cbd5e1" }}>Data freshness:</strong>{" "}
              {trace.freshness.map((f) => `${f.source} — synced ${f.lastSync}`).join(" · ")}
            </div>
          )}
          {trace.sources && trace.sources.length > 0 && (
            <div><strong style={{ color: "#cbd5e1" }}>Sources:</strong> {trace.sources.join(", ")}</div>
          )}
          {trace.notes && <div style={{ color: "#fcd9a3" }}><strong>Note:</strong> {trace.notes}</div>}
        </div>
      )}
    </div>
  );
}

export default function ChatPanel({
  enabled,
  executiveSlug,
  title,
  greeting,
  starters = [],
  endpoint = "/api/portal/ai/chat",
}: {
  enabled: boolean;
  executiveSlug?: string;
  title: string;
  greeting?: string;
  starters?: string[];
  endpoint?: string;
}) {
  const [view, setView] = useState<ViewMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const historyRef = useRef<ApiMsg[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  async function send(text: string) {
    const clean = text.trim();
    if (!clean || busy) return;
    setError(null);
    setView((v) => [...v, { role: "user", text: clean }]);
    historyRef.current = [...historyRef.current, { role: "user", content: clean }];
    setInput("");
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executive: executiveSlug, messages: historyRef.current }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      const blocks: Block[] = Array.isArray(data.blocks) ? data.blocks : [{ type: "text", text: data.reply ?? "" }];
      setView((v) => [...v, { role: "assistant", blocks, trace: data.trace }]);
      historyRef.current = [...historyRef.current, { role: "assistant", content: textFromBlocks(blocks) }];
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
      requestAnimationFrame(() =>
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }),
      );
    }
  }

  if (!enabled) {
    return (
      <div className="portal-card" style={{ padding: 22 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>🔌 Engine not connected yet</div>
        <p className="portal-subtitle" style={{ marginTop: 0 }}>
          Add your <code className="mono">ANTHROPIC_API_KEY</code> to <code className="mono">.env.local</code> and
          restart the dev server. Then {title} comes alive right here with visual, sourced answers.
        </p>
        {starters.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div className="portal-kpi-label" style={{ marginBottom: 8 }}>You&apos;ll be able to ask things like</div>
            <ul style={{ margin: 0, paddingLeft: 18, color: "#94a3b8", fontSize: 13, lineHeight: 1.9 }}>
              {starters.map((s) => <li key={s}>{s}</li>)}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="portal-card" style={{ padding: 0, display: "flex", flexDirection: "column", minHeight: 460 }}>
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
        {view.length === 0 && (
          <div style={{ color: "#94a3b8", fontSize: 13.5, lineHeight: 1.7 }}>
            {greeting}
            {starters.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
                {starters.map((s) => (
                  <button key={s} type="button" className="portal-btn" style={{ textAlign: "left", justifyContent: "flex-start" }} onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {view.map((m, i) =>
          m.role === "user" ? (
            <div
              key={i}
              style={{
                alignSelf: "flex-end",
                maxWidth: "82%",
                padding: "10px 13px",
                borderRadius: 12,
                fontSize: 13.5,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                background: "rgba(99,102,241,0.16)",
                border: "1px solid rgba(99,102,241,0.28)",
                color: "#e0e7ff",
              }}
            >
              {m.text}
            </div>
          ) : (
            <div key={i} style={{ alignSelf: "stretch", display: "flex", flexDirection: "column", gap: 12 }}>
              {m.blocks.map((b, bi) => <BlockView key={bi} b={b} />)}
              <TracePanel trace={m.trace} />
            </div>
          ),
        )}
        {busy && <div style={{ color: "#64748b", fontSize: 12.5 }}>Thinking…</div>}
        {error && <div style={{ color: "#f87171", fontSize: 12.5 }}>{error}</div>}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        style={{ display: "flex", gap: 8, padding: 12, borderTop: "1px solid rgba(255,255,255,0.07)" }}
      >
        <input className="portal-input" style={{ flex: 1 }} placeholder={`Ask ${title}…`} value={input} onChange={(e) => setInput(e.target.value)} disabled={busy} />
        <button type="submit" className="portal-btn portal-btn-primary" disabled={busy || !input.trim()}>Send</button>
      </form>
    </div>
  );
}
