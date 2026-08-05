// Resolve a dispute (won / lost / partial) with a targeted update — NEVER goes
// through the generic CRUD normalize (which would reset the filed `date` and
// `amount_disputed`). Only touches status / recovery / resolved_date, so the
// filed month, disputed amount and charge_snapshot stay intact. The dashboard
// books the company-slice recovery in the month of `resolved_date`.

import { NextRequest, NextResponse } from "next/server";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { readPortalSession } from "@/lib/portal-auth";
import { audit } from "@/lib/audit";
import type { DisputeRecord } from "@/types/finance";
import type { UpdateFilter } from "mongodb";

const VALID = ["won", "lost", "partial", "open"] as const;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const status = String(body.status ?? "");
  if (!VALID.includes(status as (typeof VALID)[number])) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  await ensureFinanceIndexes();
  const c = coll<DisputeRecord>(FINANCE_COLLECTIONS.dispute);
  const before = await c.findOne({ _id: id });
  if (!before) return NextResponse.json({ error: "Dispute not found" }, { status: 404 });

  const disputed = before.amount_disputed ?? 0;
  // Recovery: won → full disputed (unless overridden); lost → 0; partial → given.
  let recovered: number;
  if (status === "won") recovered = body.amount_recovered != null ? Number(body.amount_recovered) : disputed;
  else if (status === "lost") recovered = 0;
  else if (status === "partial") recovered = Math.max(0, Number(body.amount_recovered ?? 0));
  else recovered = before.amount_recovered ?? 0; // reopened
  if (!Number.isFinite(recovered)) recovered = 0;
  recovered = Math.min(recovered, disputed);

  const resolved = status === "open"
    ? null
    : (body.resolved_date != null && String(body.resolved_date).trim()
        ? String(body.resolved_date)
        : new Date().toISOString().slice(0, 10));

  const patch = {
    status,
    amount_recovered: recovered,
    amount_open: Math.max(0, disputed - recovered),
    resolved_date: resolved,
    updated_at: new Date().toISOString(),
    updated_by: session.name,
  };
  // patch carries null + audit fields the typed schema doesn't model — cast the
  // update doc (same spirit as the shared CRUD helper).
  await c.updateOne({ _id: id }, { $set: patch } as unknown as UpdateFilter<DisputeRecord>);

  await audit({
    kind: "dispute",
    target_id: id,
    before,
    after: { ...before, ...patch },
    summary: `Resolved dispute "${before.customer_name ?? id}" → ${status} (recovered $${recovered.toLocaleString()}${resolved ? `, on ${resolved}` : ""})`,
    changed_by: session.name,
  });

  return NextResponse.json({ ok: true, ...patch });
}
