// Pure order-math helpers — ISOMORPHIC (no server-only). Used by the client
// order builder for a live preview AND by the server as the authoritative
// computation, so both sides agree. All money rounded to cents.
//
// Formulas (spec §2):
//   Gross Profit  = AM Charge Total − Company Cost Total
//   Gross Margin %= Gross Profit / AM Charge Total × 100   (0 when no charge)

import type { EquipmentOrderItem, EquipmentOrderTotals } from "@/types/equipment";

export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** Build a single order line's snapshot totals from per-unit prices + qty. */
export function lineTotals(companyCost: number, amPrice: number, qty: number): {
  costLineTotal: number;
  chargeLineTotal: number;
} {
  const q = Math.max(0, Math.floor(Number(qty) || 0));
  return {
    costLineTotal: round2((Number(companyCost) || 0) * q),
    chargeLineTotal: round2((Number(amPrice) || 0) * q),
  };
}

/** Roll up all order lines into the order totals + gross profit/margin. */
export function computeOrderTotals(items: EquipmentOrderItem[]): EquipmentOrderTotals {
  let itemCount = 0;
  let companyCostTotal = 0;
  let amChargeTotal = 0;
  for (const it of items) {
    itemCount += Math.max(0, Math.floor(Number(it.qty) || 0));
    companyCostTotal += Number(it.costLineTotal) || 0;
    amChargeTotal += Number(it.chargeLineTotal) || 0;
  }
  companyCostTotal = round2(companyCostTotal);
  amChargeTotal = round2(amChargeTotal);
  const grossProfit = round2(amChargeTotal - companyCostTotal);
  const grossMarginPct = amChargeTotal > 0 ? round2((grossProfit / amChargeTotal) * 100) : 0;
  return {
    itemCount,
    lineCount: items.length,
    companyCostTotal,
    amChargeTotal,
    grossProfit,
    grossMarginPct,
  };
}
