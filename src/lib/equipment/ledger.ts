import "server-only";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS, newId } from "@/lib/finance-db";
import { findOrCreateAmLedger } from "@/lib/dispute-service";
import type { LedgerEntryRecord } from "@/types/finance-ledger";
import type { EquipmentOrder } from "@/types/equipment";
import { LEDGER_POSTABLE_STATUSES } from "@/types/equipment";

export interface PostEquipmentResult {
  ok: boolean;
  error?: string;
  ledgerEntryId?: string;
  ledgerId?: string;
  amount?: number;
  reused?: boolean;              // true when the entry already existed (dedup)
}

// Post the AM SELLING TOTAL of an equipment order as a debit to that Area
// Manager's finance ledger — exactly once (spec §5–6, §11).
//
//   • Company cost is NEVER posted (internal profitability only).
//   • Duplicate-protected at two layers: an existing-entry check keyed on the
//     order id, AND a partial-unique index on equipment_order_id (race-safe).
//   • Append-only: a posted entry is never edited/deleted. Corrections go
//     through a Phase-B credit/reversal.
export async function postEquipmentOrderToLedger(opts: {
  order: EquipmentOrder;
  actor: string;
}): Promise<PostEquipmentResult> {
  const { order, actor } = opts;
  await ensureFinanceIndexes();

  // Guard: never charge a Draft. Only Approved/Delivered may post.
  if (!LEDGER_POSTABLE_STATUSES.includes(order.status)) {
    if (order.status === "ChargedToLedger" && order.ledgerEntryId) {
      return { ok: true, reused: true, ledgerEntryId: order.ledgerEntryId, ledgerId: order.ledgerId ?? undefined, amount: order.totals.amChargeTotal };
    }
    return { ok: false, error: `Order ${order.orderNumber} must be Approved or Delivered before it can be charged (currently ${order.status}).` };
  }
  if (!order.areaManagerName?.trim()) {
    return { ok: false, error: "Order has no Area Manager — cannot resolve a ledger to charge." };
  }
  const amount = Number(order.totals?.amChargeTotal) || 0;
  if (amount <= 0) {
    return { ok: false, error: "Order AM charge total is zero — nothing to post." };
  }

  const ec = coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry);
  const oc = coll<EquipmentOrder>(FINANCE_COLLECTIONS.equipmentOrder);

  // ── Dedup layer 1: one entry per order (existing-check). ──
  const existing = await ec.findOne({ equipment_order_id: order._id });
  if (existing) {
    await stampOrderPosted(oc, order._id, existing.ledger_id, existing._id, actor);
    return { ok: true, reused: true, ledgerEntryId: existing._id, ledgerId: existing.ledger_id, amount };
  }

  const ledger = await findOrCreateAmLedger(order.areaManagerName, order.area ?? "", actor, false);
  const now = new Date().toISOString();
  const entry: LedgerEntryRecord = {
    _id: newId("len"),
    ledger_id: ledger._id,
    type: "equipment",
    date: order.orderDate ?? now.slice(0, 10),
    amount, // positive = AM owes the company. AM selling total ONLY — never cost.
    description: `Equipment order ${order.orderNumber}`,
    equipment_order_id: order._id,
    // Cost-free snapshot: the AM ledger records only what the AM is charged.
    // Company cost / profit stay on the order, never on the AM's account.
    charge_snapshot: {
      orderNumber: order.orderNumber,
      itemCount: order.totals.itemCount,
      lineCount: order.totals.lineCount,
      amChargeTotal: order.totals.amChargeTotal,
    },
    source: "crm",
    created_at: now,
    created_by: actor,
  };

  try {
    await ec.insertOne(entry);
  } catch (e) {
    // ── Dedup layer 2: partial-unique index caught a race. Reuse the winner. ──
    if (isDuplicateKey(e)) {
      const winner = await ec.findOne({ equipment_order_id: order._id });
      if (winner) {
        await stampOrderPosted(oc, order._id, winner.ledger_id, winner._id, actor);
        return { ok: true, reused: true, ledgerEntryId: winner._id, ledgerId: winner.ledger_id, amount };
      }
    }
    throw e;
  }

  await stampOrderPosted(oc, order._id, ledger._id, entry._id, actor);
  return { ok: true, reused: false, ledgerEntryId: entry._id, ledgerId: ledger._id, amount };
}

async function stampOrderPosted(
  oc: ReturnType<typeof coll<EquipmentOrder>>,
  orderId: string,
  ledgerId: string,
  ledgerEntryId: string,
  actor: string,
): Promise<void> {
  const now = new Date().toISOString();
  await oc.updateOne(
    { _id: orderId },
    { $set: {
      status: "ChargedToLedger",
      ledgerId,
      ledgerEntryId,
      ledgerPostedAt: now,
      ledgerPostedBy: actor,
      updated_at: now,
      updated_by: actor,
    } },
  );
}

function isDuplicateKey(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { code?: number }).code === 11000;
}
