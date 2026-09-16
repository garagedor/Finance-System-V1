"use client";

// Dispute / refund entry — the ONE UI both entry points use.
//   • Ledger flow (ledgerId set): tick one OR MANY collected ScanPay disputes,
//     pick ONE party, and post each dispute's slice to this ledger in one go.
//     The technician slice uses each dispute's OWN job tech %.
//   • Disputes module (no ledgerId): pick a single job, type an amount, preview.
// The UI never computes money — the server service does every calculation.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import FilterMultiSelect from "./FilterMultiSelect";

type Job = {
  _id: string; date: string | null; address: string | null; clientName: string | null;
  tech: string | null; location: string | null; provider: string | null;
  jobAmount: number; grossTip: number; parts: number; collected: number;
};
// A collected ScanPay dispute (already carries its amount + matched job).
type Dispute = {
  id: string; disputeId: string; amount: number; invoiceNumber: string;
  customerName: string; serviceAddress: string; reason: string; disputedAt: string;
  matchedJobId: string; matchStatus: string;
  provider: string; location: string; tech: string;
  charged: boolean; chargedAt: string | null;
};
type Snap = {
  amLedgerCharge: number; technicianPortion: number; areaManagerOwnPortion: number;
  providerCharge: number; companyCharge: number; partsLoss: number;
  disputeClassification: "full" | "partial"; netTip: number; operationalProfit: number;
  totalCollected: number; areaManagerName?: string;
};

const money = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);

const PARTIES = [["technician", "Technician"], ["area_manager", "Area Manager"], ["provider", "Provider"], ["combined", "AM + Technician"]] as const;

