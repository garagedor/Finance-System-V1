"use client";

// Dispute / refund entry from a ledger page. Per the architecture rule, this
// entry point must NOT calculate or post independently — it feeds the same
// shared engine as the Disputes module (lib/dispute-service via
// /api/portal/dispute-charge), which resolves the job → Location → assigned
// Area Manager, computes the split, and posts to that AM's ledger while also
// creating the canonical record in the Disputes module. So this is now a thin
// wrapper around the shared DisputeChargeModal — no gross × % math here.
//
// A dispute/refund added from a specific ledger page posts to THAT ledger — we
// pass ledgerId through so the engine attaches the charge here instead of
// deriving (and duplicating) the job's AM ledger (owner rule 2026-09-11).
// ledgerName is display-only, for the "posts to …" label. defaultTech is unused.

import DisputeChargeModal from "../../_components/DisputeChargeModal";

export default function AddDisputeRefundModal(
  { ledgerId, ledgerName }: { ledgerId?: string; defaultTech?: string; ledgerName?: string },
) {
  return (
    <span style={{ display: "inline-flex", gap: 6 }}>
      <DisputeChargeModal type="dispute" triggerLabel="+ Dispute" ledgerId={ledgerId} ledgerName={ledgerName} />
      <DisputeChargeModal type="refund" triggerLabel="+ Refund" ledgerId={ledgerId} ledgerName={ledgerName} />
    </span>
  );
}
