// Undo the last generation run of a recurring income template: delete every
// income entry created in that run (and its linked ledger entry), roll the
// template's next_due_date back, and clear the run marker.
//
// POST /api/portal/recurring-income/undo?_id=rincome_xxx

import { NextRequest, NextResponse } from "next/server";
import { readPortalSession } from "@/lib/portal-auth";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import type { ManualIncomeRecord, RecurringIncomeRecord } from "@/types/finance";
import type { LedgerEntryRecord } from "@/types/finance-ledger";

export async function POST(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await ensureFinanceIndexes();
    const id = req.nextUrl.searchParams.get("_id");
    if (!id) return NextResponse.json({ error: "_id required" }, { status: 400 });

    const tColl = coll<RecurringIncomeRecord>(FINANCE_COLLECTIONS.recurringIncome);
    const iColl = coll<ManualIncomeRecord>(FINANCE_COLLECTIONS.income);
    const leColl = coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry);

    const t = await tColl.findOne({ _id: id });
    if (!t) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    if (!t.last_run_at) return NextResponse.json({ error: "Nothing to undo — no recent run." }, { status: 400 });

    // Every entry stamped with this run.
    const rows = await iColl.find({ recurring_id: id, generated_run: t.last_run_at }).toArray();
    let ledgerRemoved = 0;
    for (const r of rows) {
      if (r.ledger_entry_id) {
        const del = await leColl.deleteOne({ _id: r.ledger_entry_id });
        ledgerRemoved += del.deletedCount ?? 0;
      }
      await iColl.deleteOne({ _id: r._id });
    }

    // Roll the template back to before that run and clear the marker.
    const restoreNextDue = t.prev_next_due ?? t.next_due_date;
    const dec = Math.min(t.last_run_count ?? rows.length, t.total_generated ?? 0);
    await tColl.updateOne(
      { _id: id },
      {
        $set: { next_due_date: restoreNextDue },
        $unset: {
          last_generated_at: "", last_generated_for: "",
          last_run_at: "", last_run_count: "", prev_next_due: "",
        },
        $inc: { total_generated: -dec },
      },
    );

    return NextResponse.json({
      ok: true,
      undone: rows.length,
      ledger_entries_removed: ledgerRemoved,
      next_due: restoreNextDue,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Undo failed" }, { status: 400 });
  }
}
