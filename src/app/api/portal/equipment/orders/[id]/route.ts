// Single equipment order.
//   GET  — fetch one order (cost hidden unless cost.view/profitability.view)
//   POST — run a lifecycle action:
//            { action: "approve" | "mark_delivered" | "post_to_ledger" | "cancel" }
//          Each maps to a capability whose permission is enforced here.

import { NextRequest, NextResponse } from "next/server";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { readSession, hasPermission, requirePermission } from "@/lib/rbac";
import { EQUIPMENT_CAPABILITIES, type EquipmentCapabilityKey } from "@/lib/equipment/capabilities";
import { stripOrderCost } from "@/lib/equipment/redact";
import type { EquipmentOrder } from "@/types/equipment";

const ACTION_TO_CAP: Record<string, EquipmentCapabilityKey> = {
  approve: "equipment.order.approve",
  mark_delivered: "equipment.order.mark_delivered",
  post_to_ledger: "equipment.order.post_to_ledger",
  cancel: "equipment.order.cancel",
};

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "finance:equipment_orders:view")) {
    return NextResponse.json({ error: "Forbidden", required_permission: "finance:equipment_orders:view" }, { status: 403 });
  }
  const { id } = await ctx.params;
  await ensureFinanceIndexes();
  const order = await coll<EquipmentOrder>(FINANCE_COLLECTIONS.equipmentOrder).findOne({ _id: id });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const canSeeCost = hasPermission(session, "finance:equipment_cost:view")
    || hasPermission(session, "finance:equipment_profitability:view");
  return NextResponse.json({ row: stripOrderCost(order, canSeeCost), canSeeCost });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const cap = EQUIPMENT_CAPABILITIES["equipment.order.update"];
    const session = await requirePermission(cap.permission);
    if (session instanceof NextResponse) return session;
    const body = (await req.json()) as Record<string, unknown>;
    const canViewCost = hasPermission(session, "finance:equipment_cost:view");
    const row = await cap.run(session.name, { ...body, orderId: id, canViewCost });
    return NextResponse.json({ ok: true, row });
  } catch (e) {
    console.error("[equipment order PUT] failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Update failed" }, { status: 400 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { action?: string };
    const capKey = ACTION_TO_CAP[String(body.action)];
    if (!capKey) return NextResponse.json({ error: "Unknown action" }, { status: 400 });

    const cap = EQUIPMENT_CAPABILITIES[capKey];
    const session = await requirePermission(cap.permission);
    if (session instanceof NextResponse) return session;
    const result = await cap.run(session.name, { orderId: id });
    return NextResponse.json({ ok: true, ...(result as object) });
  } catch (e) {
    console.error("[equipment order POST] failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Action failed" }, { status: 400 });
  }
}
