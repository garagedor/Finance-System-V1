"use client";

// Resolve a dispute: won / lost / partial + the date the outcome landed on.
// The date is what the dashboard uses to book the recovered company-slice into
// the correct month. Submits to the targeted /resolve endpoint (never the CRUD
// PUT, which would reset the filed date / disputed amount).

import { useState } from "react";
import { useRouter } from "next/navigation";

type Outcome = "won" | "lost" | "partial";

export default function ResolveDisputeModal({
  id,
  amountDisputed,
  currentStatus,
}: {
  id: string;
  amountDisputed: number;
  currentStatus: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>("won");
  const [recovered, setRecovered] = useState<string>("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  // What will actually be recovered given the outcome.
  const effectiveRecovered =
    outcome === "won" ? amountDisputed
    : outcome === "lost" ? 0
    : Math.min(amountDisputed, Math.max(0, parseFloat(recovered) || 0));

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/portal/disputes/${encodeURIComponent(id)}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: outcome,
          amount_recovered: outcome === "partial" ? effectiveRecovered : undefined,
          resolved_date: date,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        className="portal-btn"
        onClick={() => setOpen(true)}
        style={{ padding: "4px 10px", fontSize: 11 }}
      >
        {currentStatus === "open" ? "Resolve" : "Edit outcome"}
      </button>

      {open && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 100, paddingTop: 60, overflowY: "auto",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            style={{ background: "#111827", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 24, width: "min(460px, 95vw)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#f1f5f9" }}>Resolve dispute</h2>
              <button onClick={() => setOpen(false)} className="portal-btn portal-btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }}>✕</button>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label className="portal-label">Outcome</label>
              <div style={{ display: "flex", gap: 8 }}>
                {(["won", "partial", "lost"] as Outcome[]).map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => setOutcome(o)}
                    className={`portal-btn ${outcome === o ? "portal-btn-primary" : ""}`}
                    style={{ flex: 1, textTransform: "capitalize" }}
                  >
                    {o}
                  </button>
                ))}
              </div>
            </div>

            {outcome === "partial" && (
              <div style={{ marginBottom: 12 }}>
                <label className="portal-label">Amount recovered (of ${amountDisputed.toLocaleString()})</label>
                <input
                  type="number" step="0.01" min="0" max={amountDisputed} className="portal-input"
                  value={recovered} onChange={(e) => setRecovered(e.target.value)} placeholder="0.00"
                />
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <label className="portal-label">Resolved on (which month it affects) *</label>
              <input type="date" className="portal-input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>

            <div className="portal-alert" style={{ marginBottom: 14, background: "rgba(99,102,241,0.10)", border: "1px solid rgba(99,102,241,0.25)" }}>
              <span>i</span>
              <div className="small">
                {outcome === "lost"
                  ? "Loss stays booked in the month it was filed — nothing recovered."
                  : `Recovers ${effectiveRecovered === amountDisputed ? "the full" : "a portion of the"} amount; the company's slice of that is credited to ${date}'s month.`}
              </div>
            </div>

            {err && <div className="portal-alert portal-alert-error" style={{ marginBottom: 10 }}>{err}</div>}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="portal-btn portal-btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" className="portal-btn portal-btn-primary" onClick={submit} disabled={busy}>
                {busy ? "Saving…" : "Save outcome"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
