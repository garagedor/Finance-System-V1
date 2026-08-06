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

export interface BuilderLine {
  key: string;         // unique client key
  productId: string;   // catalog id, preserved custom id, or "" for a new custom line
  name: string;
  sku: string;
  sellingUnit: string;
  qty: number;
  amPrice: number;     // editable per-order price
  companyCost: number; // editable per-order cost (if canSeeCost)
  custom: boolean;
}

export interface OrderBuilderInitial {
  areaManagerName: string;
  area: string;
  orderDate: string;
  deliveryMethod: string;
  expectedDeliveryAt: string;
  notes: string;
  lines: BuilderLine[];
}

const today = () => new Date().toISOString().slice(0, 10);
const genKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const UNITS = ["unit", "pair", "box", "set", "roll", "kit", "each"];

export default function OrderBuilder({
  ams,
  products,
  canSeeCost,
  orderId,
  initial,
}: {
  ams: BuilderAM[];
  products: BuilderProduct[];
  canSeeCost: boolean;
  orderId?: string;
  initial?: OrderBuilderInitial;
}) {
  const router = useRouter();
  const editing = !!orderId;

  const initialAmId = initial
    ? (ams.find((a) => a.name === initial.areaManagerName)?.id ?? initial.areaManagerName)
    : (ams[0]?.id ?? "");
  const [amId, setAmId] = useState(initialAmId);
  const [area, setArea] = useState(initial?.area ?? "");
  const [orderDate, setOrderDate] = useState(initial?.orderDate ?? today());
  const [deliveryMethod, setDeliveryMethod] = useState(initial?.deliveryMethod || "pickup");
  const [expectedDeliveryAt, setExpectedDeliveryAt] = useState(initial?.expectedDeliveryAt ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<BuilderLine[]>(initial?.lines ?? []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Custom-item form
  const [cName, setCName] = useState("");
  const [cUnit, setCUnit] = useState("unit");
  const [cPrice, setCPrice] = useState("");
  const [cCost, setCCost] = useState("");
  const [cQty, setCQty] = useState("1");
  const [customOpen, setCustomOpen] = useState(false);

  const chosenCatalog = useMemo(() => new Set(lines.filter((l) => !l.custom).map((l) => l.productId)), [lines]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (chosenCatalog.has(p._id)) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.category.toLowerCase().includes(q);
    }).slice(0, 40);
  }, [products, search, chosenCatalog]);

  const addCatalog = (p: BuilderProduct) =>
    setLines((ls) => [...ls, { key: genKey(), productId: p._id, name: p.name, sku: p.sku, sellingUnit: p.sellingUnit, qty: 1, amPrice: p.amPrice, companyCost: p.companyCost, custom: false }]);

  const addCustom = () => {
    const name = cName.trim();
    const price = Number(cPrice);
    if (!name) { setError("Custom item needs a name."); return; }
    if (!Number.isFinite(price)) { setError("Custom item needs a price."); return; }
    setError(null);
    setLines((ls) => [...ls, {
      key: genKey(), productId: "", name, sku: "", sellingUnit: cUnit,
      qty: Math.max(1, Math.floor(Number(cQty) || 1)),
      amPrice: Math.max(0, price), companyCost: canSeeCost ? Math.max(0, Number(cCost) || 0) : 0, custom: true,
    }]);
    setCName(""); setCPrice(""); setCCost(""); setCQty("1"); setCUnit("unit"); setCustomOpen(false);
  };

  const patchLine = (key: string, patch: Partial<BuilderLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));

  const totals = useMemo(() => {
    let itemCount = 0, companyCostTotal = 0, amChargeTotal = 0;
    for (const l of lines) {
      const { costLineTotal, chargeLineTotal } = lineTotals(l.companyCost, l.amPrice, l.qty);
      itemCount += l.qty; companyCostTotal += costLineTotal; amChargeTotal += chargeLineTotal;
    }
    const grossProfit = amChargeTotal - companyCostTotal;
    const grossMarginPct = amChargeTotal > 0 ? (grossProfit / amChargeTotal) * 100 : 0;
    return { itemCount, companyCostTotal, amChargeTotal, grossProfit, grossMarginPct };
  }, [lines]);

  const submit = async () => {
    setError(null);
    if (!amId) { setError("Select an Area Manager."); return; }
    if (lines.length === 0) { setError("Add at least one item."); return; }
    setSubmitting(true);
    try {
      const am = ams.find((a) => a.id === amId);
      const res = await fetch(
        editing ? `/api/portal/equipment/orders/${orderId}` : "/api/portal/equipment/orders",
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            areaManagerId: am && /^[0-9a-f]{24}$/i.test(am.id) ? am.id : null,
            areaManagerName: am?.name ?? "",
            area: area.trim() || null,
            orderDate,
            deliveryMethod,
            expectedDeliveryAt: expectedDeliveryAt || null,
            notes: notes.trim() || null,
            lines: lines.map((l) => ({
              productId: l.productId || null, name: l.name, sku: l.sku, sellingUnit: l.sellingUnit,
              qty: l.qty, amPrice: l.amPrice, companyCost: l.companyCost,
            })),
          }),
        },
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      router.push(`/portal/equipment/orders/${editing ? orderId : j.row._id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save order");
      setSubmitting(false);
    }
  };

  const numCell: React.CSSProperties = { width: 84, textAlign: "right" };

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

      {/* Add products */}
      <div className="portal-card" style={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div className="portal-card-head-title">Add items</div>
          <button className="portal-btn" onClick={() => setCustomOpen((v) => !v)}>{customOpen ? "Close" : "+ Custom item"}</button>
        </div>

        {customOpen && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", padding: "10px 12px", marginBottom: 12, border: "1px dashed rgba(255,255,255,0.15)", borderRadius: 10 }}>
            <Field label="Name"><input className="portal-input" value={cName} onChange={(e) => setCName(e.target.value)} placeholder="One-off item" style={{ width: 180 }} /></Field>
            <Field label="Unit">
              <select className="portal-select" value={cUnit} onChange={(e) => setCUnit(e.target.value)}>
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </Field>
            {canSeeCost && <Field label="Cost"><input className="portal-input" type="number" step="0.01" value={cCost} onChange={(e) => setCCost(e.target.value)} style={numCell} /></Field>}
            <Field label="Price *"><input className="portal-input" type="number" step="0.01" value={cPrice} onChange={(e) => setCPrice(e.target.value)} style={numCell} /></Field>
            <Field label="Qty"><input className="portal-input" type="number" min={1} value={cQty} onChange={(e) => setCQty(e.target.value)} style={{ width: 64, textAlign: "right" }} /></Field>
            <button className="portal-btn portal-btn-primary" onClick={addCustom}>Add</button>
          </div>
        )}

        <input className="portal-input" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search catalog by name, SKU, or category…" style={{ marginBottom: 10 }} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxHeight: 160, overflowY: "auto" }}>
          {filtered.length === 0 ? (
            <span className="muted small">No matching products.</span>
          ) : filtered.map((p) => (
            <button key={p._id} className="portal-btn" onClick={() => addCatalog(p)} style={{ fontSize: 12 }}>
              + {p.name} <span className="muted">({p.sku || "—"}) {fmt$(p.amPrice)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Lines + totals */}
      <div className="portal-card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="portal-card-head"><div className="portal-card-head-title">Order lines ({lines.length})</div></div>
        {lines.length === 0 ? (
          <div className="portal-empty">No items yet — add from the catalog or a custom item above.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Item</th><th>Unit</th>
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
                  const { costLineTotal, chargeLineTotal } = lineTotals(l.companyCost, l.amPrice, l.qty);
                  return (
                    <tr key={l.key}>
                      <td>
                        {l.name}
                        {l.custom ? <span className="pill pill-pending" style={{ marginLeft: 6, fontSize: 10 }}>custom</span> : (l.sku && <div className="muted small">{l.sku}</div>)}
                      </td>
                      <td className="small">{l.sellingUnit}</td>
                      {canSeeCost && (
                        <td className="right">
                          <input type="number" step="0.01" min={0} value={l.companyCost}
                            onChange={(e) => patchLine(l.key, { companyCost: Math.max(0, Number(e.target.value) || 0) })}
                            className="portal-input" style={numCell} />
                        </td>
                      )}
                      <td className="right">
                        <input type="number" step="0.01" min={0} value={l.amPrice}
                          onChange={(e) => patchLine(l.key, { amPrice: Math.max(0, Number(e.target.value) || 0) })}
                          className="portal-input" style={numCell} />
                      </td>
                      <td className="right">
                        <input type="number" min={1} value={l.qty}
                          onChange={(e) => patchLine(l.key, { qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
                          className="portal-input" style={{ width: 64, textAlign: "right" }} />
                      </td>
                      {canSeeCost && <td className="right money muted">{fmt$(costLineTotal)}</td>}
                      <td className="right money">{fmt$(chargeLineTotal)}</td>
                      <td className="right">
                        <button className="portal-btn portal-btn-danger" onClick={() => removeLine(l.key)} style={{ padding: "2px 8px", fontSize: 11 }}>✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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
          {submitting ? "Saving…" : editing ? "Save changes" : "Create order (Draft)"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span className="portal-label">{label}</span>
      {children}
    </label>
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
