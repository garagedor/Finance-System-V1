"use client";

// Custom itemized report builder. Browse a category (with the right scope),
// tick specific rows, and they drop into a basket grouped by category with
// subtotals + a grand total. Export produces one grouped PDF of exactly those
// items. Amounts are server-computed by /api/portal/custom-report/items.

import { useCallback, useEffect, useMemo, useState } from "react";
import FilterMultiSelect from "../../_components/FilterMultiSelect";
import type { CustomItemType } from "@/lib/custom-report";

type Item = { id: string; date: string; primary: string; secondary: string; amount: number };
type Scope = "ledger" | "providerish" | "none";
type Category = { type: CustomItemType; label: string; scope: Scope };

const CATEGORIES: Category[] = [
  { type: "ledgerLine", label: "Ledger lines", scope: "ledger" },
  { type: "providerJob", label: "Provider jobs", scope: "providerish" },
  { type: "payout", label: "Payouts", scope: "none" },
  { type: "penalty", label: "Penalties", scope: "providerish" },
  { type: "disputeRefund", label: "Disputes & Refunds", scope: "none" },
  { type: "expense", label: "Expenses", scope: "none" },
  { type: "income", label: "Income", scope: "none" },
];
const LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.type, c.label]));

const money = (n: number) => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

type Selected = { key: string; type: CustomItemType; label: string; amountLabel: string; item: Item };

