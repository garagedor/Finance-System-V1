import "server-only";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS, newId } from "@/lib/finance-db";
import type { PayoutRecord } from "@/types/finance";
import type { LedgerEntryRecord } from "@/types/finance-ledger";

// Reconcile a payout's auto-posted ledger payment with its current state.
// One payment entry per payout (keyed on payout_id). It exists exactly when the
// payout is PAID, has a chosen ledger, and a positive net; otherwise it's removed.
//
// Sign: paying someone out is "we paid them" → a POSITIVE movement (matches the
// Record-payment convention: positive = they owe the company more / we owe less).
// The entry is source:"crm" so it's system-owned and can't be hand-edited on the
// ledger (which would desync it from the payout).
//
// Idempotent: safe to call after every create / edit / mark-paid / mark-unpaid.
// It also stamps `ledger_entry_id` back onto the payout.
export async function syncPayoutLedger(payout: PayoutRecord, actor: string): Promise<string | null> {
  await ensureFinanceIndexes();
  const ec = coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry);
  const pc = coll<PayoutRecord>(FINANCE_COLLECTIONS.payout);

  const net = Number(payout.net) || 0;
  const shouldPost = payout.status === "paid" && !!payout.ledger_id && net > 0;
  // Only manage the entry WE auto-posted (source "crm"), never a manual
  // "Record payment" a user matched to this payout (source "manual").
  const existing = await ec.findOne({ payout_id: payout._id, source: "crm" });

  if (!shouldPost) {
    if (existing) await ec.deleteOne({ _id: existing._id });
    if (payout.ledger_entry_id) await pc.updateOne({ _id: payout._id }, { $set: { ledger_entry_id: null } });
    return null;
  }

  const date = (payout.paid_at ? String(payout.paid_at) : payout.period_end).slice(0, 10);
  const description = `Payout · ${payout.recipient_name} · ${payout.period_start} → ${payout.period_end}`;
  const fields = {
    ledger_id: payout.ledger_id as string,
    type: "payment" as const,
    date,
    amount: Math.round(net * 100) / 100, // positive = we paid them
    description,
    payout_id: payout._id,
    source: "crm" as const,
  };

  let entryId: string;
  if (existing) {
    entryId = existing._id;
    await ec.updateOne({ _id: existing._id }, { $set: fields });
  } else {
    entryId = newId("len");
    await ec.insertOne({ _id: entryId, ...fields, reverses_id: null, created_at: new Date().toISOString(), created_by: actor });
  }
  await pc.updateOne({ _id: payout._id }, { $set: { ledger_entry_id: entryId } });
  return entryId;
}

/** Remove a payout's auto-posted ledger entry (used on payout delete). Only the
 *  system-owned "crm" entry — leaves any manual matched payment intact. */
export async function removePayoutLedger(payoutId: string): Promise<void> {
  await ensureFinanceIndexes();
  await coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry).deleteMany({ payout_id: payoutId, source: "crm" });
}
