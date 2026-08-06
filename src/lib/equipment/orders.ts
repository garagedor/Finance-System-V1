import "server-only";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
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
  productId: string;
  qty: number;
}

/** Resolve product ids → immutable order-line snapshots (price frozen at order
 *  time, spec §3). Throws if a product is missing or a qty is invalid. */
export async function buildOrderItems(lines: OrderLineInput[]): Promise<EquipmentOrderItem[]> {
  await ensureFinanceIndexes();
  const clean = (lines ?? []).filter((l) => l && l.productId && Number(l.qty) > 0);
  if (clean.length === 0) throw new Error("An order needs at least one product line with quantity ≥ 1.");

  const ids = [...new Set(clean.map((l) => l.productId))];
  const products = await coll<EquipmentProduct>(FINANCE_COLLECTIONS.equipmentProduct)
    .find({ _id: { $in: ids } })
    .toArray();
  const byId = new Map(products.map((p) => [p._id, p]));

  const items: EquipmentOrderItem[] = [];
  for (const l of clean) {
    const p = byId.get(l.productId);
    if (!p) throw new Error(`Product not found: ${l.productId}`);
    const qty = Math.floor(Number(l.qty));
    const { costLineTotal, chargeLineTotal } = lineTotals(p.companyCost, p.amPrice, qty);
    items.push({
      productId: p._id,
      productNameSnapshot: p.name,
      skuSnapshot: p.sku,
      sellingUnitSnapshot: p.sellingUnit,
      qty,
      companyCostSnapshot: Number(p.companyCost) || 0,
      amPriceSnapshot: Number(p.amPrice) || 0,
      costLineTotal,
      chargeLineTotal,
    });
  }
  return items;
}
