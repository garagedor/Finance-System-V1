// Company cost is confidential (spec §11, §8). When a viewer lacks
// finance:equipment_cost:view (and profitability:view), strip every cost-derived
// figure from an order server-side — the AM never learns the company's cost.
// Pure + isomorphic (no server-only) so pages and API routes share one redactor.

import type {
  EquipmentOrder,
  EquipmentOrderItem,
  EquipmentOrderTotals,
} from "@/types/equipment";

export type RedactedOrderItem = Omit<EquipmentOrderItem, "companyCostSnapshot" | "costLineTotal">;
export type RedactedOrderTotals = Omit<EquipmentOrderTotals, "companyCostTotal" | "grossProfit" | "grossMarginPct">;
export interface RedactedOrder extends Omit<EquipmentOrder, "items" | "totals"> {
  items: RedactedOrderItem[];
  totals: RedactedOrderTotals;
}

export function stripOrderCost(order: EquipmentOrder, canSeeCost: boolean): EquipmentOrder | RedactedOrder {
  if (canSeeCost) return order;
  const items: RedactedOrderItem[] = order.items.map((it) => ({
    productId: it.productId,
    productNameSnapshot: it.productNameSnapshot,
    skuSnapshot: it.skuSnapshot,
    sellingUnitSnapshot: it.sellingUnitSnapshot,
    qty: it.qty,
    amPriceSnapshot: it.amPriceSnapshot,
    chargeLineTotal: it.chargeLineTotal,
  }));
  const totals: RedactedOrderTotals = {
    itemCount: order.totals.itemCount,
    lineCount: order.totals.lineCount,
    amChargeTotal: order.totals.amChargeTotal,
  };
  return { ...order, items, totals };
}
