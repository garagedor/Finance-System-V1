// Pickable items for the custom itemized report. One normalized shape per
// category; the builder cherry-picks specific rows.

import { NextRequest, NextResponse } from "next/server";
import { readPortalSession } from "@/lib/portal-auth";
import { listCustomItems, CUSTOM_ITEM_TYPES, type CustomItemType } from "@/lib/custom-report";

export const dynamic = "force-dynamic";

const csv = (v: string | null): string[] => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

export async function GET(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const type = sp.get("type") as CustomItemType;
  if (!CUSTOM_ITEM_TYPES.includes(type)) return NextResponse.json({ error: "Invalid item type" }, { status: 400 });
  const from = sp.get("from")?.trim();
  const to = sp.get("to")?.trim();
  if (!from || !to) return NextResponse.json({ error: "Date range is required" }, { status: 400 });

  try {
    const list = await listCustomItems({
      type, from, to,
      ledgerId: sp.get("ledgerId")?.trim() || undefined,
      providers: csv(sp.get("providers")),
      techs: csv(sp.get("techs")),
      locations: csv(sp.get("locations")),
    });
    return NextResponse.json(list);
  } catch (err) {
    console.error("GET /api/portal/custom-report/items error", err);
    return NextResponse.json({ error: "Failed to list items" }, { status: 500 });
  }
}
