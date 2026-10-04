"use client";

// Dispute/refund breakdown for a ledger entry. Content comes from the shared
// formatter (lib/dispute-detail) and renders via the shared DisputeDetailLines,
// so the ledger page and the reports show the exact same thing. Behind a "View
// more" toggle here; pass inline to render it always-open (reports / print).

import { useState } from "react";
import { disputeDetail, type DisputePartsExtra } from "@/lib/dispute-detail";
import DisputeDetailLines from "../../_components/DisputeDetailLines";

export type DisputeExtra = DisputePartsExtra;

export default function DisputeBreakdown({ snapshot, extra, inline = false }: { snapshot?: Record<string, unknown> | null; extra?: DisputeExtra; inline?: boolean }) {
  const [open, setOpen] = useState(inline);
  if (!snapshot) return null;
  const detail = disputeDetail(snapshot, extra);

  if (inline) return <DisputeDetailLines detail={detail} inline />;

  return (
    <div style={{ marginTop: 6 }}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="portal-btn portal-btn-ghost" style={{ padding: "2px 8px", fontSize: 11 }}>
        {open ? "▾ Hide details" : "▸ View more"}
      </button>
      {open && <DisputeDetailLines detail={detail} />}
    </div>
  );
}
