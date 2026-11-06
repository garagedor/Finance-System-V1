// Incrementally syncs transactions for one (or all) connected institutions.
// Uses Plaid's /transactions/sync cursor pattern. Idempotent.
//
// POST /api/portal/plaid/sync           — sync all active institutions
// POST /api/portal/plaid/sync?item_id=X — sync just one
// (The same runs daily on its own: api/scanpay/cron-sync/bank-sync.)

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { isPlaidConfigured } from "@/lib/plaid";
import { syncInstitutions } from "@/lib/plaid-sync";

export async function POST(req: NextRequest) {
  const session = await requirePermission("finance:banking:sync");
  if (session instanceof NextResponse) return session;
  if (!isPlaidConfigured()) return NextResponse.json({ error: "Plaid not configured" }, { status: 503 });

  const results = await syncInstitutions(session.name, req.nextUrl.searchParams.get("item_id"));
  if (results.length === 0) {
    return NextResponse.json({ error: "No connected institutions to sync" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, results });
}
