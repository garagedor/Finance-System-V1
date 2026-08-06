import "server-only";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS, newId } from "@/lib/finance-db";
import type { LedgerEntryRecord } from "@/types/finance-ledger";
import type { EquipmentOrder, EquipmentReturn, EquipmentReturnItem } from "@/types/equipment";
import { round2 } from "./totals";

interface CounterRow { _id: string; seq: number; }

/** Gap-free sequential return number, e.g. "ER-2026-0001". */
export async function nextReturnNumber(year: number): Promise<string> {
  await ensureFinanceIndexes();
  const c = coll<CounterRow>(FINANCE_COLLECTIONS.counter);
  const res = await c.findOneAndUpdate(
    { _id: `equipment_return:${year}` },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  );
  return `ER-${year}-${String(res?.seq ?? 1).padStart(4, "0")}`;
}

export interface ReturnLineInput {
  productId: string;
  qty: number;
}

/** How many units of each product on an order have ALREADY been returned
 *  (across every non-cancelled return for that order). */
export async function priorReturnedByProduct(orderId: string): Promise<Map<string, number>> {
  await ensureFinanceIndexes();
  const prior = await coll<EquipmentReturn>(FINANCE_COLLECTIONS.equipmentReturn)
    .find({ orderId, status: { $ne: "Cancelled" } }).toArray();
  const map = new Map<string, number>();
  for (const r of prior) {
    for (const it of r.items) {
      map.set(it.productId, (map.get(it.productId) ?? 0) + it.qtyReturned);
    }
  }
  return map;
}

/** Build return-line snapshots from an order, enforcing that a product is never
 *  returned beyond (ordered − already-returned). Prices carry from the order. */
export async function buildReturnItems(order: EquipmentOrder, lines: ReturnLineInput[]): Promise<EquipmentReturnItem[]> {
  const clean = (lines ?? []).filter((l) => l && l.productId && Number(l.qty) > 0);
  if (clean.length === 0) throw new Error("Select at least one product and quantity to return.");

  const orderedByProduct = new Map<string, { qty: number; amPrice: number; name: string; sku: string }>();
  for (const it of order.items) {
    const cur = orderedByProduct.get(it.productId);
    if (cur) cur.qty += it.qty;
    else orderedByProduct.set(it.productId, { qty: it.qty, amPrice: it.amPriceSnapshot, name: it.productNameSnapshot, sku: it.skuSnapshot });
  }
  const prior = await priorReturnedByProduct(order._id);

  const items: EquipmentReturnItem[] = [];
  for (const l of clean) {
    const ord = orderedByProduct.get(l.productId);
    if (!ord) throw new Error(`Product ${l.productId} is not on order ${order.orderNumber}.`);
    const already = prior.get(l.productId) ?? 0;
    const remaining = ord.qty - already;
    const qty = Math.floor(Number(l.qty));
    if (qty > remaining) {
      throw new Error(`Cannot return ${qty}× ${ord.name} — only ${remaining} of ${ord.qty} remain (returned ${already}).`);
    }
    items.push({
      productId: l.productId,
      productNameSnapshot: ord.name,
      skuSnapshot: ord.sku,
      qtyReturned: qty,
      amPriceSnapshot: ord.amPrice,
      creditLineTotal: round2(ord.amPrice * qty),
    });
  }
  return items;
}

/** Post the approved credit as a NEGATIVE ledger entry (reduces what the AM
 *  owes). Linked to the return; references the order via the return record.
 *  Dedup keyed on equipment_return_id (code check + partial-unique index).
 *  The original charge is never touched — append-only correction (spec §7). */
export interface PostCreditResult {
  ok: boolean;
  error?: string;
  ledgerEntryId?: string;
  ledgerId?: string;
  amount?: number;
  reused?: boolean;
}

