"use client";

// Dispute / refund entry — the ONE UI both entry points use. It only submits
// inputs (job + amount + type) to /api/portal/dispute-charge; the shared server
// service does every calculation and posts to the AM ledger. A live dry-run
// preview shows the breakdown before posting. The UI never computes money.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Job = {
  _id: string; date: string | null; address: string | null; clientName: string | null;
  tech: string | null; location: string | null; provider: string | null;
  jobAmount: number; grossTip: number; parts: number; collected: number;
};
type Snap = {
  amLedgerCharge: number; technicianPortion: number; areaManagerOwnPortion: number;
  providerCharge: number; companyCharge: number; partsLoss: number;
  disputeClassification: "full" | "partial"; netTip: number; operationalProfit: number;
  totalCollected: number; areaManagerName?: string;
};

const money = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);

export default function DisputeChargeModal({
  type,
  triggerLabel,
  primary,
}: {
  type: "dispute" | "refund";
  triggerLabel?: string;
  primary?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [preview, setPreview] = useState<Snap | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const label = type === "dispute" ? "Dispute" : "Refund";

  const search = useCallback(async () => {
    setLoadingJobs(true);
    try {
      const r = await fetch(`/api/portal/dispute-charge/jobs?q=${encodeURIComponent(q.trim())}`);
      const j = await r.json();
      setJobs(Array.isArray(j.jobs) ? j.jobs : []);
    } catch { setJobs([]); } finally { setLoadingJobs(false); }
  }, [q]);

  useEffect(() => {
    if (!open || job) return;
    const t = setTimeout(search, 250);
    return () => clearTimeout(t);
  }, [open, q, job, search]);

  // Live dry-run preview whenever job + amount are valid.
  useEffect(() => {
    if (!open || !job) { setPreview(null); setPreviewErr(null); return; }
    const a = parseFloat(amount);
    if (!Number.isFinite(a) || a <= 0) { setPreview(null); setPreviewErr(null); return; }
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
  }, [open, job, amount, type]);

  function reset() {
    setJob(null); setQ(""); setJobs([]); setAmount(""); setNotes(""); setDate(today());
    setPreview(null); setPreviewErr(null); setErr(null);
  }
  function close() { setOpen(false); reset(); }

  async function post() {
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
      close();
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to post");
    } finally { setPosting(false); }
  }

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
          <div style={{ background: "#111827", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 22, width: "min(720px, 96vw)" }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#f1f5f9" }}>New {label} — charge to Area Manager</h2>
              <button onClick={close} className="portal-btn portal-btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }}>✕</button>
            </div>

            {/* Step 1 — pick the job */}
            {!job ? (
              <div>
                <label className="portal-label">Find the job (address, customer, or tech)</label>
                <input className="portal-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") search(); }} placeholder="e.g. 123 Main St / Smith / Idan" />
                <div style={{ maxHeight: 340, overflowY: "auto", marginTop: 10, border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8 }}>
                  {jobs.length === 0 ? (
                    <div className="muted small" style={{ padding: 14, textAlign: "center" }}>{loadingJobs ? "Searching…" : "Type to search jobs."}</div>
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
              /* Step 2 — amount + preview */
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div style={{ gridColumn: "span 2", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <strong>{job.address ?? job._id}</strong> <span className="muted small">· {job.tech ?? "—"} · {job.location ?? "—"}</span>
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

                {/* Preview */}
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
                  <button className="portal-btn portal-btn-primary" onClick={post} disabled={posting || !preview}>
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
      <span style={{ fontWeight: 600 }}>${(Math.round(v * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{extra ? ` / ${extra}` : ""}</span>
    </div>
  );
}
