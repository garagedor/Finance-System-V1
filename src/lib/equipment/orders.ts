import "server-only";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS, newId } from "@/lib/finance-db";
import type { EquipmentProduct, EquipmentOrderItem } from "@/types/equipment";
import { lineTotals } from "./totals";

interface CounterRow {
  _id: string;
  seq: number;
}

/** Gap-free sequential order number, e.g. "EQ-2026-0001". Atomic via $inc. */
export async function nextOrderNumber(year: number): Promise<string> {
  await ensureFinanceIndexes();
  const c = coll<CounterRow>(FINANCE_COLLECTIONS.counter);
  const key = `equipment_order:${year}`;
  const res = await c.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  );
  const seq = res?.seq ?? 1;
  return `EQ-${year}-${String(seq).padStart(4, "0")}`;
}

export interface OrderLineInput {
  productId?: string | null;   // catalog id, a preserved custom id, or empty for a new custom line
  name?: string;               // required for custom lines
  sku?: string;
  sellingUnit?: string;
  qty: number;
  amPrice?: number;            // per-order price override (or custom price)
  companyCost?: number;        // per-order cost override — only honored if canViewCost
}

const num0 = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};

/** Resolve order lines → immutable snapshots (spec §3). Supports catalog items,
 *  per-line price/cost OVERRIDES, and one-off CUSTOM lines (no catalog product).
 *  Company cost can only be overridden by users who can see it — otherwise the
 *  catalog cost is used so profitability stays correct (spec §11). */
export async function buildOrderItems(
  lines: OrderLineInput[],
  opts?: { canViewCost?: boolean },
): Promise<EquipmentOrderItem[]> {
  await ensureFinanceIndexes();
  const canViewCost = !!opts?.canViewCost;
  const clean = (lines ?? []).filter(
    (l) => l && Number(l.qty) > 0 && (l.productId || (l.name && String(l.name).trim())),
  );
  if (clean.length === 0) throw new Error("An order needs at least one line with quantity ≥ 1.");

  const ids = [...new Set(clean.map((l) => l.productId).filter(Boolean) as string[])];
  const products = ids.length
    ? await coll<EquipmentProduct>(FINANCE_COLLECTIONS.equipmentProduct).find({ _id: { $in: ids } }).toArray()
    : [];
  const byId = new Map(products.map((p) => [p._id, p]));

  const items: EquipmentOrderItem[] = [];
  for (const l of clean) {
    const pid = l.productId ? String(l.productId) : "";
    const base = pid ? byId.get(pid) : undefined;
    const name = String(l.name ?? base?.name ?? "").trim();
    if (!name) throw new Error("Each line needs a catalog product or a name.");
    const sku = String(l.sku ?? base?.sku ?? "");
    const sellingUnit = String(l.sellingUnit ?? base?.sellingUnit ?? "unit");
    const qty = Math.floor(Number(l.qty));

    // Price: honor the per-line override, else the catalog price.
    const amPrice = l.amPrice != null ? num0(l.amPrice) : num0(base?.amPrice);
    // Cost: override only if the actor can see cost; else fall back to catalog.
    let companyCost: number;
    if (base && !canViewCost) companyCost = num0(base.companyCost);
    else if (l.companyCost != null) companyCost = num0(l.companyCost);
    else companyCost = num0(base?.companyCost);

    // Custom lines (no catalog match) get a stable synthetic id so they survive edits.
    const productId = pid || newId("custeq");
    const { costLineTotal, chargeLineTotal } = lineTotals(companyCost, amPrice, qty);
    items.push({
      productId,
      productNameSnapshot: name,
      skuSnapshot: sku,
      sellingUnitSnapshot: sellingUnit,
      qty,
      companyCostSnapshot: companyCost,
      amPriceSnapshot: amPrice,
      costLineTotal,
      chargeLineTotal,
    });
  }
  return items;
}
