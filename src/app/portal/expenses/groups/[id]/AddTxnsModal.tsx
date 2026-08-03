"use client";

// Picker to add bank transactions to a group. Lists transactions not yet in any
// group (searchable), lets you check several, and tags them to this group.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fmt$, fmtDate } from "../../../format";

type Avail = {
  _id: string; date: string; description: string;
  merchant_name: string | null; amount: number; category: string | null; account: string | null;
};

export default function AddTxnsModal({
  groupId,
  label,
}: {
  groupId: string;
  suggestions?: string[];
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Avail[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [dir, setDir] = useState<"out" | "in" | "">("out");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const search = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const p = new URLSearchParams({ limit: "150" });
      if (q.trim()) p.set("q", q.trim());
      if (dir) p.set("direction", dir);
      const res = await fetch(`/api/portal/expense-groups/available?${p.toString()}`);
      const j = await res.json();
      setRows(Array.isArray(j.rows) ? j.rows : []);
    } catch { setRows([]); } finally { setLoading(false); }
  }, [q, dir]);

  useEffect(() => { if (open) search(); }, [open, dir, search]);

  const toggle = (id: string) =>
    setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const add = async () => {
    if (sel.size === 0) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/portal/expense-groups/txns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: groupId, txn_ids: [...sel] }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setOpen(false);
      setSel(new Set());
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  };

  return (
    <>
      <button className="portal-btn portal-btn-primary" onClick={() => setOpen(true)}>
        {label ?? "+ Add transactions"}
      </button>

      {open && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 100, paddingTop: 48, paddingBottom: 40, overflowY: "auto" }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div style={{ background: "#111827", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 22, width: "min(760px, 96vw)" }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#f1f5f9" }}>Add transactions</h2>
              <button onClick={() => setOpen(false)} className="portal-btn portal-btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }}>✕</button>
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <input className="portal-input" placeholder="Search description / merchant" value={q}
                onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") search(); }}
                style={{ flex: 1, minWidth: 180 }} />
              <select className="portal-select" value={dir} onChange={(e) => setDir(e.target.value as "out" | "in" | "")}>
                <option value="out">Money out</option>
                <option value="in">Money in</option>
                <option value="">Both</option>
              </select>
              <button className="portal-btn" onClick={search} disabled={loading}>{loading ? "…" : "Search"}</button>
            </div>

            <div style={{ maxHeight: 360, overflowY: "auto", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8 }}>
              {rows.length === 0 ? (
                <div className="muted small" style={{ padding: 14, textAlign: "center" }}>
                  {loading ? "Loading…" : "No ungrouped transactions match. (Transactions already in a group are hidden.)"}
                </div>
              ) : (
                <table className="portal-table" style={{ margin: 0 }}>
                  <thead>
                    <tr><th style={{ width: 32 }}></th><th>Date</th><th>Description</th><th>Category</th><th className="right">Amount</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r._id} style={{ cursor: "pointer", background: sel.has(r._id) ? "rgba(129,140,248,0.10)" : undefined }}
                        onClick={() => toggle(r._id)}>
                        <td onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={sel.has(r._id)} onChange={() => toggle(r._id)} />
                        </td>
                        <td className="small mono">{fmtDate(r.date)}</td>
                        <td>{r.description}<div className="muted small">{r.account ?? ""}</div></td>
                        <td className="muted small">{r.category ?? "—"}</td>
                        <td className={`right money ${r.amount < 0 ? "money-neg" : "money-pos"}`}>
                          {r.amount < 0 ? "−" : "+"}{fmt$(Math.abs(r.amount))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {err && <div className="portal-alert portal-alert-error" style={{ marginTop: 10 }}>{err}</div>}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
              <span className="muted small">{sel.size} selected</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="portal-btn portal-btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
                <button className="portal-btn portal-btn-primary" onClick={add} disabled={busy || sel.size === 0}>
                  {busy ? "Adding…" : `Add ${sel.size || ""} transaction${sel.size === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
