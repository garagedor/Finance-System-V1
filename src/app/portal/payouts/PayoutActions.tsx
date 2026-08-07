"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PayoutProfile, PayoutRecord } from "@/types/finance";
import NewPayoutForm, { type PayoutLedgerOption } from "./NewPayoutForm";

export default function PayoutActions({
  payout,
  profiles,
  ledgers,
  onDeletedHref,
}: {
  payout: PayoutRecord;
  profiles: PayoutProfile[];
  ledgers: PayoutLedgerOption[];
  onDeletedHref?: string; // where to go after delete (detail page → list)
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const paid = payout.status === "paid";

  const toggle = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/portal/payouts/${payout._id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: paid ? "mark_unpaid" : "mark_paid" }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error || "Failed"); }
      else router.refresh();
    } finally { setBusy(false); }
  };

  const del = async () => {
    if (!confirm(`Delete payout for ${payout.recipient_name}? Its ledger entry (if any) is removed too.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/portal/payouts/${payout._id}`, { method: "DELETE" });
      if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error || "Failed"); setBusy(false); return; }
      if (onDeletedHref) router.push(onDeletedHref);
      else router.refresh();
    } catch { setBusy(false); }
  };

  return (
    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
      <NewPayoutForm initial={payout} profiles={profiles} ledgers={ledgers} triggerLabel="Edit" />
      <button className={`portal-btn ${paid ? "" : "portal-btn-primary"}`} onClick={toggle} disabled={busy} style={{ padding: "4px 10px", fontSize: 11 }}>
        {paid ? "Mark unpaid" : "Mark paid"}
      </button>
      <a className="portal-btn" href={`/payout-statement/${payout._id}`} target="_blank" rel="noopener noreferrer" style={{ padding: "4px 10px", fontSize: 11 }}>
        PDF
      </a>
      <button className="portal-btn portal-btn-danger" onClick={del} disabled={busy} style={{ padding: "4px 10px", fontSize: 11 }}>
        Delete
      </button>
    </div>
  );
}
