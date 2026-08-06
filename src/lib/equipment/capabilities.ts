import "server-only";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS, newId } from "@/lib/finance-db";
import { audit, diffSummary } from "@/lib/audit";
import type { Permission } from "@/types/rbac";
import type {
  EquipmentProduct,
  EquipmentOrder,
  EquipmentOrderStatus,
  SellingUnit,
} from "@/types/equipment";
import { buildOrderItems, nextOrderNumber, type OrderLineInput } from "./orders";
import { computeOrderTotals } from "./totals";
import { postEquipmentOrderToLedger } from "./ledger";
import { fmt$ } from "@/app/portal/format";

// ── Capability registry (spec §12) ──────────────────────────────────────────
// The equipment workflow is expressed as named, reusable actions. Each entry
// declares the RBAC permission it requires (single source of truth — the API
// routes gate on `EQUIPMENT_CAPABILITIES[key].permission`) and a `run` handler
// that performs the mutation via the shared finance services AND writes an
// audit row. ALL ledger posting flows through lib/equipment/ledger, which uses
// the shared ledger — no ledger math is duplicated here.

export type EquipmentCapabilityKey =
  | "equipment.product.create"
  | "equipment.product.update"
  | "equipment.order.create"
  | "equipment.order.approve"
  | "equipment.order.mark_delivered"
  | "equipment.order.post_to_ledger"
  | "equipment.order.cancel"
  | "equipment.return.create"
  | "equipment.return.approve"
  | "equipment.return.post_credit";

export interface EquipmentCapability<TArgs = Record<string, unknown>, TResult = unknown> {
  permission: Permission;
  summary: string;
  run: (actor: string, args: TArgs) => Promise<TResult>;
}

const NOW = () => new Date().toISOString();
const DAY = () => new Date().toISOString().slice(0, 10);

async function loadOrder(id: string): Promise<EquipmentOrder> {
  await ensureFinanceIndexes();
  const o = await coll<EquipmentOrder>(FINANCE_COLLECTIONS.equipmentOrder).findOne({ _id: id });
  if (!o) throw new Error(`Equipment order not found: ${id}`);
  return o;
}

// ── Product handlers ────────────────────────────────────────────────────────

interface ProductInput {
  name?: string;
  sku?: string;
  category?: string;
  description?: string | null;
  sellingUnit?: SellingUnit | string;
  companyCost?: number;
  amPrice?: number;
  active?: boolean;
  trackInventory?: boolean;
  stockQty?: number | null;
  notes?: string | null;
}

function normalizeProduct(input: ProductInput): Partial<EquipmentProduct> {
  const out: Partial<EquipmentProduct> = {};
  if (input.name !== undefined) out.name = String(input.name).trim();
  if (input.sku !== undefined) out.sku = String(input.sku).trim();
  if (input.category !== undefined) out.category = String(input.category).trim();
  if (input.description !== undefined) out.description = input.description ?? null;
  if (input.sellingUnit !== undefined) out.sellingUnit = input.sellingUnit as SellingUnit;
  if (input.companyCost !== undefined) out.companyCost = Math.max(0, Number(input.companyCost) || 0);
  if (input.amPrice !== undefined) out.amPrice = Math.max(0, Number(input.amPrice) || 0);
  if (input.active !== undefined) out.active = !!input.active;
  if (input.trackInventory !== undefined) out.trackInventory = !!input.trackInventory;
  if (input.stockQty !== undefined) out.stockQty = input.stockQty == null ? null : Number(input.stockQty);
  if (input.notes !== undefined) out.notes = input.notes ?? null;
  return out;
}

// ── Order create input ──────────────────────────────────────────────────────

interface OrderCreateInput {
  areaManagerId?: string | null;
  areaManagerName?: string;
  area?: string | null;
  orderDate?: string;
  deliveryMethod?: string | null;
  expectedDeliveryAt?: string | null;
  notes?: string | null;
  lines?: OrderLineInput[];
}

