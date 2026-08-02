import "server-only";

// Links a company income OR expense entry to an area-manager / technician
// ledger, keeping the two in lock-step.
//
// Sign convention (see finance-ledger.ts): positive = the person owes the
// company; negative = the company owes the person. Both linked flows move the
// balance the SAME way — they increase what the holder owes the company:
//   • income  → office charge (we charge them)   → POSITIVE (they owe us)
//   • expense → advance / payment to them        → POSITIVE (we owe them less)
// The holder settling up (an actual payment they make) is recorded separately
// via the ledger's "Record payment" (they paid us → negative).
//
// Lifecycle for both directions:
//   create → post the mirror ledger entry, linked back to the income/expense
//   edit   → re-sync that entry's amount/date/description in place
//   delete → post a reversing entry (append-only-safe) so the balance corrects

import { coll, FINANCE_COLLECTIONS, newId } from "@/lib/finance-db";
import type { LedgerEntryRecord, LedgerEntryType } from "@/types/finance-ledger";

export type LedgerLinkKind = "income" | "expense";

function entryType(kind: LedgerLinkKind): LedgerEntryType {
  return kind === "income" ? "office_charge" : "payment";
}
function entryDescription(kind: LedgerLinkKind, desc?: string | null): string {
  const base = kind === "income"
    ? "Charge — booked as income"
    : "Paid by company — booked as expense";
  return desc ? `${base}: ${desc}` : base;
}

/** Post the mirror ledger entry for a ledger-linked income/expense.
 *  Returns the new entry's _id (stored back on the income/expense). */
export async function postLinkedLedgerEntry(opts: {
  ledgerId: string;
  kind: LedgerLinkKind;
  refId: string;              // the income/expense _id
  amount: number;
  date: string;
  description?: string | null;
  actor: string;
}): Promise<string> {
  const entry: LedgerEntryRecord = {
    _id: newId("len"),
    ledger_id: opts.ledgerId,
    type: entryType(opts.kind),
    date: opts.date,
    amount: Math.abs(opts.amount), // holder owes the company more
    description: entryDescription(opts.kind, opts.description),
    income_id: opts.kind === "income" ? opts.refId : null,
    expense_id: opts.kind === "expense" ? opts.refId : null,
    reverses_id: null,
    source: "manual",
    created_at: new Date().toISOString(),
    created_by: opts.actor,
  };
  await coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry).insertOne(entry);
  return entry._id;
}

/** Re-sync the linked ledger entry after the source amount/date/desc changed.
 *  In-place update is fine — the entry is system-owned. No-op if it's gone. */
export async function resyncLinkedLedgerEntry(
  entryId: string,
  kind: LedgerLinkKind,
  src: { amount: number; date: string; description?: string | null },
): Promise<void> {
  await coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry).updateOne(
    { _id: entryId },
    {
      $set: {
        amount: Math.abs(src.amount),
        date: src.date,
        description: entryDescription(kind, src.description),
      },
    },
  );
}

/** Post a reversing entry for a deleted ledger-linked income/expense, so the
 *  balance returns to where it was. Append-only-safe + idempotent. */
export async function reverseLinkedLedgerEntry(entryId: string, actor: string): Promise<void> {
  const c = coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry);
  const orig = await c.findOne({ _id: entryId });
  if (!orig) return;
  const already = await c.findOne({ reverses_id: entryId });
  if (already) return;
  const reversal: LedgerEntryRecord = {
    _id: newId("len"),
    ledger_id: orig.ledger_id,
    type: "adjustment",
    date: new Date().toISOString().slice(0, 10),
    amount: -orig.amount, // undo the original movement
    description: "Reversal — linked income/expense deleted",
    reverses_id: entryId,
    income_id: orig.income_id ?? null,
    expense_id: orig.expense_id ?? null,
    source: "manual",
    created_at: new Date().toISOString(),
    created_by: actor,
  };
  await c.insertOne(reversal);
}
