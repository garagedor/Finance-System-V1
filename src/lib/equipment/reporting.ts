import "server-only";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import type { EquipmentOrder, EquipmentReturn } from "@/types/equipment";
import { round2 } from "./totals";

// Orders that count as committed sales (everything except never-committed
// Drafts and Cancelled orders). Approved-not-charged / delivered-not-posted are
// surfaced separately as operational worklists.
const SALES_STATUSES: EquipmentOrder["status"][] = [
  "Approved", "ReadyForPickup", "Delivered", "ChargedToLedger", "PartiallyReturned", "Returned",
];

export interface EquipmentReport {
  range: { from: string; to: string };
  totals: { orders: number; units: number; amChargeTotal: number; companyCostTotal: number; grossProfit: number; grossMarginPct: number };
  byDate: Array<{ date: string; amChargeTotal: number; orders: number }>;
  byAreaManager: Array<{ name: string; orders: number; units: number; amChargeTotal: number; companyCostTotal: number; grossProfit: number; grossMarginPct: number }>;
  topProducts: Array<{ productId: string; name: string; sku: string; units: number; amCharge: number; companyCost: number; grossProfit: number; grossMarginPct: number }>;
  approvedNotCharged: Array<{ _id: string; orderNumber: string; areaManagerName: string; amChargeTotal: number; orderDate: string }>;
  deliveredNotPosted: Array<{ _id: string; orderNumber: string; areaManagerName: string; amChargeTotal: number; orderDate: string }>;
  returns: { count: number; creditsPosted: number; creditsApprovedNotPosted: number };
}

const margin = (profit: number, charge: number) => (charge > 0 ? round2((profit / charge) * 100) : 0);

export async function equipmentReport(range: { from: string; to: string }): Promise<EquipmentReport> {
  await ensureFinanceIndexes();
  const orders = await coll<EquipmentOrder>(FINANCE_COLLECTIONS.equipmentOrder)
    .find({ orderDate: { $gte: range.from, $lte: range.to } }).toArray();
  const sales = orders.filter((o) => SALES_STATUSES.includes(o.status));

  let units = 0, amChargeTotal = 0, companyCostTotal = 0;
  const byDate = new Map<string, { amChargeTotal: number; orders: number }>();
  const byAm = new Map<string, { orders: number; units: number; amChargeTotal: number; companyCostTotal: number }>();
  const byProduct = new Map<string, { name: string; sku: string; units: number; amCharge: number; companyCost: number }>();

  for (const o of sales) {
    const t = o.totals;
    units += t.itemCount;
    amChargeTotal += t.amChargeTotal;
    companyCostTotal += t.companyCostTotal;

    const d = byDate.get(o.orderDate) ?? { amChargeTotal: 0, orders: 0 };
    d.amChargeTotal += t.amChargeTotal; d.orders += 1;
    byDate.set(o.orderDate, d);

    const a = byAm.get(o.areaManagerName) ?? { orders: 0, units: 0, amChargeTotal: 0, companyCostTotal: 0 };
    a.orders += 1; a.units += t.itemCount; a.amChargeTotal += t.amChargeTotal; a.companyCostTotal += t.companyCostTotal;
    byAm.set(o.areaManagerName, a);

    for (const it of o.items) {
      const p = byProduct.get(it.productId) ?? { name: it.productNameSnapshot, sku: it.skuSnapshot, units: 0, amCharge: 0, companyCost: 0 };
      p.units += it.qty; p.amCharge += it.chargeLineTotal; p.companyCost += it.costLineTotal;
      byProduct.set(it.productId, p);
    }
  }

  amChargeTotal = round2(amChargeTotal);
  companyCostTotal = round2(companyCostTotal);
  const grossProfit = round2(amChargeTotal - companyCostTotal);

  // Returns/credits in-range (by creation date).
  const rets = await coll<EquipmentReturn>(FINANCE_COLLECTIONS.equipmentReturn)
    .find({ created_at: { $gte: range.from, $lte: `${range.to}T23:59:59.999Z` } }).toArray();
  const creditsPosted = round2(rets.filter((r) => r.status === "Credited").reduce((s, r) => s + (r.creditAmount || 0), 0));
  const creditsApprovedNotPosted = round2(rets.filter((r) => r.status === "Approved").reduce((s, r) => s + (r.creditAmount || 0), 0));

  return {
    range,
    totals: { orders: sales.length, units, amChargeTotal, companyCostTotal, grossProfit, grossMarginPct: margin(grossProfit, amChargeTotal) },
    byDate: [...byDate.entries()].map(([date, v]) => ({ date, amChargeTotal: round2(v.amChargeTotal), orders: v.orders }))
      .sort((a, b) => (a.date < b.date ? 1 : -1)),
    byAreaManager: [...byAm.entries()].map(([name, v]) => {
      const gp = round2(v.amChargeTotal - v.companyCostTotal);
      return { name, orders: v.orders, units: v.units, amChargeTotal: round2(v.amChargeTotal), companyCostTotal: round2(v.companyCostTotal), grossProfit: gp, grossMarginPct: margin(gp, v.amChargeTotal) };
    }).sort((a, b) => b.amChargeTotal - a.amChargeTotal),
    topProducts: [...byProduct.entries()].map(([productId, v]) => {
      const gp = round2(v.amCharge - v.companyCost);
      return { productId, name: v.name, sku: v.sku, units: v.units, amCharge: round2(v.amCharge), companyCost: round2(v.companyCost), grossProfit: gp, grossMarginPct: margin(gp, v.amCharge) };
    }).sort((a, b) => b.units - a.units),
    approvedNotCharged: orders.filter((o) => o.status === "Approved")
      .map((o) => ({ _id: o._id, orderNumber: o.orderNumber, areaManagerName: o.areaManagerName, amChargeTotal: o.totals.amChargeTotal, orderDate: o.orderDate })),
    deliveredNotPosted: orders.filter((o) => o.status === "Delivered")
      .map((o) => ({ _id: o._id, orderNumber: o.orderNumber, areaManagerName: o.areaManagerName, amChargeTotal: o.totals.amChargeTotal, orderDate: o.orderDate })),
    returns: { count: rets.length, creditsPosted, creditsApprovedNotPosted },
  };
}
