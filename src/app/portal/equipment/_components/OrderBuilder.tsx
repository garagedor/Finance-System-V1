"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fmt$ } from "../../format";
import { lineTotals } from "@/lib/equipment/totals";

export interface BuilderProduct {
  _id: string;
  name: string;
  sku: string;
  category: string;
  sellingUnit: string;
  amPrice: number;
  companyCost: number; // 0 when the viewer can't see cost
}
export interface BuilderAM {
  id: string;
  name: string;
}

interface Line {
  productId: string;
  qty: number;
}

const today = () => new Date().toISOString().slice(0, 10);

export default function OrderBuilder({
  ams,
  products,
  canSeeCost,
}: {
  ams: BuilderAM[];
  products: BuilderProduct[];
  canSeeCost: boolean;
}) {
  const router = useRouter();
  const byId = useMemo(() => new Map(products.map((p) => [p._id, p])), [products]);

  const [amId, setAmId] = useState(ams[0]?.id ?? "");
  const [area, setArea] = useState("");
  const [orderDate, setOrderDate] = useState(today());
  const [deliveryMethod, setDeliveryMethod] = useState("pickup");
  const [expectedDeliveryAt, setExpectedDeliveryAt] = useState("");
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const chosen = new Set(lines.map((l) => l.productId));
    return products.filter((p) => {
      if (chosen.has(p._id)) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.category.toLowerCase().includes(q);
    }).slice(0, 40);
  }, [products, search, lines]);

  const addLine = (productId: string) => setLines((ls) => [...ls, { productId, qty: 1 }]);
  const setQty = (productId: string, qty: number) =>
    setLines((ls) => ls.map((l) => (l.productId === productId ? { ...l, qty: Math.max(1, Math.floor(qty || 1)) } : l)));
  const removeLine = (productId: string) => setLines((ls) => ls.filter((l) => l.productId !== productId));

  const totals = useMemo(() => {
    let itemCount = 0, companyCostTotal = 0, amChargeTotal = 0;
    for (const l of lines) {
      const p = byId.get(l.productId);
      if (!p) continue;
      const { costLineTotal, chargeLineTotal } = lineTotals(p.companyCost, p.amPrice, l.qty);
      itemCount += l.qty;
      companyCostTotal += costLineTotal;
      amChargeTotal += chargeLineTotal;
    }
    const grossProfit = amChargeTotal - companyCostTotal;
    const grossMarginPct = amChargeTotal > 0 ? (grossProfit / amChargeTotal) * 100 : 0;
    return { itemCount, companyCostTotal, amChargeTotal, grossProfit, grossMarginPct };
  }, [lines, byId]);

  const submit = async () => {
    setError(null);
    if (!amId) { setError("Select an Area Manager."); return; }
    if (lines.length === 0) { setError("Add at least one product."); return; }
    setSubmitting(true);
    try {
      const am = ams.find((a) => a.id === amId);
      const res = await fetch("/api/portal/equipment/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          areaManagerId: am?.id ?? null,
          areaManagerName: am?.name ?? "",
          area: area.trim() || null,
          orderDate,
          deliveryMethod,
          expectedDeliveryAt: expectedDeliveryAt || null,
          notes: notes.trim() || null,
          lines: lines.map((l) => ({ productId: l.productId, qty: l.qty })),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      router.push(`/portal/equipment/orders/${j.row._id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create order");
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Order details */}
      <div className="portal-card" style={{ padding: 16 }}>
        <div className="portal-card-head-title" style={{ marginBottom: 12 }}>Order details</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="portal-label">Area Manager *</span>
            <select className="portal-select" value={amId} onChange={(e) => setAmId(e.target.value)}>
              {ams.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="portal-label">Area</span>
            <input className="portal-input" value={area} onChange={(e) => setArea(e.target.value)} placeholder="Optional" />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="portal-label">Order date</span>
            <input type="date" className="portal-input" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="portal-label">Delivery method</span>
            <select className="portal-select" value={deliveryMethod} onChange={(e) => setDeliveryMethod(e.target.value)}>
              <option value="pickup">Pickup</option>
              <option value="delivery">Delivery</option>
              <option value="shipping">Shipping</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="portal-label">Expected delivery</span>
            <input type="date" className="portal-input" value={expectedDeliveryAt} onChange={(e) => setExpectedDeliveryAt(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="portal-label">Notes</span>
            <input className="portal-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </label>
        </div>
      </div>

      {/* Product picker */}
      <div className="portal-card" style={{ padding: 16 }}>
        <div className="portal-card-head-title" style={{ marginBottom: 12 }}>Add products</div>
        <input className="portal-input" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products by name, SKU, or category…" style={{ marginBottom: 10 }} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxHeight: 180, overflowY: "auto" }}>
          {filtered.length === 0 ? (
            <span className="muted small">No matching products.</span>
          ) : filtered.map((p) => (
            <button key={p._id} className="portal-btn" onClick={() => addLine(p._id)} style={{ fontSize: 12 }}>
              + {p.name} <span className="muted">({p.sku}) {fmt$(p.amPrice)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Lines + totals */}
      <div className="portal-card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="portal-card-head"><div className="portal-card-head-title">Order lines ({lines.length})</div></div>
        {lines.length === 0 ? (
          <div className="portal-empty">No products added yet — search above and click to add.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Product</th><th>SKU</th><th>Unit</th>
                  {canSeeCost && <th className="right">Unit cost</th>}
                  <th className="right">Unit price</th>
                  <th className="right">Qty</th>
                  {canSeeCost && <th className="right">Line cost</th>}
                  <th className="right">Line charge</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const p = byId.get(l.productId);
                  if (!p) return null;
                  const { costLineTotal, chargeLineTotal } = lineTotals(p.companyCost, p.amPrice, l.qty);
                  return (
                    <tr key={l.productId}>
                      <td>{p.name}</td>
                      <td className="small mono">{p.sku}</td>
                      <td className="small">{p.sellingUnit}</td>
                      {canSeeCost && <td className="right money muted">{fmt$(p.companyCost)}</td>}
                      <td className="right money">{fmt$(p.amPrice)}</td>
                      <td className="right">
                        <input type="number" min={1} value={l.qty} onChange={(e) => setQty(l.productId, Number(e.target.value))}
                          className="portal-input" style={{ width: 70, textAlign: "right" }} />
                      </td>
                      {canSeeCost && <td className="right money muted">{fmt$(costLineTotal)}</td>}
                      <td className="right money">{fmt$(chargeLineTotal)}</td>
                      <td className="right">
                        <button className="portal-btn portal-btn-danger" onClick={() => removeLine(l.productId)} style={{ padding: "2px 8px", fontSize: 11 }}>✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {/* Totals footer */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, padding: "14px 16px", borderTop: "1px solid rgba(255,255,255,0.08)", justifyContent: "flex-end" }}>
          <Tote label="Items" value={String(totals.itemCount)} />
          {canSeeCost && <Tote label="Company cost" value={fmt$(totals.companyCostTotal)} muted />}
          <Tote label="AM charge total" value={fmt$(totals.amChargeTotal)} strong />
          {canSeeCost && <Tote label="Gross profit" value={fmt$(totals.grossProfit)} />}
          {canSeeCost && <Tote label="Margin" value={`${totals.grossMarginPct.toFixed(1)}%`} />}
        </div>
      </div>

      {error && <div className="portal-alert portal-alert-error">{error}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="portal-btn portal-btn-primary" disabled={submitting} onClick={submit}>
          {submitting ? "Creating…" : "Create order (Draft)"}
        </button>
      </div>
    </div>
  );
}

function Tote({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div style={{ textAlign: "right" }}>
      <div className="portal-label" style={{ opacity: muted ? 0.7 : 1 }}>{label}</div>
      <div className="money" style={{ fontSize: strong ? 20 : 15, fontWeight: strong ? 800 : 600, color: muted ? "#94a3b8" : undefined }}>{value}</div>
    </div>
  );
}
