// Generates due income rows from active recurring income templates.
//
// Idempotent: each (recurring_id, date) pair creates at most one income entry.
// If an income entry already exists for that template+date, we skip.
//
// Trigger: POST /api/portal/recurring-income/generate
//          POST /api/portal/recurring-income/generate?_id=rincome_xxx  (one only)
//          POST /api/portal/recurring-income/generate?asOf=YYYY-MM-DD (override "today")

import { NextRequest, NextResponse } from "next/server";
import { readPortalSession } from "@/lib/portal-auth";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes, newId } from "@/lib/finance-db";
import type { ManualIncomeRecord, RecurringIncomeRecord } from "@/types/finance";
import { dueDatesUpTo, nextDueAfter } from "@/lib/recurring-schedule";

export async function POST(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureFinanceIndexes();

  const sp = req.nextUrl.searchParams;
  const oneId = sp.get("_id");
  const asOf = sp.get("asOf") ?? new Date().toISOString().slice(0, 10);

  const tColl = coll<RecurringIncomeRecord>(FINANCE_COLLECTIONS.recurringIncome);
  const iColl = coll<ManualIncomeRecord>(FINANCE_COLLECTIONS.income);

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

    for (const due of dueDates) {
      // Idempotency: skip if an income entry already exists for (template, date).
      const existing = await iColl.findOne({ recurring_id: t._id, date: due });
      if (existing) { skipped++; continue; }
      const inc: ManualIncomeRecord = {
        _id: newId("inc"),
        source: t.source,
        amount: t.amount,
        date: due,
        description: t.description || t.name,
        category: t.category,
        payment_method: t.payment_method,
        related_area: t.related_area,
        related_person_id: t.related_person_id,
        notes: t.notes ? `${t.notes}\n[Auto-generated from recurring "${t.name}"]` : `[Auto-generated from recurring "${t.name}"]`,
        recurring_id: t._id,
        created_at: new Date().toISOString(),
        created_by: `recurring:${session.name}`,
      };
      await iColl.insertOne(inc);
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

  // Fire a digest email when new income was generated. Fire-and-forget.
  if (summary.total_generated > 0) {
    const { notifyByPermission } = await import("@/lib/email");
    const lines = results
      .filter((r) => r.generated > 0)
      .map((r) => `• ${r.name}: ${r.generated} new entry/entries (next due ${r.next_due})`)
      .join("\n");
    notifyByPermission({
      permission: "finance:income:view",
      kind: "recurring_generated",
      subject: `${summary.total_generated} recurring income entr${summary.total_generated === 1 ? "y" : "ies"} posted`,
      text: `Recurring income generator ran at ${asOf}.\n\n${lines}\n\nView them in the Income module.`,
    }).catch((e) => console.error("[notify] recurring_income_generated:", e));
  }

  return NextResponse.json({ ok: true, as_of: asOf, summary, results });
}
