// Equipment product catalog API.
//   GET  — list products (company cost hidden unless finance:equipment_cost:view)
//   POST — create a product   (capability equipment.product.create)
//   PUT  — update a product    (capability equipment.product.update)
//   DELETE — remove a product  (finance:equipment_products:edit)
//
// Mutations run through the capability layer (permission + audit live there).

import { NextRequest, NextResponse } from "next/server";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { readSession, hasPermission, requirePermission } from "@/lib/rbac";
import { EQUIPMENT_CAPABILITIES } from "@/lib/equipment/capabilities";
import type { EquipmentProduct } from "@/types/equipment";
import type { Filter } from "mongodb";

export async function GET(req: NextRequest) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "finance:equipment_products:view")) {
    return NextResponse.json({ error: "Forbidden", required_permission: "finance:equipment_products:view" }, { status: 403 });
  }
  await ensureFinanceIndexes();
  const sp = req.nextUrl.searchParams;
  const filter: Filter<EquipmentProduct> = {};
  if (sp.get("all") !== "1") filter.active = true;
  const q = (sp.get("q") ?? "").trim();
  if (q) {
    const rx = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    Object.assign(filter, { $or: [{ name: rx }, { sku: rx }, { category: rx }] });
  }
  const rows = await coll<EquipmentProduct>(FINANCE_COLLECTIONS.equipmentProduct)
    .find(filter).sort({ name: 1 }).limit(1000).toArray();

  // Company cost is confidential — strip it server-side unless allowed.
  const canSeeCost = hasPermission(session, "finance:equipment_cost:view");
  const out = canSeeCost ? rows : rows.map((r) => {
    const o: Record<string, unknown> = { ...r };
    delete o.companyCost;
    return o;
  });
  return NextResponse.json({ rows: out, canSeeCost });
}

export async function POST(req: NextRequest) {
  const cap = EQUIPMENT_CAPABILITIES["equipment.product.create"];
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

export async function PUT(req: NextRequest) {
  const cap = EQUIPMENT_CAPABILITIES["equipment.product.update"];
  const session = await requirePermission(cap.permission);
  if (session instanceof NextResponse) return session;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const row = await cap.run(session.name, body);
    return NextResponse.json({ ok: true, row });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Update failed" }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await requirePermission("finance:equipment_products:edit");
  if (session instanceof NextResponse) return session;
  await ensureFinanceIndexes();
  const id = req.nextUrl.searchParams.get("_id");
  if (!id) return NextResponse.json({ error: "_id required" }, { status: 400 });
  const r = await coll<EquipmentProduct>(FINANCE_COLLECTIONS.equipmentProduct).deleteOne({ _id: id });
  return NextResponse.json({ deletedCount: r.deletedCount });
}