export default function DisputeChargeModal({
  type,
  triggerLabel,
  primary,
  ledgerId,
  ledgerName,
}: {
  type: "dispute" | "refund";
  triggerLabel?: string;
  primary?: boolean;
  /** When set, the charge posts to THIS ledger (no duplicate AM ledger). */
  ledgerId?: string;
  /** Display-only name of that ledger, for the "posts to …" label. */
  ledgerName?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  // Structured filters (multi-value) + a date range (combine with the text box).
  const [fProvider, setFProvider] = useState<string[]>([]);
  const [fLocation, setFLocation] = useState<string[]>([]);
  const [fTech, setFTech] = useState<string[]>([]);
  const [fAM, setFAM] = useState<string[]>([]);
  const [fStart, setFStart] = useState("");
  const [fEnd, setFEnd] = useState("");
  const [opts, setOpts] = useState<{ providers: string[]; locations: string[]; techs: string[]; ams: string[] }>(
    { providers: [], locations: [], techs: [], ams: [] },
  );
  const [jobs, setJobs] = useState<Job[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  // Ledger flow: the set of collected disputes ticked for a bulk charge.
  const [selected, setSelected] = useState<string[]>([]);
  // Ledger flow: the ONE party applied to every ticked dispute.
  const [party, setParty] = useState<"" | "technician" | "area_manager" | "provider" | "combined">("");
  // Disputes-module flow: single job + typed amount + live preview.
  const [job, setJob] = useState<Job | null>(null);
  const [amount, setAmount] = useState("");
  const [preview, setPreview] = useState<Snap | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const label = type === "dispute" ? "Dispute" : "Refund";

  const search = useCallback(async () => {
    setLoadingJobs(true);
    try {
      const p = new URLSearchParams();
      if (q.trim()) p.set("q", q.trim());
      if (fProvider.length) p.set("provider", fProvider.join(","));
      if (fLocation.length) p.set("location", fLocation.join(","));
      if (fTech.length) p.set("tech", fTech.join(","));
      if (fAM.length) p.set("areaManager", fAM.join(","));
      if (fStart) p.set("startDate", fStart);
      if (fEnd) p.set("endDate", fEnd);
      if (ledgerId) {
        const r = await fetch(`/api/portal/dispute-charge/disputes?${p.toString()}`);
        const j = await r.json();
        const list: Dispute[] = Array.isArray(j.disputes) ? j.disputes : [];
        setDisputes(list);
        setSelected((s) => s.filter((id) => list.some((d) => d.id === id)));
      } else {
        const r = await fetch(`/api/portal/dispute-charge/jobs?${p.toString()}`);
        const j = await r.json();
        setJobs(Array.isArray(j.jobs) ? j.jobs : []);
      }
    } catch { setJobs([]); setDisputes([]); } finally { setLoadingJobs(false); }
  }, [q, fProvider, fLocation, fTech, fAM, fStart, fEnd, ledgerId]);

  useEffect(() => {
    if (!open) return;
    if (!ledgerId && job) return; // module flow freezes the list once a job is picked
    const t = setTimeout(search, 250);
    return () => clearTimeout(t);
  }, [open, job, ledgerId, search]);

  // Load filter option lists once when the modal opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const rows = (j: unknown): string[] =>
      Array.isArray((j as { rows?: unknown[] })?.rows)
        ? ((j as { rows: Array<{ _id?: unknown }> }).rows.map((d) => String(d?._id ?? "")).filter(Boolean))
        : [];
    (async () => {
      try {
        const [p, l, t, a] = await Promise.all([
          fetch("/api/providers?pageSize=2000").then((r) => r.json()).catch(() => ({})),
          fetch("/api/locations?pageSize=2000").then((r) => r.json()).catch(() => ({})),
          fetch("/api/techs?pageSize=2000").then((r) => r.json()).catch(() => ({})),
          fetch("/api/portal/locations/area-manager").then((r) => r.json()).catch(() => ({})),
        ]);
        if (cancelled) return;
        setOpts({
          providers: rows(p),
          locations: rows(l),
          techs: rows(t),
          ams: Array.isArray((a as { amOptions?: string[] })?.amOptions) ? (a as { amOptions: string[] }).amOptions : [],
        });
      } catch { /* leave options empty; text search still works */ }
    })();
    return () => { cancelled = true; };
  }, [open]);

  // Live dry-run preview (Disputes module only) whenever job + amount are valid.
  useEffect(() => {
    const clear = () => { setPreview(null); setPreviewErr(null); };
    if (!open || ledgerId || !job) { clear(); return; }
    const a = parseFloat(amount);
    if (!Number.isFinite(a) || a <= 0) { clear(); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch("/api/portal/dispute-charge", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, jobId: job._id, amount: a, dryRun: true }),
        });
        const j = await r.json();
        if (!r.ok) { setPreview(null); setPreviewErr(j.error || "Could not compute"); }
        else { setPreview({ ...j.snapshot, areaManagerName: j.areaManagerName }); setPreviewErr(null); }
      } catch { setPreview(null); setPreviewErr("Could not compute"); }
    }, 300);
    return () => clearTimeout(t);
  }, [open, job, amount, type, ledgerId]);

  function reset() {
    setJob(null); setQ(""); setJobs([]); setDisputes([]); setSelected([]); setParty("");
    setAmount(""); setNotes(""); setDate(today());
    setFProvider([]); setFLocation([]); setFTech([]); setFAM([]); setFStart(""); setFEnd("");
    setPreview(null); setPreviewErr(null); setErr(null);
  }
  function close() { setOpen(false); reset(); }

  // ── Ledger bulk selection helpers ──
  const toggle = (id: string) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const allSelected = disputes.length > 0 && disputes.every((d) => selected.includes(d.id));
  const toggleAll = () => setSelected(allSelected ? [] : disputes.map((d) => d.id));
  const grossTotal = disputes.filter((d) => selected.includes(d.id)).reduce((sum, d) => sum + d.amount, 0);

  // Bulk post (ledger flow) — one party applied to every ticked dispute.
  async function postBulk() {
    if (!ledgerId || selected.length === 0) return;
    if (!party) { setErr("Choose which party's slice to charge"); return; }
    const chosen = disputes.filter((d) => selected.includes(d.id));
    setPosting(true); setErr(null);
    try {
      const r = await fetch("/api/portal/dispute-charge", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type, ledgerId, party, date, notes: notes.trim() || null,
          disputes: chosen.map((d) => ({ jobId: d.matchedJobId, amount: d.amount, scanpayDisputeId: d.id })),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      close(); router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed to post"); } finally { setPosting(false); }
  }

  // Single post (Disputes module) — job + typed amount.
  async function postSingle() {
    if (!job) return;
    const a = parseFloat(amount);
    if (!Number.isFinite(a) || a <= 0) { setErr("Enter an amount greater than 0"); return; }
    setPosting(true); setErr(null);
    try {
      const r = await fetch("/api/portal/dispute-charge", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, jobId: job._id, amount: a, date, notes: notes.trim() || null }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      close(); router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed to post"); } finally { setPosting(false); }
  }

  const partyLabel = (v: string) => v === "area_manager" ? "area manager" : v === "combined" ? "AM + tech (combined)" : v;

  return (
    <>
      <button className={`portal-btn ${primary ? "portal-btn-primary" : ""}`} onClick={() => setOpen(true)}>
        {triggerLabel ?? `+ New ${label.toLowerCase()}`}
      </button>

      {open && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 100, paddingTop: 44, paddingBottom: 40, overflowY: "auto" }}
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          <div style={{ background: "#111827", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 22, width: "min(760px, 96vw)" }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#f1f5f9" }}>New {label} — charge to {ledgerId ? `${ledgerName ?? "this"}’s ledger` : "Area Manager"}</h2>
              <button onClick={close} className="portal-btn portal-btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }}>✕</button>
            </div>

            {/* ═══ LEDGER FLOW: multi-select collected disputes + one party ═══ */}
            {ledgerId ? (
              <div>
                <label className="portal-label">Find disputes (invoice, customer, address, tech, reason)</label>
                <input className="portal-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. IN-1783… / Smith / Idan / Fraudulent" />
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

                <div style={{ maxHeight: 300, overflowY: "auto", marginTop: 10, border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8 }}>
                  {disputes.length === 0 ? (
                    <div className="muted small" style={{ padding: 14, textAlign: "center" }}>{loadingJobs ? "Searching…" : "No collected disputes match — adjust the filters (only job-matched disputes are chargeable)."}</div>
                  ) : (
                    <table className="portal-table" style={{ margin: 0 }}>
                      <thead><tr>
                        <th style={{ width: 30 }}><input type="checkbox" checked={allSelected} onChange={toggleAll} title="Select all" /></th>
                        <th>Filed</th><th>Customer / invoice</th><th>Tech</th><th>Location</th><th className="right">Amount</th>
                      </tr></thead>
                      <tbody>
                        {disputes.map((d) => (
                          <tr key={d.id} style={{ cursor: "pointer", background: selected.includes(d.id) ? "rgba(129,140,248,0.08)" : undefined }} onClick={() => toggle(d.id)}>
                            <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.includes(d.id)} onChange={() => toggle(d.id)} /></td>
                            <td className="small mono">{d.disputedAt ? d.disputedAt.slice(0, 10) : "—"}</td>
                            <td>{d.customerName || d.serviceAddress || "—"}
                              <div className="muted small">{d.invoiceNumber}{d.reason ? ` · ${d.reason}` : ""}{d.charged ? " · ✓ charged" : ""}</div>
                            </td>
                            <td className="small">{d.tech || "—"}</td>
                            <td className="small muted">{d.location || "—"}</td>
                            <td className="right money">{money(d.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Party + date/notes + post — one party applies to every ticked dispute */}
                <div style={{ marginTop: 12 }}>
                  <label className="portal-label">Charge which party&apos;s slice? <span style={{ color: "#f87171" }}>*</span> <span className="muted small">(applied to all selected · technician slice uses each job&apos;s own %)</span></label>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {PARTIES.map(([v, l]) => (
                      <button key={v} type="button"
                        className={`portal-btn ${party === v ? "portal-btn-primary" : "portal-btn-ghost"}`}
                        style={{ padding: "6px 12px", fontSize: 13 }}
                        onClick={() => setParty(v)}>{l}</button>
                    ))}
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
                  <div><label className="portal-label">Date</label><input type="date" className="portal-input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
                  <div><label className="portal-label">Notes</label><input className="portal-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></div>
                </div>

                {err && <div className="portal-alert portal-alert-error" style={{ marginTop: 10 }}>{err}</div>}
                <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
                  <span className="muted small">{selected.length} selected · gross {money(grossTotal)}{party ? ` · posting the ${partyLabel(party)} slice of each` : ""}</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="portal-btn portal-btn-ghost" onClick={close}>Cancel</button>
                    <button className="portal-btn portal-btn-primary" onClick={postBulk} disabled={posting || selected.length === 0 || !party}>
                      {posting ? "Posting…" : `Post ${selected.length || ""} ${label.toLowerCase()}${selected.length === 1 ? "" : "s"} → ledger`}
                    </button>
                  </div>
                </div>
              </div>
            ) : !job ? (
              /* ═══ DISPUTES MODULE: Step 1 — pick a single job ═══ */
              <div>
                <label className="portal-label">Find the job (address, customer, or tech)</label>
                <input className="portal-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") search(); }} placeholder="e.g. 123 Main St / Smith / Idan" />
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
                <div style={{ maxHeight: 340, overflowY: "auto", marginTop: 10, border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8 }}>
                  {jobs.length === 0 ? (
                    <div className="muted small" style={{ padding: 14, textAlign: "center" }}>{loadingJobs ? "Searching…" : (q || fProvider.length || fLocation.length || fAM.length || fTech.length || fStart || fEnd) ? "No jobs match your search / filters." : "Type or pick a filter to find jobs."}</div>
                  ) : (
                    <table className="portal-table" style={{ margin: 0 }}>
                      <thead><tr><th>Date</th><th>Address</th><th>Tech</th><th>Location</th><th className="right">Collected</th></tr></thead>
                      <tbody>
                        {jobs.map((j) => (
                          <tr key={j._id} style={{ cursor: "pointer" }} onClick={() => setJob(j)}>
                            <td className="small mono">{j.date ?? "—"}</td>
                            <td>{j.address ?? "—"}<div className="muted small">{j.clientName ?? ""}</div></td>
                            <td className="small">{j.tech ?? "—"}</td>
                            <td className="small muted">{j.location ?? "—"}</td>
                            <td className="right money">{money(j.collected)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            ) : (
              /* ═══ DISPUTES MODULE: Step 2 — amount + preview ═══ */
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div style={{ gridColumn: "span 2", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <strong>{job.clientName ?? job.address ?? job._id}</strong> <span className="muted small">· {job.tech ?? "—"} · {job.location ?? "—"}</span>
                    <div className="muted small">Collected {money(job.collected)} · tip {money(job.grossTip)} · parts {money(job.parts)}</div>
                  </div>
                  <button className="portal-btn portal-btn-ghost" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => setJob(null)}>Change job</button>
                </div>

                <div>
                  <label className="portal-label">{label} amount <span style={{ color: "#f87171" }}>*</span></label>
                  <input type="number" step="0.01" min="0" className="portal-input" autoFocus value={amount}
                    onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
                </div>
                <div>
                  <label className="portal-label">Date</label>
                  <input type="date" className="portal-input" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div style={{ gridColumn: "span 2" }}>
                  <label className="portal-label">Notes</label>
                  <input className="portal-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
                </div>

                <div style={{ gridColumn: "span 2" }}>
                  {previewErr ? (
                    <div className="portal-alert portal-alert-error">{previewErr}</div>
                  ) : preview ? (
                    <div style={{ border: "1px solid rgba(129,140,248,0.3)", background: "rgba(129,140,248,0.06)", borderRadius: 10, padding: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                        <span className="small muted">Posts to {preview.areaManagerName}&apos;s ledger · <span style={{ textTransform: "capitalize" }}>{preview.disputeClassification}</span> {label.toLowerCase()}</span>
                        <span style={{ fontSize: 20, fontWeight: 800, color: "#c7d2fe" }}>{money(preview.amLedgerCharge)}</span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, fontSize: 12 }}>
                        <Fig label="Technician portion" v={preview.technicianPortion} />
                        <Fig label="AM own portion" v={preview.areaManagerOwnPortion} />
                        <Fig label="Provider" v={preview.providerCharge} />
                        <Fig label="Company" v={preview.companyCharge} />
                        <Fig label="Parts loss (100% tech)" v={preview.partsLoss} />
                        <Fig label="Op. profit / net tip" v={preview.operationalProfit} extra={money(preview.netTip)} />
                      </div>
                    </div>
                  ) : (
                    <div className="muted small">Enter an amount to preview the charge…</div>
                  )}
                </div>

                {err && <div className="portal-alert portal-alert-error" style={{ gridColumn: "span 2" }}>{err}</div>}

                <div style={{ gridColumn: "span 2", display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button className="portal-btn portal-btn-ghost" onClick={close}>Cancel</button>
                  <button className="portal-btn portal-btn-primary" onClick={postSingle} disabled={posting || !preview}>
                    {posting ? "Posting…" : `Post ${label.toLowerCase()} → AM ledger`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Fig({ label, v, extra }: { label: string; v: number; extra?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span className="muted" style={{ fontSize: 10 }}>{label}</span>
      <span style={{ fontWeight: 600 }}>${(Math.round((Number(v) || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{extra ? ` / ${extra}` : ""}</span>
    </div>
  );
}
