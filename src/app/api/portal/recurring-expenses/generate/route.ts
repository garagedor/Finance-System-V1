// Generates due Expense rows from active recurring templates.
//
// Idempotent: each (recurring_id, date) pair creates at most one Expense.
// Mongo enforces this via the upsert filter — if an Expense already exists
// for that template+date, we skip.
//
// Trigger: POST /api/portal/recurring-expenses/generate
//          POST /api/portal/recurring-expenses/generate?_id=rec_xxx  (one only)
//          POST /api/portal/recurring-expenses/generate?asOf=YYYY-MM-DD (override "today")

import { NextRequest, NextResponse } from "next/server";
import { readPortalSession } from "@/lib/portal-auth";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes, newId } from "@/lib/finance-db";
import type { ExpenseRecord, RecurringExpenseRecord } from "@/types/finance";
import type { LedgerRecord } from "@/types/finance-ledger";
import { dueDatesUpTo, nextDueAfter } from "@/lib/recurring-schedule";
import { postLinkedLedgerEntry } from "@/lib/ledger-link";

export async function POST(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureFinanceIndexes();

  const sp = req.nextUrl.searchParams;
  const oneId = sp.get("_id");
  const asOf = sp.get("asOf") ?? new Date().toISOString().slice(0, 10);

  const tColl = coll<RecurringExpenseRecord>(FINANCE_COLLECTIONS.recurringExpense);
  const eColl = coll<ExpenseRecord>(FINANCE_COLLECTIONS.expense);
  const lColl = coll<LedgerRecord>(FINANCE_COLLECTIONS.ledger);

  const templates = await tColl
    .find(oneId ? { _id: oneId } : { active: true })
    .toArray();

  const results: Array<{
    template_id: string;
    name: string;
    generated: number;
    skipped_existing: number;
    next_due: string;
  }> = [];

  for (const t of templates) {
    if (!t.active && !oneId) continue;
    const dueDates = dueDatesUpTo(t, asOf);
    let generated = 0;
    let skipped = 0;
    let lastGenerated = t.last_generated_for;

    // Resolve the linked ledger once (if any) so each generated expense can also
    // post a POSITIVE mirror entry (we paid them). One run timestamp stamps every
    // entry created this run, so the whole run can be undone later.
    const ledger = t.ledger_id ? await lColl.findOne({ _id: t.ledger_id }) : null;
    const runTs = new Date().toISOString();
    const prevNextDue = t.next_due_date;

    for (const due of dueDates) {
      // Idempotency: skip if an expense already exists for (template, date).
      const existing = await eColl.findOne({ recurring_id: t._id, date: due });
      if (existing) { skipped++; continue; }
      const exp: ExpenseRecord = {
        _id: newId("exp"),
        category: t.category,
        amount: t.amount,
        date: due,
        vendor_name: t.vendor_name,
        vendor_id: t.vendor_id,
        related_person_id: t.related_person_id,
        related_area: t.related_area,
        payment_method: t.payment_method,
        notes: t.notes ? `${t.notes}\n[Auto-generated from recurring "${t.name}"]` : `[Auto-generated from recurring "${t.name}"]`,
        description: t.name,
        status: t.default_status,
        recurring_id: t._id,
        generated_run: runTs,
        ledger_id: ledger?._id,
        ledger_holder: ledger?.holder_name,
        created_at: new Date().toISOString(),
        created_by: `recurring:${session.name}`,
      };
      if (t.default_status === "paid") {
        exp.paid_at = new Date(due + "T00:00:00Z").toISOString();
        exp.paid_by = session.name;
      }
      await eColl.insertOne(exp);
      if (ledger) {
        const entryId = await postLinkedLedgerEntry({
          ledgerId: ledger._id, kind: "expense", refId: exp._id,
          amount: exp.amount, date: exp.date, description: exp.description, actor: `recurring:${session.name}`,
        });
        await eColl.updateOne({ _id: exp._id }, { $set: { ledger_entry_id: entryId } });
      }
      generated++;
      lastGenerated = due;
    }

    // Advance next_due_date past the most recent generated period
    let nextDue = t.next_due_date;
    while (nextDue <= asOf) {
      const after = nextDueAfter(t, nextDue);
      if (after === nextDue) break;
      nextDue = after;
      if (t.end_date && nextDue > t.end_date) break;
    }

    if (generated > 0 || nextDue !== t.next_due_date) {
      await tColl.updateOne(
        { _id: t._id },
        {
          $set: {
            next_due_date: nextDue,
            last_generated_at: new Date().toISOString(),
            last_generated_for: lastGenerated ?? t.last_generated_for,
            ...(generated > 0
              ? { last_run_at: runTs, last_run_count: generated, prev_next_due: prevNextDue }
              : {}),
          },
          $inc: { total_generated: generated },
        }
      );
    }

    results.push({
      template_id: t._id,
      name: t.name,
      generated,
      skipped_existing: skipped,
      next_due: nextDue,
    });
  }

  const summary = results.reduce(
    (s, r) => ({
      total_generated: s.total_generated + r.generated,
      total_skipped: s.total_skipped + r.skipped_existing,
      templates_processed: s.templates_processed + 1,
    }),
    { total_generated: 0, total_skipped: 0, templates_processed: 0 }
  );

  // Fire a digest email when new expenses were generated. Fire-and-forget;
  // any failure goes to console rather than blocking the response.
  if (summary.total_generated > 0) {
    const { notifyByPermission } = await import("@/lib/email");
    const lines = results
      .filter((r) => r.generated > 0)
      .map((r) => `• ${r.name}: ${r.generated} new entry/entries (next due ${r.next_due})`)
      .join("\n");
    notifyByPermission({
      permission: "finance:expenses:view",
      kind: "recurring_generated",
      subject: `${summary.total_generated} recurring expense${summary.total_generated === 1 ? "" : "s"} posted`,
      text: `Recurring expense generator ran at ${asOf}.\n\n${lines}\n\nView them in the Expenses module.`,
    }).catch((e) => console.error("[notify] recurring_generated:", e));
  }

  return NextResponse.json({ ok: true, as_of: asOf, summary, results });
}
