"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

interface JobSnapshot {
  customer?: string;
  address?: string;
  tech?: string;
  area?: string;
  provider?: string;
  total?: number;
  profit?: number;
  payment_method?: string;
  parts?: number;
  date?: string;
}

export default function NewFollowUpForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [jobId, setJobId] = useState("");
  const [job, setJob] = useState<JobSnapshot | null>(null);
  const [loadingJob, setLoadingJob] = useState(false);
  const [recipient, setRecipient] = useState({ id: "", name: "", role: "" });
  const [kind, setKind] = useState<"fixed" | "percent" | "manual">("fixed");
  const [amount, setAmount] = useState<string>("");
  const [rate, setRate] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchJob = async () => {
    if (!jobId.trim()) return;
    setLoadingJob(true);
    setErr(null);
    setJob(null);
    try {
      // CRM API: /api/jobs?_id=<id>
      const res = await fetch(`/api/jobs?id=${encodeURIComponent(jobId.trim())}&limit=1`);
      const j = await res.json();
      const row = j.rows?.[0];
      if (!row) {
        setErr(`Job ${jobId} not found`);
        return;
      }
      const total = parseFloat(row.totalAmount) || 0;
      const parts = parseFloat(row.companyParts || 0) + parseFloat(row.techParts || 0) + parseFloat(row.lmParts || 0);
      setJob({
        customer: row.customer ?? row.customerName,
        address: row.address,
        tech: row.tech,
        area: row.location,
        provider: row.provider,
        total,
        profit: total - parts,
        payment_method: row.paymentMethod,
        parts,
        date: row.date,
      });
    } catch {
      setErr("Failed to load job");
    } finally {
      setLoadingJob(false);
    }
  };

  const computedAmount = (() => {
    if (kind === "fixed") return parseFloat(amount) || 0;
    if (kind === "percent") {
      const r = parseFloat(rate) || 0;
      const base = job?.profit ?? 0;
      return r * base;
    }
    return parseFloat(amount) || 0;
  })();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    try {
      if (!jobId || !recipient.name) {
        setErr("Job ID and recipient name are required.");
        return;
      }
      const body = {
        job_id: jobId,
        job_snapshot: job ?? {},
        recipient_id: recipient.id || recipient.name.toLowerCase().replace(/\s+/g, "_"),
        recipient_name: recipient.name,
        recipient_role: recipient.role || null,
        kind,
        amount: kind === "fixed" || kind === "manual" ? parseFloat(amount) || 0 : null,
        rate: kind === "percent" ? parseFloat(rate) || 0 : null,
        computed_amount: computedAmount,
        notes: notes || null,
      };
      const res = await fetch("/api/portal/followup-commissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setOpen(false);
      setJobId("");
      setJob(null);
      setRecipient({ id: "", name: "", role: "" });
      setKind("fixed");
      setAmount("");
      setRate("");
      setNotes("");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button className="portal-btn" onClick={() => setOpen(true)}>+ Follow-up commission</button>

      {open && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "flex-start", justifyContent: "center",
            zIndex: 100, paddingTop: 40, paddingBottom: 40, overflowY: "auto",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            style={{
              background: "#111827", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14,
              padding: 24, width: "min(720px, 95vw)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>New follow-up commission</h2>
              <button onClick={() => setOpen(false)} className="portal-btn portal-btn-ghost"
                style={{ padding: "4px 10px", fontSize: 12 }}>✕</button>
            </div>

            <form onSubmit={onSubmit}>
              <div style={{ marginBottom: 14 }}>
                <label className="portal-label">CRM Job ID *</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <input className="portal-input" value={jobId}
                    onChange={(e) => setJobId(e.target.value)}
                    placeholder="Job _id from CRM"
                    required />
                  <button type="button" className="portal-btn" onClick={fetchJob} disabled={loadingJob}>
                    {loadingJob ? "…" : "Load"}
                  </button>
                </div>
              </div>

              {job && (
                <div className="portal-alert portal-alert-info" style={{ marginBottom: 14, display: "block" }}>
                  <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                    <strong>{job.customer ?? "—"}</strong> · {job.address ?? "—"} · {job.area ?? "—"}<br />
                    Tech: {job.tech ?? "—"} · Provider: {job.provider ?? "—"} · Date: {job.date ?? "—"}<br />
                    Total: ${(job.total ?? 0).toFixed(2)} · Parts: ${(job.parts ?? 0).toFixed(2)} · Profit:
                    <strong style={{ marginLeft: 4, color: "#10b981" }}>${(job.profit ?? 0).toFixed(2)}</strong>
                  </div>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
                <div>
                  <label className="portal-label">Recipient name *</label>
                  <input className="portal-input" required
                    value={recipient.name}
                    onChange={(e) => setRecipient({ ...recipient, name: e.target.value })} />
                </div>
                <div>
                  <label className="portal-label">Role</label>
                  <input className="portal-input"
                    value={recipient.role}
                    onChange={(e) => setRecipient({ ...recipient, role: e.target.value })}
                    placeholder="e.g. Office Manager" />
                </div>
                <div>
                  <label className="portal-label">Recipient ID (optional)</label>
                  <input className="portal-input"
                    value={recipient.id}
                    onChange={(e) => setRecipient({ ...recipient, id: e.target.value })} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
                <div>
                  <label className="portal-label">Commission kind *</label>
                  <select className="portal-select" value={kind}
                    onChange={(e) => setKind(e.target.value as "fixed" | "percent" | "manual")}>
                    <option value="fixed">Fixed amount</option>
                    <option value="percent">Percent of profit</option>
                    <option value="manual">Manual (free amount)</option>
                  </select>
                </div>
                {kind === "fixed" && (
                  <div>
                    <label className="portal-label">Amount *</label>
                    <input type="number" step="0.01" className="portal-input"
                      value={amount} onChange={(e) => setAmount(e.target.value)} required />
                  </div>
                )}
                {kind === "percent" && (
                  <div>
                    <label className="portal-label">Rate (decimal) *</label>
                    <input type="number" step="0.001" className="portal-input"
                      value={rate} onChange={(e) => setRate(e.target.value)} required
                      placeholder="0.05 = 5%" />
                  </div>
                )}
                {kind === "manual" && (
                  <div>
                    <label className="portal-label">Manual amount *</label>
                    <input type="number" step="0.01" className="portal-input"
                      value={amount} onChange={(e) => setAmount(e.target.value)} required />
                  </div>
                )}
                <div>
                  <label className="portal-label">Computed payout</label>
                  <div className="portal-input" style={{ background: "rgba(16,185,129,0.08)", borderColor: "rgba(16,185,129,0.3)" }}>
                    <span className="money" style={{ color: "#10b981", fontWeight: 700 }}>
                      ${computedAmount.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label className="portal-label">Notes</label>
                <textarea className="portal-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>

              {err && <div className="portal-alert portal-alert-error" style={{ marginBottom: 10 }}>{err}</div>}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="portal-btn portal-btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
                <button type="submit" className="portal-btn portal-btn-primary" disabled={submitting}>
                  {submitting ? "Saving…" : "Create commission"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
