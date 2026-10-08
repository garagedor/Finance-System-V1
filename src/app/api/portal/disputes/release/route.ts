// Release a leftover dispute/refund record that left no money on any ledger.
//
//   { recordId, kind: "dispute" | "refund" }
//
// lib/dispute-coverage treats a record with no live ledger entry as an
// attempted charge and puts every other posting for the same job and amount
// under review. That is the right default, but it had no way out: the usual
// cause is an entry deleted from a ledger page, which leaves the record behind
// for good. A person who has checked the ledger releases it here, and the
// guard stops counting it.
//
// Refused while the record still has a live (un-reversed) entry — then money
// DID move, and the guard is right to block. Nothing is deleted; the record
// keeps its history plus who released it and when.

import { NextRequest, NextResponse } from "next/server";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { readPortalSession } from "@/lib/portal-auth";
import { audit } from "@/lib/audit";
import type { DisputeRecord, RefundRecord } from "@/types/finance";
import type { LedgerEntryRecord } from "@/types/finance-ledger";
import type { UpdateFilter } from "mongodb";

export async function POST(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { recordId?: unknown; kind?: unknown };
  const recordId = typeof body.recordId === "string" ? body.recordId.trim() : "";
  const kind = body.kind === "refund" ? "refund" : body.kind === "dispute" ? "dispute" : null;
  if (!recordId || !kind) {
    return NextResponse.json({ error: "recordId and kind (dispute | refund) are required" }, { status: 400 });
  }

  await ensureFinanceIndexes();
  const c = coll<DisputeRecord | RefundRecord>(
    kind === "dispute" ? FINANCE_COLLECTIONS.dispute : FINANCE_COLLECTIONS.refund,
  );
  const before = await c.findOne({ _id: recordId });
  if (!before) return NextResponse.json({ error: `Record ${recordId} not found` }, { status: 404 });
  if (before.released_at) return NextResponse.json({ ok: true, alreadyReleased: true });

  const ec = coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry);
  const entries = await ec.find({ dispute_id: recordId }, { projection: { _id: 1, ledger_id: 1 } }).toArray();
  const reversed = entries.length
    ? new Set(
        (await ec.find({ reverses_id: { $in: entries.map((e) => e._id) } }, { projection: { reverses_id: 1 } }).toArray())
          .map((r) => String(r.reverses_id)),
      )
    : new Set<string>();
  const live = entries.filter((e) => !reversed.has(e._id));
  if (live.length > 0) {
    return NextResponse.json({
      error: `Record ${recordId} still has ${live.length} live ledger entr${live.length === 1 ? "y" : "ies"} (${live.map((e) => e._id).join(", ")}) — money did move. Reverse or delete the entry on the ledger first.`,
    }, { status: 409 });
  }

  const patch = { released_at: new Date().toISOString(), released_by: session.name };
  await c.updateOne({ _id: recordId }, { $set: patch } as unknown as UpdateFilter<DisputeRecord | RefundRecord>);

  await audit({
    kind,
    target_id: recordId,
    before,
    after: { ...before, ...patch },
    summary: `Released ${kind} record ${recordId} (job ${before.job_id ?? "?"}) — confirmed no money on any ledger; no longer blocks posting`,
    changed_by: session.name,
    action: "release",
  });

  return NextResponse.json({ ok: true, ...patch });
}
