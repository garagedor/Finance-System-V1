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
type Account = { account_id: string; name: string; mask: string | null };

export default function AddTxnsModal({
  groupId,
  accounts = [],
  label,
}: {
  groupId: string;
  accounts?: Account[];
  suggestions?: string[];
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Avail[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  // Filters — mirror the Banking transactions page.
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [accountId, setAccountId] = useState("");
  const [dir, setDir] = useState<"out" | "in" | "">("out");
  const [recon, setRecon] = useState("");
  const [pending, setPending] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const search = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const p = new URLSearchParams({ limit: "200" });
      if (q.trim()) p.set("q", q.trim());
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      if (accountId) p.set("account_id", accountId);
      if (dir) p.set("direction", dir);
      if (recon) p.set("recon", recon);
      if (pending) p.set("pending", pending);
      const res = await fetch(`/api/portal/expense-groups/available?${p.toString()}`);
      const j = await res.json();
      setRows(Array.isArray(j.rows) ? j.rows : []);
    } catch { setRows([]); } finally { setLoading(false); }
  }, [q, from, to, accountId, dir, recon, pending]);

  const clearFilters = () => {
    setQ(""); setFrom(""); setTo(""); setAccountId(""); setDir("out"); setRecon(""); setPending("");
  };

  // Auto-apply filters, debounced so typing in Search doesn't hammer the API.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(search, 250);
    return () => clearTimeout(t);
  }, [open, search]);

  const toggle = (id: string) =>
    setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const allSelected = rows.length > 0 && rows.every((r) => sel.has(r._id));
  const toggleAll = () =>
    setSel((s) => {
      const n = new Set(s);
      if (rows.length > 0 && rows.every((r) => n.has(r._id))) rows.forEach((r) => n.delete(r._id));
      else rows.forEach((r) => n.add(r._id));
      return n;
    });

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

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 6 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span className="portal-label">From</span>
                <input type="date" className="portal-input" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span className="portal-label">To</span>
                <input type="date" className="portal-input" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span className="portal-label">Account</span>
                <select className="portal-select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  <option value="">All accounts</option>
                  {accounts.map((a) => (
                    <option key={a.account_id} value={a.account_id}>{a.name}{a.mask ? ` ··${a.mask}` : ""}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span className="portal-label">Direction</span>
                <select className="portal-select" value={dir} onChange={(e) => setDir(e.target.value as "out" | "in" | "")}>
                  <option value="out">Money out</option>
                  <option value="in">Money in</option>
                  <option value="">Both</option>
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span className="portal-label">Reconciliation</span>
                <select className="portal-select" value={recon} onChange={(e) => setRecon(e.target.value)}>
                  <option value="">All</option>
                  <option value="unmatched">Unmatched</option>
                  <option value="matched">Matched</option>
                  <option value="ignored">Ignored</option>
                  <option value="pending_review">Pending review</option>
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span className="portal-label">Pending?</span>
                <select className="portal-select" value={pending} onChange={(e) => setPending(e.target.value)}>
                  <option value="">Any</option>
                  <option value="1">Pending</option>
                  <option value="0">Posted</option>
                </select>
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "flex-end" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
                <span className="portal-label">Search</span>
                <input className="portal-input" placeholder="Merchant / description…" value={q}
                  onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") search(); }} />
              </label>
              <button type="button" className="portal-btn portal-btn-ghost" onClick={clearFilters}>Clear</button>
              <button type="button" className="portal-btn" onClick={search} disabled={loading}>{loading ? "…" : "Search"}</button>
            </div>

            <div style={{ maxHeight: 360, overflowY: "auto", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8 }}>
              {rows.length === 0 ? (
                <div className="muted small" style={{ padding: 14, textAlign: "center" }}>
                  {loading ? "Loading…" : "No ungrouped transactions match. (Transactions already in a group are hidden.)"}
                </div>
              ) : (
                <table className="portal-table" style={{ margin: 0 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}>
                        <input type="checkbox" checked={allSelected} onChange={toggleAll} title="Select all shown" />
                      </th>
                      <th>Date</th><th>Description</th><th>Category</th><th className="right">Amount</th>
                    </tr>
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
              <span className="muted small" style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                {sel.size} selected
                {rows.length > 0 && (
                  <button type="button" className="portal-btn portal-btn-ghost" style={{ padding: "2px 8px", fontSize: 11 }} onClick={toggleAll}>
                    {allSelected ? "Clear all" : `Select all ${rows.length}`}
                  </button>
                )}
              </span>
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
