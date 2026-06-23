// Reverse a ledger entry (correction). Append-only: instead of editing/deleting,
// we post a NEW entry with the negated amount that references the original via
// reverses_id. The running balance nets the pair to zero.

import { NextRequest, NextResponse } from "next/server";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS, newId } from "@/lib/finance-db";
import { readPortalSession } from "@/lib/portal-auth";
import type { LedgerEntryRecord } from "@/types/finance-ledger";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id, entryId } = await params;
    await ensureFinanceIndexes();
    const c = coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry);

    const original = await c.findOne({ _id: entryId, ledger_id: id });
    if (!original) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    if (original.reverses_id) {
      return NextResponse.json({ error: "Can't reverse a reversal entry" }, { status: 400 });
    }
    const existing = await c.countDocuments({ ledger_id: id, reverses_id: entryId });
    if (existing > 0) {
      return NextResponse.json({ error: "This entry was already reversed" }, { status: 400 });
    }

    const doc: LedgerEntryRecord = {
      _id: newId("len"),
      ledger_id: id,
      type: "adjustment",
      date: new Date().toISOString().slice(0, 10), // correction is dated today
      amount: -original.amount,
      description: `Reversal of ${original.type} (${original.date})` +
        (original.description ? `: ${original.description}` : ""),
      reverses_id: entryId,
      source: "manual",
      created_at: new Date().toISOString(),
      created_by: session.name,
    };

    await c.insertOne(doc);
    return NextResponse.json({ row: doc }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to reverse entry" },
      { status: 400 },
    );
  }
}
