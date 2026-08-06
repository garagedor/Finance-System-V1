// Single equipment return.
//   GET  — fetch one return
//   POST — { action: "approve" | "post_credit" } via capabilities.

import { NextRequest, NextResponse } from "next/server";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { readSession, hasPermission, requirePermission } from "@/lib/rbac";
import { EQUIPMENT_CAPABILITIES, type EquipmentCapabilityKey } from "@/lib/equipment/capabilities";
import type { EquipmentReturn } from "@/types/equipment";

const ACTION_TO_CAP: Record<string, EquipmentCapabilityKey> = {
  approve: "equipment.return.approve",
  post_credit: "equipment.return.post_credit",
};

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "finance:equipment_orders:view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  await ensureFinanceIndexes();
  const row = await coll<EquipmentReturn>(FINANCE_COLLECTIONS.equipmentReturn).findOne({ _id: id });
  if (!row) return NextResponse.json({ error: "Return not found" }, { status: 404 });
  return NextResponse.json({ row });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: string; creditAmount?: number };
  const capKey = ACTION_TO_CAP[String(body.action)];
  if (!capKey) return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  const cap = EQUIPMENT_CAPABILITIES[capKey];
  const session = await requirePermission(cap.permission);
  if (session instanceof NextResponse) return session;
  try {
    const result = await cap.run(session.name, { returnId: id, creditAmount: body.creditAmount });
    return NextResponse.json({ ok: true, ...(result as object) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Action failed" }, { status: 400 });
  }
}
