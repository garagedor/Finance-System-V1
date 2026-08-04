// Assign (or clear) the Area Manager for a CRM Location. This is the explicit
// AM assignment the dispute/refund engine resolves against (never
// Location.technician). Also lists AM options for the picker.

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/finance-db";
import { readPortalSession } from "@/lib/portal-auth";
import type { Location } from "@/types/job";

// GET → { amOptions: string[] } : distinct existing Area-Manager names
// (ledger holders + names already assigned to a location).
export async function GET() {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await getDb();
  const [ledgerNames, assigned] = await Promise.all([
    db.collection("finance_ledger").distinct("holder_name", { role: "area_manager" }),
    db.collection("Location").distinct("areaManagerName", { areaManagerName: { $nin: [null, ""] } }),
  ]);
  const amOptions = [...new Set([...ledgerNames, ...assigned].map((s) => String(s).trim()).filter(Boolean))].sort();
  return NextResponse.json({ amOptions });
}

// PATCH { location, areaManagerName, areaManagerId? } — set/clear the assignment.
export async function PATCH(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = (await req.json()) as { location?: string; areaManagerName?: string; areaManagerId?: string };
    const location = String(body.location ?? "").trim();
    if (!location) return NextResponse.json({ error: "location required" }, { status: 400 });
    const name = String(body.areaManagerName ?? "").trim();

    const db = await getDb();
    const r = await db.collection<Location>("Location").updateOne(
      { _id: location } as never,
      {
        $set: {
          areaManagerName: name || null,
          areaManagerId: body.areaManagerId ? String(body.areaManagerId) : null,
          areaManagerUpdatedAt: new Date().toISOString(),
          areaManagerUpdatedBy: session.name,
        },
      } as never,
    );
    if (r.matchedCount === 0) return NextResponse.json({ error: `Location "${location}" not found` }, { status: 404 });
    return NextResponse.json({ ok: true, location, areaManagerName: name || null });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Update failed" }, { status: 400 });
  }
}
