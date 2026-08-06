// Equipment orders API.
//   GET  — list orders (cost-derived figures hidden unless cost.view)
//   POST — create an order (capability equipment.order.create)

import { NextRequest, NextResponse } from "next/server";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { readSession, hasPermission, requirePermission } from "@/lib/rbac";
import { EQUIPMENT_CAPABILITIES } from "@/lib/equipment/capabilities";
import { stripOrderCost } from "@/lib/equipment/redact";
import type { EquipmentOrder } from "@/types/equipment";
import type { Filter } from "mongodb";

export async function GET(req: NextRequest) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "finance:equipment_orders:view")) {
    return NextResponse.json({ error: "Forbidden", required_permission: "finance:equipment_orders:view" }, { status: 403 });
  }
  await ensureFinanceIndexes();
  const sp = req.nextUrl.searchParams;
  const filter: Filter<EquipmentOrder> = {};
  const status = sp.get("status");
  if (status) filter.status = status as EquipmentOrder["status"];
  const am = sp.get("areaManager");
  if (am) filter.areaManagerName = am;
  const from = sp.get("from");
  const to = sp.get("to");
  if (from || to) {
    filter.orderDate = {};
    if (from) (filter.orderDate as Record<string, string>).$gte = from;
    if (to) (filter.orderDate as Record<string, string>).$lte = to;
  }
  const rows = await coll<EquipmentOrder>(FINANCE_COLLECTIONS.equipmentOrder)
    .find(filter).sort({ orderDate: -1, _id: -1 }).limit(500).toArray();

  const canSeeCost = hasPermission(session, "finance:equipment_cost:view")
    || hasPermission(session, "finance:equipment_profitability:view");
  return NextResponse.json({ rows: rows.map((r) => stripOrderCost(r, canSeeCost)), canSeeCost });
}

export async function POST(req: NextRequest) {
  const cap = EQUIPMENT_CAPABILITIES["equipment.order.create"];
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
