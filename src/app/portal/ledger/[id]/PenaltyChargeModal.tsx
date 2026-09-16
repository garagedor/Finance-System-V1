"use client";

// "+ Penalty" on a ledger. Filters the collected penalties (X-close jobs), lets
// you TICK several (or select all matching), and posts each one's Area-Manager
// 50% (amLoss) to this ledger in one go. Company 50% + technician are not charged.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import FilterMultiSelect from "../../_components/FilterMultiSelect";

type Penalty = {
  id: string; date: string; address: string; tech: string; location: string; provider: string;
  jobProfit: number; totalLoss: number; amLoss: number; companyLoss: number;
};

const money = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);

export default function PenaltyChargeModal({ ledgerId, ledgerName }: { ledgerId?: string; ledgerName?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [fProvider, setFProvider] = useState<string[]>([]);
  const [fLocation, setFLocation] = useState<string[]>([]);
  const [fTech, setFTech] = useState<string[]>([]);
  const [fAM, setFAM] = useState<string[]>([]);
  const [fStart, setFStart] = useState("");
  const [fEnd, setFEnd] = useState("");
  const [opts, setOpts] = useState<{ providers: string[]; locations: string[]; techs: string[]; ams: string[] }>({ providers: [], locations: [], techs: [], ams: [] });
  const [rows, setRows] = useState<Penalty[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const search = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (q.trim()) p.set("q", q.trim());
      if (fProvider.length) p.set("provider", fProvider.join(","));
      if (fLocation.length) p.set("location", fLocation.join(","));
      if (fTech.length) p.set("tech", fTech.join(","));
      if (fAM.length) p.set("areaManager", fAM.join(","));
      if (fStart) p.set("startDate", fStart);
      if (fEnd) p.set("endDate", fEnd);
      const r = await fetch(`/api/portal/dispute-charge/penalties?${p.toString()}`);
      const j = await r.json();
      const list: Penalty[] = Array.isArray(j.penalties) ? j.penalties : [];
      setRows(list);
      // Drop any selected ids no longer in the result set.
      setSelected((s) => s.filter((id) => list.some((r2) => r2.id === id)));
    } catch { setRows([]); } finally { setLoading(false); }
  }, [q, fProvider, fLocation, fTech, fAM, fStart, fEnd]);

  useEffect(() => { if (!open) return; const t = setTimeout(search, 250); return () => clearTimeout(t); }, [open, search]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const ids = (j: unknown): string[] =>
      Array.isArray((j as { rows?: unknown[] })?.rows)
        ? ((j as { rows: Array<{ _id?: unknown }> }).rows.map((d) => String(d?._id ?? "")).filter(Boolean)) : [];
    (async () => {
      try {
        const [p, l, t, a] = await Promise.all([
          fetch("/api/providers?pageSize=2000").then((r) => r.json()).catch(() => ({})),
          fetch("/api/locations?pageSize=2000").then((r) => r.json()).catch(() => ({})),
          fetch("/api/techs?pageSize=2000").then((r) => r.json()).catch(() => ({})),
          fetch("/api/portal/locations/area-manager").then((r) => r.json()).catch(() => ({})),
        ]);
        if (cancelled) return;
        setOpts({ providers: ids(p), locations: ids(l), techs: ids(t), ams: Array.isArray((a as { amOptions?: string[] })?.amOptions) ? (a as { amOptions: string[] }).amOptions : [] });
      } catch { /* text search still works */ }
    })();
    return () => { cancelled = true; };
  }, [open]);

  function reset() {
    setSelected([]); setQ(""); setRows([]); setNotes(""); setDate(today());
    setFProvider([]); setFLocation([]); setFTech([]); setFAM([]); setFStart(""); setFEnd(""); setErr(null);
  }
  function close() { setOpen(false); reset(); }

  const toggle = (id: string) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const allSelected = rows.length > 0 && rows.every((r) => selected.includes(r.id));
  const toggleAll = () => setSelected(allSelected ? [] : rows.map((r) => r.id));
  const totalAmLoss = rows.filter((r) => selected.includes(r.id)).reduce((sum, r) => sum + r.amLoss, 0);

  async function post() {
    if (!ledgerId || selected.length === 0) return;
    setPosting(true); setErr(null);
    try {
      const r = await fetch("/api/portal/dispute-charge", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "penalty", jobIds: selected, ledgerId, date, notes: notes.trim() || null }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      close(); router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed to post"); } finally { setPosting(false); }
  }

  return (
    <>
      <button className="portal-btn" onClick={() => setOpen(true)}>+ Penalty</button>
      {open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 100, paddingTop: 44, paddingBottom: 40, overflowY: "auto" }}
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div style={{ background: "#111827", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 22, width: "min(760px, 96vw)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#f1f5f9" }}>Penalties — charge {ledgerName ? `${ledgerName}'s` : "the AM's"} 50%</h2>
              <button onClick={close} className="portal-btn portal-btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }}>✕</button>
            </div>

            <label className="portal-label">Find penalties (X-close jobs — address, tech, provider)</label>
            <input className="portal-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. 123 Main St / Idan / SPE" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 8 }}>
              <FilterMultiSelect label="Provider" values={fProvider} onChange={setFProvider} options={opts.providers} />
              <FilterMultiSelect label="Location" values={fLocation} onChange={setFLocation} options={opts.locations} />
              <FilterMultiSelect label="Area manager" values={fAM} onChange={setFAM} options={opts.ams} />
              <FilterMultiSelect label="Technician" values={fTech} onChange={setFTech} options={opts.techs} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
              <div><label className="portal-label" style={{ fontSize: 11 }}>From</label><input type="date" className="portal-input" value={fStart} onChange={(e) => setFStart(e.target.value)} style={{ padding: "6px 8px" }} /></div>
              <div><label className="portal-label" style={{ fontSize: 11 }}>To</label><input type="date" className="portal-input" value={fEnd} onChange={(e) => setFEnd(e.target.value)} style={{ padding: "6px 8px" }} /></div>
            </div>

            <div style={{ maxHeight: 320, overflowY: "auto", marginTop: 10, border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8 }}>
              {rows.length === 0 ? (
                <div className="muted small" style={{ padding: 14, textAlign: "center" }}>{loading ? "Searching…" : "No X-close penalties match — adjust the filters."}</div>
              ) : (
                <table className="portal-table" style={{ margin: 0 }}>
                  <thead><tr>
                    <th style={{ width: 30 }}><input type="checkbox" checked={allSelected} onChange={toggleAll} title="Select all" /></th>
                    <th>Date</th><th>Address</th><th>Tech</th><th>Provider</th><th className="right">AM 50%</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} style={{ cursor: "pointer", background: selected.includes(r.id) ? "rgba(129,140,248,0.08)" : undefined }} onClick={() => toggle(r.id)}>
                        <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} /></td>
                        <td className="small mono">{r.date || "—"}</td>
                        <td className="small">{r.address || "—"}<div className="muted small">{r.location}</div></td>
                        <td className="small">{r.tech || "—"}</td>
                        <td className="small muted">{r.provider || "—"}</td>
                        <td className="right money">{money(r.amLoss)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
              <div><label className="portal-label">Date</label><input type="date" className="portal-input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
              <div><label className="portal-label">Notes</label><input className="portal-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></div>
            </div>

            {err && <div className="portal-alert portal-alert-error" style={{ marginTop: 10 }}>{err}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
              <span className="muted small">{selected.length} selected · total AM 50% <strong>{money(totalAmLoss)}</strong></span>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="portal-btn portal-btn-ghost" onClick={close}>Cancel</button>
                <button className="portal-btn portal-btn-primary" onClick={post} disabled={posting || selected.length === 0}>
                  {posting ? "Posting…" : `Post ${selected.length || ""} penalt${selected.length === 1 ? "y" : "ies"} → ledger`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
