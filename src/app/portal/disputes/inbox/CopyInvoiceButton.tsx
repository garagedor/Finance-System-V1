"use client";

// Copies an invoice number, to paste into ScanPay's search — the refunded
// amount of a partial refund is only visible there.

import { useState } from "react";

export default function CopyInvoiceButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="portal-btn portal-btn-ghost"
      style={{ padding: "0 6px", fontSize: 10, marginLeft: 6, verticalAlign: "middle" }}
      title="Copy the invoice number to search it in ScanPay"
      onClick={async (e) => {
        e.stopPropagation();
        try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ }
      }}
    >
      {done ? "copied" : "copy"}
    </button>
  );
}