export async function postEquipmentReturnCredit(opts: {
  ret: EquipmentReturn;
  order: EquipmentOrder;
  actor: string;
}): Promise<PostCreditResult> {
  const { ret, order, actor } = opts;
  await ensureFinanceIndexes();

  if (!ret.creditApproved) return { ok: false, error: "Credit is not approved yet." };
  const credit = round2(Number(ret.creditAmount) || 0);
  if (credit <= 0) return { ok: false, error: "Credit amount is zero — nothing to post." };
  if (!order.ledgerId) return { ok: false, error: "The original order was never charged to a ledger — nothing to credit against." };

  const ec = coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry);
  const rc = coll<EquipmentReturn>(FINANCE_COLLECTIONS.equipmentReturn);

  const existing = await ec.findOne({ equipment_return_id: ret._id });
  if (existing) {
    await stampCredited(rc, ret._id, existing._id, actor);
    return { ok: true, reused: true, ledgerEntryId: existing._id, ledgerId: existing.ledger_id, amount: credit };
  }

  const now = new Date().toISOString();
  const entry: LedgerEntryRecord = {
    _id: newId("len"),
    ledger_id: order.ledgerId,
    type: "adjustment",
    date: now.slice(0, 10),
    amount: -credit, // negative = reduces what the AM owes (a credit)
    description: `Equipment return ${ret.returnNumber} (order ${order.orderNumber})`,
    equipment_return_id: ret._id,
    reverses_id: order.ledgerEntryId ?? null, // links the correction to the original charge
    charge_snapshot: { returnNumber: ret.returnNumber, orderNumber: order.orderNumber, orderId: order._id, creditAmount: credit },
    source: "crm",
    created_at: now,
    created_by: actor,
  };

  try {
    await ec.insertOne(entry);
  } catch (e) {
    if (isDuplicateKey(e)) {
      const winner = await ec.findOne({ equipment_return_id: ret._id });
      if (winner) {
        await stampCredited(rc, ret._id, winner._id, actor);
        return { ok: true, reused: true, ledgerEntryId: winner._id, ledgerId: winner.ledger_id, amount: credit };
      }
    }
    throw e;
  }

  await stampCredited(rc, ret._id, entry._id, actor);
  await updateOrderReturnStatus(order._id);
  return { ok: true, reused: false, ledgerEntryId: entry._id, ledgerId: order.ledgerId, amount: credit };
}

async function stampCredited(
  rc: ReturnType<typeof coll<EquipmentReturn>>,
  returnId: string,
  entryId: string,
  actor: string,
): Promise<void> {
  const now = new Date().toISOString();
  await rc.updateOne(
    { _id: returnId },
    { $set: { status: "Credited", creditLedgerEntryId: entryId, creditPostedAt: now, creditPostedBy: actor, updated_at: now } },
  );
}

/** Set the order to Returned (everything back) or PartiallyReturned. Never
 *  downgrades a Cancelled order. Charged orders keep their ledger link. */
export async function updateOrderReturnStatus(orderId: string): Promise<void> {
  await ensureFinanceIndexes();
  const oc = coll<EquipmentOrder>(FINANCE_COLLECTIONS.equipmentOrder);
  const order = await oc.findOne({ _id: orderId });
  if (!order) return;
  const prior = await priorReturnedByProduct(orderId);
  let orderedUnits = 0;
  const orderedByProduct = new Map<string, number>();
  for (const it of order.items) {
    orderedUnits += it.qty;
    orderedByProduct.set(it.productId, (orderedByProduct.get(it.productId) ?? 0) + it.qty);
  }
  let returnedUnits = 0;
  for (const q of prior.values()) returnedUnits += q;
  if (returnedUnits <= 0) return;
  const fully = [...orderedByProduct.entries()].every(([pid, qty]) => (prior.get(pid) ?? 0) >= qty);
  const status = fully && returnedUnits >= orderedUnits ? "Returned" : "PartiallyReturned";
  await oc.updateOne({ _id: orderId }, { $set: { status, updated_at: new Date().toISOString() } });
}

function isDuplicateKey(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { code?: number }).code === 11000;
}
