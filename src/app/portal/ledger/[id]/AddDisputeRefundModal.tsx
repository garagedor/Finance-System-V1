"use client";

// Dispute / refund entry from a ledger page. Per the architecture rule, this
// entry point must NOT calculate or post independently — it feeds the same
// shared engine as the Disputes module (lib/dispute-service via
// /api/portal/dispute-charge), which resolves the job → Location → assigned
// Area Manager, computes the split, and posts to that AM's ledger while also
// creating the canonical record in the Disputes module. So this is now a thin
// wrapper around the shared DisputeChargeModal — no gross × % math here.
//
// ledgerId / defaultTech are kept in the prop type for call-site compatibility
// but are intentionally unused: the engine derives the AM from the job's
// location, not from whichever ledger you happen to be viewing.

import DisputeChargeModal from "../../_components/DisputeChargeModal";

export default function AddDisputeRefundModal(
  _props: { ledgerId?: string; defaultTech?: string },
) {
  return (
    <span style={{ display: "inline-flex", gap: 6 }}>
      <DisputeChargeModal type="dispute" triggerLabel="+ Dispute" />
      <DisputeChargeModal type="refund" triggerLabel="+ Refund" />
    </span>
  );
}
