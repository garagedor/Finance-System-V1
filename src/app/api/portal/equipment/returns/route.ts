// Equipment returns API.
//   GET  — list returns (requires equipment_orders:view)
//   POST — create a return (capability equipment.return.create)

import { NextRequest, NextResponse } from "next/server";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { readSession, hasPermission, requirePermission } from "@/lib/rbac";
import { EQUIPMENT_CAPABILITIES } from "@/lib/equipment/capabilities";
import type { EquipmentReturn } from "@/types/equipment";
import type { Filter } from "mongodb";

export async function GET(req: NextRequest) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "finance:equipment_orders:view")) {
    return NextResponse.json({ error: "Forbidden", required_permission: "finance:equipment_orders:view" }, { status: 403 });
  }
  await ensureFinanceIndexes();
  const filter: Filter<EquipmentReturn> = {};
  const orderId = req.nextUrl.searchParams.get("orderId");
  if (orderId) filter.orderId = orderId;
  const rows = await coll<EquipmentReturn>(FINANCE_COLLECTIONS.equipmentReturn)
    .find(filter).sort({ created_at: -1 }).limit(500).toArray();
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  const cap = EQUIPMENT_CAPABILITIES["equipment.return.create"];
  const session = await requirePermission(cap.permission);
  if (session instanceof NextResponse) return session;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const row = await cap.run(session.name, body);
    return NextResponse.json({ row }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Create failed" }, { status: 400 });
  }
}
