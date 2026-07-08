// Technician dispute/refund rates: GET the merged list, POST to set/clear an
// override for one technician.

import { NextRequest, NextResponse } from "next/server";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { readPortalSession } from "@/lib/portal-auth";
import { getTechRates } from "@/lib/portal-tech-rates";
import type { TechnicianRateRecord } from "@/types/finance-ledger";

export async function GET() {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rates = await getTechRates();
  return NextResponse.json({ rows: rates });
}

export async function POST(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await ensureFinanceIndexes();
    const body = (await req.json()) as Record<string, unknown>;
    const name = String(body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "Technician name is required" }, { status: 400 });

    const c = coll<TechnicianRateRecord>(FINANCE_COLLECTIONS.techRate);
    const raw = body.dispute_pct;
    // Empty / null clears the override (revert to the CRM profit %).
    if (raw === null || raw === "" || raw === undefined) {
      await c.deleteOne({ _id: name });
      return NextResponse.json({ ok: true, cleared: true });
    }
    const pct = Number(raw);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return NextResponse.json({ error: "Percentage must be between 0 and 100" }, { status: 400 });
    }
    await c.updateOne(
      { _id: name },
      {
        $set: {
          dispute_pct: pct,
          note: body.note ? String(body.note) : null,
          updated_at: new Date().toISOString(),
          updated_by: session.name,
        },
      },
      { upsert: true },
    );
    return NextResponse.json({ ok: true, dispute_pct: pct });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to save rate" },
      { status: 400 },
    );
  }
}
