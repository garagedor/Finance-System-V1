"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fmt$ } from "../../format";
import { round2 } from "@/lib/equipment/totals";

export interface ReturnableItem {
  productId: string;
  name: string;
  sku: string;
  amPrice: number;
  remaining: number; // ordered − already returned
}

export default function ReturnBuilder({
  orderId,
  orderNumber,
  returnable,
}: {
  orderId: string;
  orderNumber: string;
  returnable: ReturnableItem[];
}) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [condition, setCondition] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [creditApproved, setCreditApproved] = useState(false);
  const [creditOverride, setCreditOverride] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggested = useMemo(() => {
    let s = 0;
    for (const it of returnable) s += (qty[it.productId] || 0) * it.amPrice;
    return round2(s);
  }, [qty, returnable]);

  const setQ = (pid: string, v: number, max: number) =>
    setQty((q) => ({ ...q, [pid]: Math.max(0, Math.min(max, Math.floor(v || 0))) }));

  const submit = async () => {
    setError(null);
    const lines = returnable
      .filter((it) => (qty[it.productId] || 0) > 0)
      .map((it) => ({ productId: it.productId, qty: qty[it.productId] }));
    if (lines.length === 0) { setError("Select at least one product and quantity to return."); return; }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        orderId, lines, condition: condition.trim() || null, reason: reason.trim() || null, notes: notes.trim() || null,
        creditApproved,
      };
      if (creditApproved && creditOverride.trim() !== "") body.creditAmount = Number(creditOverride);
      const res = await fetch("/api/portal/equipment/returns", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      router.push(`/portal/equipment/returns/${j.row._id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create return");
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="portal-card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="portal-card-head"><div className="portal-card-head-title">Products to return — order {orderNumber}</div></div>
        <div style={{ overflowX: "auto" }}>
          <table className="portal-table">
            <thead>
              <tr><th>Product</th><th>SKU</th><th className="right">Unit price</th><th className="right">Returnable</th><th className="right">Return qty</th><th className="right">Credit</th></tr>
            </thead>
            <tbody>
              {returnable.map((it) => (
                <tr key={it.productId}>
                  <td>{it.name}</td>
                  <td className="small mono">{it.sku}</td>
                  <td className="right money">{fmt$(it.amPrice)}</td>
                  <td className="right">{it.remaining}</td>
                  <td className="right">
                    <input type="number" min={0} max={it.remaining} value={qty[it.productId] ?? 0}
                      onChange={(e) => setQ(it.productId, Number(e.target.value), it.remaining)}
                      className="portal-input" style={{ width: 70, textAlign: "right" }} />
                  </td>
                  <td className="right money">{fmt$((qty[it.productId] || 0) * it.amPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="portal-card" style={{ padding: 16, display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="portal-label">Condition</span>
            <input className="portal-input" value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="e.g. unopened, damaged" />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="portal-label">Reason</span>
            <input className="portal-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is it being returned?" />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: "span 2" }}>
            <span className="portal-label">Notes</span>
            <input className="portal-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </label>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={creditApproved} onChange={(e) => setCreditApproved(e.target.checked)} style={{ width: 16, height: 16 }} />
          <span style={{ fontSize: 13 }}>Approve a credit now (otherwise the return is saved as a draft to approve later)</span>
        </label>
        {creditApproved && (
          <label style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 240 }}>
            <span className="portal-label">Credit amount</span>
            <input className="portal-input" type="number" step="0.01" value={creditOverride}
              onChange={(e) => setCreditOverride(e.target.value)} placeholder={`${suggested}`} />
            <span className="muted small">Suggested {fmt$(suggested)} (leave blank to use it).</span>
          </label>
        )}
      </div>

      {error && <div className="portal-alert portal-alert-error">{error}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="muted small">Credit posts a negative entry to the AM&apos;s ledger — the original charge is never edited.</div>
        <button className="portal-btn portal-btn-primary" disabled={submitting} onClick={submit}>
          {submitting ? "Creating…" : "Create return"}
        </button>
      </div>
    </div>
  );
}
