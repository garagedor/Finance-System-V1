"use client";

// Lightweight evidence renderer for the global live assistant. Intentionally
// does NOT import a chart library (this mounts on every page) — charts render as
// a compact table so the global bundle stays small.

type Block =
  | { type: "text"; text: string }
  | { type: "kpis"; items: { label: string; value: string; tone?: string }[] }
  | { type: "table"; title?: string; columns: string[]; rows: (string | number)[][] }
  | { type: "chart"; title?: string; xKey: string; series: { key: string; label: string }[]; data: Record<string, unknown>[] }
  | { type: "recommendations"; items: { title: string; detail: string }[] }
  | { type: "alerts"; items: { severity: string; title: string; detail: string }[] };

type SevTier = { text: string; wash: string; line: string };
const SEV: Record<string, SevTier> = {
  high:   { text: "var(--ds-crit-text)",    wash: "var(--ds-crit-wash)",    line: "var(--ds-crit-line)" },
  medium: { text: "var(--ds-warn-text)",    wash: "var(--ds-warn-wash)",    line: "var(--ds-warn-line)" },
  low:    { text: "var(--ds-info-text)",    wash: "var(--ds-info-wash)",    line: "var(--ds-info-line)" },
  info:   { text: "var(--ds-neutral-text)", wash: "var(--ds-neutral-wash)", line: "var(--ds-neutral-line)" },
};

export default function AiBlocksLite({ blocks }: { blocks: Block[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {blocks.map((b, i) => {
        if (b.type === "text")
          return <p key={i} style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: "var(--ds-ink)", whiteSpace: "pre-wrap" }}>{b.text}</p>;
        if (b.type === "kpis")
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(110px,1fr))", gap: 8 }}>
              {b.items.map((k, j) => (
                <div key={j} style={{ background: "var(--ds-surface-2)", borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ fontSize: 10, color: "var(--ds-ink-2)" }}>{k.label}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: k.tone === "neg" ? "var(--ds-crit-text)" : k.tone === "pos" ? "var(--ds-ok-text)" : "var(--ds-ink)" }}>{k.value}</div>
                </div>
              ))}
            </div>
          );
        if (b.type === "table" || b.type === "chart") {
          const columns = b.type === "table" ? b.columns : [b.xKey, ...b.series.map((s) => s.label)];
          const rows =
            b.type === "table"
              ? b.rows
              : b.data.slice(0, 12).map((d) => [String(d[b.xKey] ?? ""), ...b.series.map((s) => String(d[s.key] ?? ""))]);
          return (
            <div key={i}>
              {b.title && <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ds-ink)", marginBottom: 4 }}>{b.title}</div>}
              <div style={{ overflowX: "auto" }}>
                <table className="portal-table" style={{ fontSize: 11.5 }}>
                  <thead><tr>{columns.map((c, ci) => <th key={ci}>{c}</th>)}</tr></thead>
                  <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}>{String(c)}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </div>
          );
        }
        if (b.type === "recommendations")
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {b.items.map((r, j) => (
                <div key={j} style={{ borderLeft: "2px solid var(--ds-line-strong)", paddingLeft: 9 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ds-ink)" }}>💡 {r.title}</div>
                  <div style={{ fontSize: 11.5, color: "var(--ds-ink-2)" }}>{r.detail}</div>
                </div>
              ))}
            </div>
          );
        if (b.type === "alerts")
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {b.items.map((a, j) => {
                const c = SEV[a.severity] ?? SEV.info;
                return (
                  <div key={j} style={{ background: c.wash, border: `1px solid ${c.line}`, borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: c.text }}>⚠ {a.title}</div>
                    <div style={{ fontSize: 11.5, color: "var(--ds-ink)" }}>{a.detail}</div>
                  </div>
                );
              })}
            </div>
          );
        return null;
      })}
    </div>
  );
}
