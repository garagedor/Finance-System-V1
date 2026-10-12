// Transfer a posted dispute/refund charge to another Area Manager's ledger.
//
//   POST { toLedgerId }
//
// Moves the entry (same id, amount and snapshot) and points the dispute/refund
// record at the new AM. Rules and the reason it is a move rather than a
// reverse + re-post are in lib/dispute-transfer.

import { NextRequest, NextResponse } from "next/server";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { readPortalSession } from "@/lib/portal-auth";
import { audit } from "@/lib/audit";
import { planDisputeTransfer } from "@/lib/dispute-transfer";
import type { LedgerEntryRecord, LedgerRecord } from "@/types/finance-ledger";
import type { DisputeRecord, RefundRecord } from "@/types/finance";
import type { UpdateFilter } from "mongodb";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, entryId } = await params;
  const body = (await req.json().catch(() => ({}))) as { toLedgerId?: unknown };
  const toLedgerId = typeof body.toLedgerId === "string" ? body.toLedgerId.trim() : "";
  if (!toLedgerId) return NextResponse.json({ error: "toLedgerId is required" }, { status: 400 });

  try {
    await ensureFinanceIndexes();
    const ec = coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry);
    const lc = coll<LedgerRecord>(FINANCE_COLLECTIONS.ledger);

    const entry = await ec.findOne({ _id: entryId, ledger_id: id });
    if (!entry) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    const from = await lc.findOne({ _id: id });
    if (!from) return NextResponse.json({ error: "Ledger not found" }, { status: 404 });
    const to = await lc.findOne({ _id: toLedgerId });

    const isReversed = (await ec.countDocuments({ reverses_id: entryId })) > 0;
    let targetHasLiveEntry = false;
    if (entry.dispute_id) {
      const onTarget = await ec.find({ dispute_id: entry.dispute_id, ledger_id: toLedgerId }, { projection: { _id: 1 } }).toArray();
      if (onTarget.length) {
        const undone = await ec.countDocuments({ reverses_id: { $in: onTarget.map((e) => e._id) } });
        targetHasLiveEntry = onTarget.length > undone;
      }
    }

    const now = new Date().toISOString();
    const plan = planDisputeTransfer({ entry, from, to, isReversed, targetHasLiveEntry }, session.name, now);
    if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: plan.status });

    // Guarded on the source ledger so two concurrent transfers can't both win.
    const moved = await ec.updateOne({ _id: entryId, ledger_id: id }, { $set: plan.set });
    if (moved.modifiedCount !== 1) return NextResponse.json({ error: "The entry changed meanwhile — reload and try again." }, { status: 409 });

    // The record names the AM it is charged to; keep it in step.
    const kind = entry.type === "refund" ? "refund" : "dispute";
    const rc = coll<DisputeRecord | RefundRecord>(kind === "dispute" ? FINANCE_COLLECTIONS.dispute : FINANCE_COLLECTIONS.refund);
    await rc.updateOne(
      { _id: entry.dispute_id! },
      { $set: { area_manager_name: plan.areaManagerName, updated_at: now } } as unknown as UpdateFilter<DisputeRecord | RefundRecord>,
    );

    await audit({
      kind,
      target_id: entry.dispute_id!,
      before: { ledger_entry_id: entryId, ledger_id: from._id, holder_name: from.holder_name, amount: entry.amount },
      after: { ledger_entry_id: entryId, ledger_id: to!._id, holder_name: to!.holder_name, amount: entry.amount },
      summary: `Transferred ${kind} charge ${entryId} (${entry.amount}) from ${from.holder_name}'s ledger to ${to!.holder_name}'s`,
      changed_by: session.name,
      action: "transfer",
    });

    return NextResponse.json({ ok: true, entryId, toLedgerId: to!._id });
  } catch (e) {
    console.error("POST transfer error", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to transfer" }, { status: 500 });
  }
}