export default function CustomReportBuilder() {
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(() => fmt(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(() => fmt(today));
  const [title, setTitle] = useState("Custom Report");
  const [preparedFor, setPreparedFor] = useState("");

  const [cat, setCat] = useState<CustomItemType>("ledgerLine");
  const scope = CATEGORIES.find((c) => c.type === cat)!.scope;

  // Scope inputs
  const [ledgerId, setLedgerId] = useState("");
  const [ledgers, setLedgers] = useState<Array<{ _id: string; holder_name: string; role: string; location: string }>>([]);
  const [providers, setProviders] = useState<string[]>([]);
  const [techs, setTechs] = useState<string[]>([]);
  const [locs, setLocs] = useState<string[]>([]);
  const [opts, setOpts] = useState<{ providers: string[]; techs: string[]; locations: string[] }>({ providers: [], techs: [], locations: [] });

  const [items, setItems] = useState<Item[]>([]);
  const [amountLabel, setAmountLabel] = useState("Amount");
  const [loadingItems, setLoadingItems] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Record<string, Selected>>({});
  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Option lists (once).
  useEffect(() => {
    let cancelled = false;
    const ids = (j: unknown): string[] => Array.isArray((j as { rows?: unknown[] })?.rows)
      ? (j as { rows: Array<{ _id?: unknown }> }).rows.map((r) => String(r._id ?? "")).filter(Boolean) : [];
    (async () => {
      try {
        const [lg, p, t, l] = await Promise.all([
          fetch("/api/portal/ledger?status=active&pageSize=2000").then((r) => r.json()).catch(() => ({})),
          fetch("/api/providers?pageSize=2000").then((r) => r.json()).catch(() => ({})),
          fetch("/api/techs?pageSize=2000").then((r) => r.json()).catch(() => ({})),
          fetch("/api/locations?pageSize=2000").then((r) => r.json()).catch(() => ({})),
        ]);
        if (cancelled) return;
        const lrows: Array<{ _id?: unknown; holder_name?: unknown; role?: unknown; location?: unknown }> = Array.isArray(lg) ? lg : (lg.rows ?? []);
        setLedgers(lrows.map((r) => ({ _id: String(r._id ?? ""), holder_name: String(r.holder_name ?? ""), role: String(r.role ?? ""), location: String(r.location ?? "") })).filter((r) => r._id));
        setOpts({ providers: ids(p), techs: ids(t), locations: ids(l) });
      } catch { /* pickers still work with fewer options */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadItems = useCallback(async () => {
    if (scope === "ledger" && !ledgerId) { setItems([]); setTruncated(false); return; }
    setLoadingItems(true); setErr(null);
    try {
      const p = new URLSearchParams({ type: cat, from, to });
      if (scope === "ledger") p.set("ledgerId", ledgerId);
      if (scope === "providerish") {
        if (providers.length) p.set("providers", providers.join(","));
        if (techs.length) p.set("techs", techs.join(","));
        if (locs.length) p.set("locations", locs.join(","));
      }
      const r = await fetch(`/api/portal/custom-report/items?${p.toString()}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setItems(Array.isArray(j.items) ? j.items : []);
      setAmountLabel(j.amountLabel || "Amount");
      setTruncated(!!j.truncated);
    } catch (e) { setItems([]); setErr(e instanceof Error ? e.message : "Failed to load items"); } finally { setLoadingItems(false); }
  }, [cat, from, to, scope, ledgerId, providers, techs, locs]);

  useEffect(() => { const t = setTimeout(loadItems, 250); return () => clearTimeout(t); }, [loadItems]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) => `${it.date} ${it.primary} ${it.secondary}`.toLowerCase().includes(needle));
  }, [items, q]);

  const keyOf = (it: Item) => `${cat}:${it.id}`;
  const isSel = (it: Item) => !!selected[keyOf(it)];
  const toggle = (it: Item) => setSelected((prev) => {
    const k = keyOf(it);
    const next = { ...prev };
    if (next[k]) delete next[k];
    else next[k] = { key: k, type: cat, label: LABEL[cat], amountLabel, item: it };
    return next;
  });
  const selectAllShown = () => setSelected((prev) => {
    const next = { ...prev };
    for (const it of shown) next[keyOf(it)] = { key: keyOf(it), type: cat, label: LABEL[cat], amountLabel, item: it };
    return next;
  });
  const clearShown = () => setSelected((prev) => {
    const next = { ...prev };
    for (const it of shown) delete next[keyOf(it)];
    return next;
  });
  const allShownSelected = shown.length > 0 && shown.every((it) => isSel(it));

  // Basket grouped by category (in CATEGORIES order).
  const groups = useMemo(() => {
    const byType = new Map<string, Selected[]>();
    for (const sEntry of Object.values(selected)) {
      const arr = byType.get(sEntry.type) ?? [];
      arr.push(sEntry);
      byType.set(sEntry.type, arr);
    }
    return CATEGORIES.filter((c) => byType.has(c.type)).map((c) => {
      const entries = byType.get(c.type)!;
      const subtotal = entries.reduce((s, e) => s + e.item.amount, 0);
      return { type: c.type, label: c.label, amountLabel: entries[0]?.amountLabel ?? "Amount", entries, subtotal };
    });
  }, [selected]);
  const grandTotal = groups.reduce((s, g) => s + g.subtotal, 0);
  const totalCount = Object.keys(selected).length;

  async function exportPdf() {
    if (totalCount === 0) return;
    setPosting(true); setErr(null);
    try {
      const payload = {
        title: title || "Custom Report", from, to, preparedFor: preparedFor.trim() || null,
        groups: groups.map((g) => ({ type: g.type, label: g.label, amountLabel: g.amountLabel, items: g.entries.map((e) => e.item) })),
      };
      const r = await fetch("/api/finance-report/custom-pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`); }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed to export"); } finally { setPosting(false); }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr minmax(320px, 420px)", gap: 18, alignItems: "start" }}>
      {/* ── Left: picker ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="portal-card" style={{ padding: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}><span className="portal-label">From</span><input type="date" className="portal-input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}><span className="portal-label">To</span><input type="date" className="portal-input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {CATEGORIES.map((c) => (
              <button key={c.type} type="button" className={`portal-btn ${cat === c.type ? "portal-btn-primary" : "portal-btn-ghost"}`} style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => { setCat(c.type); setQ(""); }}>{c.label}</button>
            ))}
          </div>

          {scope === "ledger" && (
            <div style={{ marginTop: 10 }}>
              <label className="portal-label">Ledger *</label>
              <select className="portal-input" value={ledgerId} onChange={(e) => setLedgerId(e.target.value)}>
                <option value="">Select a ledger…</option>
                {ledgers.map((l) => <option key={l._id} value={l._id}>{l.holder_name}{l.role ? ` · ${l.role.replace(/_/g, " ")}` : ""}{l.location ? ` · ${l.location}` : ""}</option>)}
              </select>
            </div>
          )}
          {scope === "providerish" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 10 }}>
              <FilterMultiSelect label="Provider" values={providers} onChange={setProviders} options={opts.providers} />
              <FilterMultiSelect label="Location" values={locs} onChange={setLocs} options={opts.locations} />
              <FilterMultiSelect label="Technician" values={techs} onChange={setTechs} options={opts.techs} />
            </div>
          )}
        </div>

        <div className="portal-card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: 12, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <input className="portal-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${LABEL[cat].toLowerCase()}…`} style={{ flex: 1 }} />
            <button type="button" className="portal-btn portal-btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={allShownSelected ? clearShown : selectAllShown} disabled={shown.length === 0}>{allShownSelected ? "Clear shown" : "Select all"}</button>
          </div>
          <div style={{ maxHeight: 460, overflowY: "auto" }}>
            {shown.length === 0 ? (
              <div className="muted small" style={{ padding: 16, textAlign: "center" }}>
                {loadingItems ? "Loading…" : scope === "ledger" && !ledgerId ? "Pick a ledger to list its lines." : "No items match — adjust the period / scope / search."}
              </div>
            ) : (
              <table className="portal-table" style={{ margin: 0 }}>
                <thead><tr><th style={{ width: 30 }}><input type="checkbox" checked={allShownSelected} onChange={allShownSelected ? clearShown : selectAllShown} style={{ width: 15, height: 15 }} /></th><th>Date</th><th>Item</th><th>Detail</th><th className="right">{amountLabel}</th></tr></thead>
                <tbody>
                  {shown.map((it) => (
                    <tr key={it.id} style={{ cursor: "pointer", background: isSel(it) ? "rgba(129,140,248,0.08)" : undefined }} onClick={() => toggle(it)}>
                      <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={isSel(it)} onChange={() => toggle(it)} style={{ width: 15, height: 15 }} /></td>
                      <td className="small mono">{it.date || "—"}</td>
                      <td className="small">{it.primary || "—"}</td>
                      <td className="small muted">{it.secondary || "—"}</td>
                      <td className="right money">{money(it.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {truncated && <div className="muted small" style={{ padding: "6px 12px" }}>Showing the first 500 — narrow the period / scope for the rest.</div>}
        </div>
      </div>

      {/* ── Right: basket ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14, position: "sticky", top: 12, maxHeight: "calc(100vh - 24px)", overflowY: "auto", paddingRight: 4 }}>
        <div className="portal-card" style={{ padding: 14 }}>
          <div className="portal-card-head-title" style={{ marginBottom: 8 }}>Report</div>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}><span className="portal-label">Title</span><input className="portal-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Custom Report" /></label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}><span className="portal-label">Prepared for (optional)</span><input className="portal-input" value={preparedFor} onChange={(e) => setPreparedFor(e.target.value)} placeholder="e.g. Jane Smith, CPA" /></label>
        </div>

        <div className="portal-card" style={{ padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
            <div className="portal-card-head-title">Selected · {totalCount}</div>
            {totalCount > 0 && <button type="button" className="portal-btn portal-btn-ghost" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => setSelected({})}>Clear all</button>}
          </div>
          {groups.length === 0 ? (
            <div className="muted small">Nothing selected yet. Tick items on the left to add them here.</div>
          ) : groups.map((g) => (
            <div key={g.type} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{g.label} <span className="muted small">· {g.entries.length}</span></span>
                <span className="money small" style={{ fontWeight: 700 }}>{money(g.subtotal)}</span>
              </div>
              {g.entries.map((e) => (
                <div key={e.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="small" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.item.primary}</div>
                    <div className="muted small">{e.item.date} · {e.item.secondary}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    <span className="money small">{money(e.item.amount)}</span>
                    <button type="button" className="portal-btn portal-btn-ghost" style={{ padding: "0 6px", fontSize: 11 }} onClick={() => setSelected((prev) => { const n = { ...prev }; delete n[e.key]; return n; })}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.12)" }}>
            <span style={{ fontWeight: 800 }}>Grand total</span>
            <span className="money" style={{ fontWeight: 800, color: grandTotal >= 0 ? "#34d399" : "#f87171" }}>{money(grandTotal)}</span>
          </div>
          {err && <div className="portal-alert portal-alert-error" style={{ marginTop: 10 }}>{err}</div>}
          <button className="portal-btn portal-btn-primary" style={{ width: "100%", marginTop: 12 }} onClick={exportPdf} disabled={posting || totalCount === 0}>
            {posting ? "Building PDF…" : `⬇ Export PDF (${totalCount})`}
          </button>
        </div>
      </div>
    </div>
  );
}
