"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Job = { _id: string; date: string | null; address: string | null; clientName: string | null; tech: string | null; collected: number };

const money = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dayOf = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));

export default function ScanpayRefundRowActions({
  id, matchStatus, suggestedJobId, suggestedLabel, originalAmount, paymentDate, chargedAt,
}: {
  id: string;
  matchStatus: string;
  suggestedJobId: string | null;
  suggestedLabel: string | null;
  originalAmount: number;
  paymentDate: string | null;
  chargedAt: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [jobId, setJobId] = useState<string | null>(suggestedJobId);
  const [jobLabel, setJobLabel] = useState<string | null>(suggestedLabel);
  const [amount, setAmount] = useState(String(originalAmount || ""));
  const [date, setDate] = useState(dayOf(paymentDate));

  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/portal/dispute-charge/jobs?q=${encodeURIComponent(q.trim())}`);
      const j = await r.json();
      setJobs(Array.isArray(j.jobs) ? j.jobs : []);
    } catch { setJobs([]); } finally { setLoading(false); }
  }, [q]);

  useEffect(() => {
    if (!picking) return;
    const t = setTimeout(search, 250);
    return () => clearTimeout(t);
  }, [picking, q, search]);

  const simple = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/portal/scanpay/refunds/${encodeURIComponent(id)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }, [id, router]);

  async function post() {
    const a = parseFloat(amount);
    if (!jobId) { setErr("Pick a job"); return; }
    if (!Number.isFinite(a) || a <= 0) { setErr("Enter the refunded amount"); return; }
    await simple({ action: "verify", jobId, amount: a, date });
  }

  const chargedToggle = (
    <button
      className={`portal-btn ${chargedAt ? "portal-btn-primary" : "portal-btn-ghost"}`}
      style={{ padding: "4px 10px", fontSize: 11 }}
      disabled={busy}
      title={chargedAt ? `Charged ${chargedAt} — click to unmark` : "Mark the parties charged their slices"}
      onClick={() => simple({ action: chargedAt ? "uncharge" : "charge" })}
    >
      {chargedAt ? "✅ Charged" : "Mark charged"}
    </button>
  );

  if (matchStatus === "posted") {
    return (
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
        <span className="muted small">✓ posted</span>
        {chargedToggle}
      </div>
    );
  }
  if (matchStatus === "ignored") {
    return <button className="portal-btn" style={{ padding: "4px 10px", fontSize: 11 }} disabled={busy} onClick={() => simple({ action: "reopen" })}>Restore</button>;
  }
  // Verified — job + amount confirmed + on the report; next step is Post.
  if (matchStatus === "verified") {
    return (
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
        {err && <span className="small" style={{ color: "#f87171" }}>{err}</span>}
        <span className="muted small" style={{ color: "#34d399" }}>✔ verified</span>
        <button className="portal-btn portal-btn-primary" style={{ padding: "4px 10px", fontSize: 11 }} disabled={busy}
          onClick={() => simple({ action: "confirm" })}>Post → ledger</button>
        <button className="portal-btn" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => setOpen(true)}>Edit</button>
        <button className="portal-btn portal-btn-ghost" style={{ padding: "4px 10px", fontSize: 11 }} disabled={busy}
          onClick={() => simple({ action: "unverify" })}>Unverify</button>
        {chargedToggle}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
      {suggestedJobId && (
        <button className="portal-btn portal-btn-primary" style={{ padding: "4px 10px", fontSize: 11 }} title={jobLabel ?? undefined}
          onClick={() => { setPicking(false); setOpen(true); }}>Verify</button>
      )}
      <button className="portal-btn" style={{ padding: "4px 10px", fontSize: 11 }}
        onClick={() => { setPicking(true); setOpen(true); }}>Pick job</button>
      <button className="portal-btn portal-btn-ghost" style={{ padding: "4px 10px", fontSize: 11 }} disabled={busy} onClick={() => simple({ action: "ignore" })}>Ignore</button>
      {chargedToggle}

      {open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 100, paddingTop: 50, overflowY: "auto" }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div style={{ background: "#111827", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 20, width: "min(640px, 96vw)", textAlign: "left" }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 15, color: "#f1f5f9" }}>Verify refund — match job + amount</h3>
              <button className="portal-btn portal-btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setOpen(false)}>✕</button>
            </div>

            {/* Job */}
            <label className="portal-label">Job</label>
            {jobId && !picking ? (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "8px 10px", marginBottom: 12 }}>
                <span className="small">{jobLabel ?? jobId}</span>
                <button className="portal-btn portal-btn-ghost" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => setPicking(true)}>Change</button>
              </div>
            ) : (
              <div style={{ marginBottom: 12 }}>
                <input className="portal-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search job by address / customer / tech" onKeyDown={(e) => { if (e.key === "Enter") search(); }} />
                <div style={{ maxHeight: 240, overflowY: "auto", marginTop: 8, border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8 }}>
                  {jobs.length === 0 ? (
                    <div className="muted small" style={{ padding: 12, textAlign: "center" }}>{loading ? "Searching…" : "Type to search."}</div>
                  ) : (
                    <table className="portal-table" style={{ margin: 0 }}>
                      <tbody>
                        {jobs.map((j) => (
                          <tr key={j._id} style={{ cursor: "pointer" }} onClick={() => { setJobId(j._id); setJobLabel(j.address ?? j._id); setPicking(false); }}>
                            <td className="small mono">{j.date ?? "—"}</td>
                            <td>{j.address ?? "—"}<div className="muted small">{j.tech ?? ""}</div></td>
                            <td className="right money">{money(j.collected)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {/* Amount + date */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label className="portal-label">Refunded amount <span style={{ color: "#f87171" }}>*</span></label>
                <input type="number" step="0.01" min="0" className="portal-input" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <div className="muted small" style={{ marginTop: 2 }}>Originally paid {money(originalAmount)} — edit for partial refunds.</div>
              </div>
              <div>
                <label className="portal-label">Refund date <span style={{ color: "#f87171" }}>*</span></label>
                <input type="date" className="portal-input" value={date} onChange={(e) => setDate(e.target.value)} />
                <div className="muted small" style={{ marginTop: 2 }}>ScanPay doesn&apos;t supply this — set the actual date.</div>
              </div>
            </div>

            {err && <div className="portal-alert portal-alert-error" style={{ marginBottom: 10 }}>{err}</div>}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="portal-btn portal-btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
              <button className="portal-btn portal-btn-primary" onClick={post} disabled={busy || !jobId}>
                {busy ? "Saving…" : "Verify refund"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
