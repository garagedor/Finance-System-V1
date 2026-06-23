// Delete a whole ledger for a person + all of its entries (clean slate).
// Cascade: removes the entries first, then the ledger document.

import { NextRequest, NextResponse } from "next/server";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { readPortalSession } from "@/lib/portal-auth";
import type { LedgerEntryRecord, LedgerRecord } from "@/types/finance-ledger";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    await ensureFinanceIndexes();

    const ledger = await coll<LedgerRecord>(FINANCE_COLLECTIONS.ledger).findOne({ _id: id });
    if (!ledger) return NextResponse.json({ error: "Ledger not found" }, { status: 404 });

    const entries = await coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry).deleteMany({ ledger_id: id });
    await coll<LedgerRecord>(FINANCE_COLLECTIONS.ledger).deleteOne({ _id: id });

    return NextResponse.json({ ok: true, entriesDeleted: entries.deletedCount });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to delete ledger" },
      { status: 400 },
    );
  }
}
