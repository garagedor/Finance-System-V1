"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fmt$ } from "../../format";
import type { EquipmentOrderStatus } from "@/types/equipment";

interface Perms {
  approve: boolean;
  deliver: boolean;
  postLedger: boolean;
}

export default function OrderActions({
  orderId,
  orderNumber,
  status,
  areaManagerName,
  amChargeTotal,
  itemCount,
  lineCount,
  perms,
}: {
  orderId: string;
  orderNumber: string;
  status: EquipmentOrderStatus;
  areaManagerName: string;
  amChargeTotal: number;
  itemCount: number;
  lineCount: number;
  perms: Perms;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const run = async (action: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/equipment/orders/${orderId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
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

  const canApproveNow = perms.approve && (status === "Draft" || status === "PendingApproval");
  const canDeliverNow = perms.deliver && (status === "Approved" || status === "ReadyForPickup");
  const canPostNow = perms.postLedger && (status === "Approved" || status === "Delivered");
  const canCancelNow = perms.approve && status !== "Cancelled" && status !== "ChargedToLedger";

  return (
    <div className="portal-card" style={{ padding: 16 }}>
      <div className="portal-card-head-title" style={{ marginBottom: 12 }}>Actions</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {canApproveNow && <button className="portal-btn portal-btn-primary" disabled={busy} onClick={() => run("approve")}>Approve</button>}
        {canDeliverNow && <button className="portal-btn" disabled={busy} onClick={() => run("mark_delivered")}>Mark delivered</button>}
        {canPostNow && <button className="portal-btn portal-btn-primary" disabled={busy} onClick={() => setConfirmOpen(true)}>Add to Ledger</button>}
        {canCancelNow && <button className="portal-btn portal-btn-danger" disabled={busy} onClick={() => { if (confirm("Cancel this order?")) run("cancel"); }}>Cancel order</button>}
      </div>

      {!canApproveNow && !canDeliverNow && !canPostNow && !canCancelNow && (
        <div className="muted small">No actions available for you at this stage.</div>
      )}
      {status === "Draft" && (
        <div className="muted small" style={{ marginTop: 8 }}>A Draft cannot be charged — approve it first.</div>
      )}
      {error && <div className="portal-alert portal-alert-error" style={{ marginTop: 10 }}>{error}</div>}

      {/* Confirm modal for ledger posting */}
      {confirmOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 100, paddingTop: 80 }}
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmOpen(false); }}>
          <div style={{ background: "#111827", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 24, width: "min(520px, 92vw)" }}>
            <h2 style={{ margin: "0 0 6px", fontSize: 17, fontWeight: 700, color: "#f1f5f9" }}>Charge to ledger?</h2>
            <p className="muted small" style={{ marginTop: 0 }}>This posts a one-time debit to the Area Manager&apos;s ledger. It cannot be posted twice.</p>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 14px", margin: "14px 0", fontSize: 13 }}>
              <span className="muted">Area Manager</span><strong>{areaManagerName}</strong>
              <span className="muted">Order number</span><span className="mono">{orderNumber}</span>
              <span className="muted">Products / units</span><span>{lineCount} product{lineCount === 1 ? "" : "s"} · {itemCount} unit{itemCount === 1 ? "" : "s"}</span>
              <span className="muted">Ledger effect</span><span>Debit — AM owes the company</span>
              <span className="muted">Description</span><span>Equipment order {orderNumber}</span>
              <span className="muted">Reference</span><span className="mono">{orderNumber}</span>
              <span className="muted">Amount</span><strong style={{ fontSize: 18 }}>{fmt$(amChargeTotal)}</strong>
            </div>
            {error && <div className="portal-alert portal-alert-error" style={{ marginBottom: 10 }}>{error}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="portal-btn portal-btn-ghost" disabled={busy} onClick={() => setConfirmOpen(false)}>Cancel</button>
              <button className="portal-btn portal-btn-primary" disabled={busy} onClick={() => run("post_to_ledger")}>
                {busy ? "Posting…" : `Charge ${fmt$(amChargeTotal)}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
