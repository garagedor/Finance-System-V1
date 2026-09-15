"use client";

// "+ Penalty" on a ledger. Picks a collected penalty (an X-close job), shows the
// loss split (totalLoss = provider% × job profit; AM 50% / company 50%), and
// posts the Area Manager's 50% (amLoss) to this ledger. Company 50% and the
// technician are not charged (shown for reference).

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
  const [fProvider, setFProvider] = useState("");
  const [fLocation, setFLocation] = useState("");
  const [fTech, setFTech] = useState("");
  const [fAM, setFAM] = useState("");
  const [opts, setOpts] = useState<{ providers: string[]; locations: string[]; techs: string[]; ams: string[] }>({ providers: [], locations: [], techs: [], ams: [] });
  const [rows, setRows] = useState<Penalty[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Penalty | null>(null);
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const search = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (q.trim()) p.set("q", q.trim());
      if (fProvider) p.set("provider", fProvider);
      if (fLocation) p.set("location", fLocation);
      if (fTech) p.set("tech", fTech);
      if (fAM) p.set("areaManager", fAM);
      const r = await fetch(`/api/portal/dispute-charge/penalties?${p.toString()}`);
      const j = await r.json();
      setRows(Array.isArray(j.penalties) ? j.penalties : []);
    } catch { setRows([]); } finally { setLoading(false); }
  }, [q, fProvider, fLocation, fTech, fAM]);

  useEffect(() => { if (!open || picked) return; const t = setTimeout(search, 250); return () => clearTimeout(t); }, [open, picked, search]);

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
    setPicked(null); setQ(""); setRows([]); setNotes(""); setDate(today());
    setFProvider(""); setFLocation(""); setFTech(""); setFAM(""); setErr(null);
  }
  function close() { setOpen(false); reset(); }

  async function post() {
    if (!picked || !ledgerId) return;
    setPosting(true); setErr(null);
    try {
      const r = await fetch("/api/portal/dispute-charge", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "penalty", jobId: picked.id, ledgerId, date, notes: notes.trim() || null }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      close(); router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed to post"); } finally { setPosting(false); }
  }

  const sel = (label: string, value: string, onChange: (v: string) => void, options: string[]) => (
    <div>
      <label className="portal-label" style={{ fontSize: 11 }}>{label}</label>
      <select className="portal-input" value={value} onChange={(e) => onChange(e.target.value)} style={{ padding: "6px 8px" }}>
        <option value="">All</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  return (
    <>
      <button className="portal-btn" onClick={() => setOpen(true)}>+ Penalty</button>
      {open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 100, paddingTop: 44, paddingBottom: 40, overflowY: "auto" }}
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div style={{ background: "#111827", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 22, width: "min(720px, 96vw)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#f1f5f9" }}>New Penalty — charge {ledgerName ? `${ledgerName}'s` : "the AM's"} 50%</h2>
              <button onClick={close} className="portal-btn portal-btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }}>✕</button>
            </div>

            {!picked ? (
              <div>
                <label className="portal-label">Find the penalty (X-close job — address, tech, provider)</label>
                <input className="portal-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. 123 Main St / Idan / SPE" />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 8 }}>
                  {sel("Provider", fProvider, setFProvider, opts.providers)}
                  {sel("Location", fLocation, setFLocation, opts.locations)}
                  {sel("Area manager", fAM, setFAM, opts.ams)}
                  {sel("Technician", fTech, setFTech, opts.techs)}
                </div>
                <div style={{ maxHeight: 340, overflowY: "auto", marginTop: 10, border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8 }}>
                  {rows.length === 0 ? (
                    <div className="muted small" style={{ padding: 14, textAlign: "center" }}>{loading ? "Searching…" : "No X-close penalties match — adjust the filters."}</div>
                  ) : (
                    <table className="portal-table" style={{ margin: 0 }}>
                      <thead><tr><th>Date</th><th>Address</th><th>Tech</th><th>Provider</th><th className="right">AM 50%</th></tr></thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => setPicked(r)}>
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
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div style={{ gridColumn: "span 2", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <strong>{picked.address || picked.id}</strong> <span className="muted small">· {picked.tech || "—"} · {picked.location || "—"} · {picked.provider || "—"}</span>
                    <div className="muted small">X-close · job profit {money(picked.jobProfit)}</div>
                  </div>
                  <button className="portal-btn portal-btn-ghost" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => setPicked(null)}>Change</button>
                </div>

                <div style={{ gridColumn: "span 2", border: "1px solid rgba(129,140,248,0.3)", background: "rgba(129,140,248,0.06)", borderRadius: 10, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                    <span className="small muted">Posts to {ledgerName ?? "this"}&apos;s ledger · Area Manager 50%</span>
                    <span style={{ fontSize: 20, fontWeight: 800, color: "#c7d2fe" }}>{money(picked.amLoss)}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, fontSize: 12 }}>
                    <div><span className="muted" style={{ fontSize: 10 }}>Total loss</span><div style={{ fontWeight: 600 }}>{money(picked.totalLoss)}</div></div>
                    <div><span className="muted" style={{ fontSize: 10 }}>AM 50% (charged)</span><div style={{ fontWeight: 600 }}>{money(picked.amLoss)}</div></div>
                    <div><span className="muted" style={{ fontSize: 10 }}>Company 50% (not charged)</span><div style={{ fontWeight: 600 }}>{money(picked.companyLoss)}</div></div>
                  </div>
                </div>

                <div>
                  <label className="portal-label">Date</label>
                  <input type="date" className="portal-input" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div>
                  <label className="portal-label">Notes</label>
                  <input className="portal-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
                </div>

                {err && <div className="portal-alert portal-alert-error" style={{ gridColumn: "span 2" }}>{err}</div>}
                <div style={{ gridColumn: "span 2", display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button className="portal-btn portal-btn-ghost" onClick={close}>Cancel</button>
                  <button className="portal-btn portal-btn-primary" onClick={post} disabled={posting}>{posting ? "Posting…" : "Post penalty → ledger"}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
