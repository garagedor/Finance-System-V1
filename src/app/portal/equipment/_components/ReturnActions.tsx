"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fmt$ } from "../../format";

export default function ReturnActions({
  returnId,
  returnNumber,
  areaManagerName,
  status,
  creditApproved,
  creditAmount,
  suggested,
  orderCharged,
  canApprove,
}: {
  returnId: string;
  returnNumber: string;
  areaManagerName: string;
  status: string;
  creditApproved: boolean;
  creditAmount: number;
  suggested: number;
  orderCharged: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState<string>(String(creditAmount || suggested || 0));
  const [confirmOpen, setConfirmOpen] = useState(false);

  const call = async (action: string, extra?: Record<string, unknown>) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/portal/equipment/returns/${returnId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setConfirmOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="portal-card" style={{ padding: 16 }}>
      <div className="portal-card-head-title" style={{ marginBottom: 12 }}>Actions</div>

      {!canApprove && <div className="muted small">You can view this return but not approve or post its credit.</div>}

      {canApprove && status === "Draft" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 200 }}>
            <span className="portal-label">Credit amount</span>
            <input className="portal-input" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <button className="portal-btn portal-btn-primary" disabled={busy} onClick={() => call("approve", { creditAmount: Number(amount) })}>
            Approve credit
          </button>
          <span className="muted small">Suggested {fmt$(suggested)}.</span>
        </div>
      )}

      {canApprove && status === "Approved" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          {orderCharged ? (
            <button className="portal-btn portal-btn-primary" disabled={busy} onClick={() => setConfirmOpen(true)}>Post credit to ledger</button>
          ) : (
            <div className="muted small">The original order was never charged to a ledger — no credit to post.</div>
          )}
          <span className="muted small">Approved credit: <strong>{fmt$(creditAmount)}</strong></span>
        </div>
      )}

      {error && <div className="portal-alert portal-alert-error" style={{ marginTop: 10 }}>{error}</div>}

      {confirmOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 100, paddingTop: 80 }}
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmOpen(false); }}>
          <div style={{ background: "#111827", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 24, width: "min(500px, 92vw)" }}>
            <h2 style={{ margin: "0 0 6px", fontSize: 17, fontWeight: 700, color: "#f1f5f9" }}>Post credit to ledger?</h2>
            <p className="muted small" style={{ marginTop: 0 }}>This posts a one-time <strong>negative</strong> entry (a credit) to the AM&apos;s ledger. The original charge is never edited.</p>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 14px", margin: "14px 0", fontSize: 13 }}>
              <span className="muted">Area Manager</span><strong>{areaManagerName}</strong>
              <span className="muted">Return</span><span className="mono">{returnNumber}</span>
              <span className="muted">Ledger effect</span><span>Credit — reduces what the AM owes</span>
              <span className="muted">Amount</span><strong style={{ fontSize: 18 }}>−{fmt$(creditAmount)}</strong>
            </div>
            {error && <div className="portal-alert portal-alert-error" style={{ marginBottom: 10 }}>{error}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="portal-btn portal-btn-ghost" disabled={busy} onClick={() => setConfirmOpen(false)}>Cancel</button>
              <button className="portal-btn portal-btn-primary" disabled={busy} onClick={() => call("post_credit")}>
                {busy ? "Posting…" : `Credit ${fmt$(creditAmount)}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