export const EQUIPMENT_CAPABILITIES: Record<EquipmentCapabilityKey, EquipmentCapability> = {
  "equipment.product.create": {
    permission: "finance:equipment_products:create",
    summary: "Create a catalog product",
    run: async (actor, args) => {
      await ensureFinanceIndexes();
      const patch = normalizeProduct(args as ProductInput);
      if (!patch.name) throw new Error("Product name is required.");
      if (!patch.sku) throw new Error("SKU is required.");
      const doc: EquipmentProduct = {
        _id: newId("prod"),
        name: patch.name,
        sku: patch.sku,
        category: patch.category ?? "",
        description: patch.description ?? null,
        sellingUnit: (patch.sellingUnit as SellingUnit) ?? "unit",
        companyCost: patch.companyCost ?? 0,
        amPrice: patch.amPrice ?? 0,
        active: patch.active ?? true,
        trackInventory: patch.trackInventory ?? false,
        stockQty: patch.stockQty ?? null,
        notes: patch.notes ?? null,
        created_at: NOW(),
        created_by: actor,
      };
      await coll<EquipmentProduct>(FINANCE_COLLECTIONS.equipmentProduct).insertOne(doc);
      await audit({
        kind: "equipment", action: "equipment.product.create", target_id: doc._id,
        before: null, after: doc, changed_by: actor,
        summary: `Created product ${doc.name} (${doc.sku}) — AM price ${fmt$(doc.amPrice)}`,
      });
      return doc;
    },
  },

  "equipment.product.update": {
    permission: "finance:equipment_products:edit",
    summary: "Update a catalog product (incl. price changes)",
    run: async (actor, args) => {
      await ensureFinanceIndexes();
      const { _id, ...rest } = args as ProductInput & { _id?: string };
      if (!_id) throw new Error("Product _id is required.");
      const c = coll<EquipmentProduct>(FINANCE_COLLECTIONS.equipmentProduct);
      const before = await c.findOne({ _id });
      if (!before) throw new Error(`Product not found: ${_id}`);
      const patch = normalizeProduct(rest);
      await c.updateOne({ _id }, { $set: { ...patch, updated_at: NOW(), updated_by: actor } });
      const after = await c.findOne({ _id });
      await audit({
        kind: "equipment", action: "equipment.product.update", target_id: _id,
        before, after, changed_by: actor,
        summary: `Updated product ${before.name}: ${diffSummary(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>)}`,
      });
      return after;
    },
  },

  "equipment.order.create": {
    permission: "finance:equipment_orders:create",
    summary: "Create an equipment order (Draft)",
    run: async (actor, args) => {
      await ensureFinanceIndexes();
      const input = args as OrderCreateInput;
      const amName = String(input.areaManagerName ?? "").trim();
      if (!amName) throw new Error("Select an Area Manager for the order.");
      const items = await buildOrderItems(input.lines ?? []);
      const totals = computeOrderTotals(items);
      const orderDate = input.orderDate || DAY();
      const year = Number(orderDate.slice(0, 4)) || new Date().getFullYear();
      const doc: EquipmentOrder = {
        _id: newId("eord"),
        orderNumber: await nextOrderNumber(year),
        areaManagerId: input.areaManagerId ?? null,
        areaManagerName: amName,
        area: input.area ?? null,
        orderDate,
        createdBy: actor,
        deliveryMethod: input.deliveryMethod ?? null,
        expectedDeliveryAt: input.expectedDeliveryAt ?? null,
        notes: input.notes ?? null,
        status: "Draft",
        items,
        totals,
        ledgerId: null,
        ledgerEntryId: null,
        ledgerPostedAt: null,
        ledgerPostedBy: null,
        created_at: NOW(),
      };
      await coll<EquipmentOrder>(FINANCE_COLLECTIONS.equipmentOrder).insertOne(doc);
      await audit({
        kind: "equipment", action: "equipment.order.create", target_id: doc._id,
        before: null, after: doc, changed_by: actor,
        summary: `Created order ${doc.orderNumber} for ${amName} — ${totals.itemCount} units, AM charge ${fmt$(totals.amChargeTotal)}`,
      });
      return doc;
    },
  },

  "equipment.order.approve": {
    permission: "finance:equipment_orders:approve",
    summary: "Approve an equipment order",
    run: async (actor, args) => {
      const { orderId } = args as { orderId: string };
      const order = await loadOrder(orderId);
      if (!["Draft", "PendingApproval"].includes(order.status)) {
        throw new Error(`Only a Draft or Pending order can be approved (currently ${order.status}).`);
      }
      const now = NOW();
      await coll<EquipmentOrder>(FINANCE_COLLECTIONS.equipmentOrder).updateOne(
        { _id: orderId },
        { $set: { status: "Approved", approved_at: now, approved_by: actor, updated_at: now, updated_by: actor } },
      );
      await audit({
        kind: "equipment", action: "equipment.order.approve", target_id: orderId,
        before: { status: order.status }, after: { status: "Approved" }, changed_by: actor,
        summary: `Approved order ${order.orderNumber}`,
      });
      return { ok: true, status: "Approved" as EquipmentOrderStatus };
    },
  },

  "equipment.order.mark_delivered": {
    permission: "finance:equipment_orders:deliver",
    summary: "Mark an equipment order delivered",
    run: async (actor, args) => {
      const { orderId } = args as { orderId: string };
      const order = await loadOrder(orderId);
      if (!["Approved", "ReadyForPickup"].includes(order.status)) {
        throw new Error(`Only an Approved or Ready order can be marked delivered (currently ${order.status}).`);
      }
      const now = NOW();
      await coll<EquipmentOrder>(FINANCE_COLLECTIONS.equipmentOrder).updateOne(
        { _id: orderId },
        { $set: { status: "Delivered", delivered_at: now, delivered_by: actor, updated_at: now, updated_by: actor } },
      );
      await audit({
        kind: "equipment", action: "equipment.order.mark_delivered", target_id: orderId,
        before: { status: order.status }, after: { status: "Delivered" }, changed_by: actor,
        summary: `Marked order ${order.orderNumber} delivered`,
      });
      return { ok: true, status: "Delivered" as EquipmentOrderStatus };
    },
  },

  "equipment.order.post_to_ledger": {
    permission: "finance:equipment_orders:post_ledger",
    summary: "Post the AM selling total to the Area Manager's ledger",
    run: async (actor, args) => {
      const { orderId } = args as { orderId: string };
      const order = await loadOrder(orderId);
      const res = await postEquipmentOrderToLedger({ order, actor });
      if (!res.ok) throw new Error(res.error ?? "Failed to post to ledger.");
      // Only audit an actual new posting (dedup no-ops don't re-log a charge).
      if (!res.reused) {
        await audit({
          kind: "equipment", action: "equipment.order.post_to_ledger", target_id: orderId,
          before: { status: order.status, ledgerEntryId: null },
          after: { status: "ChargedToLedger", ledgerEntryId: res.ledgerEntryId, ledgerId: res.ledgerId },
          changed_by: actor,
          summary: `Posted order ${order.orderNumber} to ${order.areaManagerName}'s ledger — debit ${fmt$(res.amount ?? 0)}`,
        });
      }
      return res;
    },
  },

  "equipment.order.cancel": {
    permission: "finance:equipment_orders:approve",
    summary: "Cancel an equipment order",
    run: async (actor, args) => {
      const { orderId } = args as { orderId: string };
      const order = await loadOrder(orderId);
      if (order.status === "ChargedToLedger") {
        throw new Error("A charged order cannot be cancelled — issue a credit/return instead.");
      }
      const now = NOW();
      await coll<EquipmentOrder>(FINANCE_COLLECTIONS.equipmentOrder).updateOne(
        { _id: orderId },
        { $set: { status: "Cancelled", cancelled_at: now, cancelled_by: actor, updated_at: now, updated_by: actor } },
      );
      await audit({
        kind: "equipment", action: "equipment.order.cancel", target_id: orderId,
        before: { status: order.status }, after: { status: "Cancelled" }, changed_by: actor,
        summary: `Cancelled order ${order.orderNumber}`,
      });
      return { ok: true, status: "Cancelled" as EquipmentOrderStatus };
    },
  },

  // ── Returns / credits — Phase B (declared now; handlers land next). ──
  "equipment.return.create": {
    permission: "finance:equipment_returns:create",
    summary: "Create an equipment return (Phase B)",
    run: async () => { throw new Error("Equipment returns ship in Phase B."); },
  },
  "equipment.return.approve": {
    permission: "finance:equipment_returns:approve",
    summary: "Approve an equipment credit (Phase B)",
    run: async () => { throw new Error("Equipment credits ship in Phase B."); },
  },
  "equipment.return.post_credit": {
    permission: "finance:equipment_returns:approve",
    summary: "Post an equipment credit to the ledger (Phase B)",
    run: async () => { throw new Error("Equipment credits ship in Phase B."); },
  },
};
