// Confirm a match: writes the match record AND updates the bank txn AND
// flips the matched portal entity's status to "paid" when applicable
// (expense, payout, refund). Settlement / income have no paid flag.

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes, newId } from "@/lib/finance-db";
import type {
  BankTransactionSyncedRecord,
  ReconciliationMatchRecord,
} from "@/types/finance-plaid";

interface Body {
  bank_txn_id: string;
  matched_kind: "expense" | "payout" | "settlement" | "income" | "refund" | "job" | "manual";
  matched_id: string;
  matched_label?: string;
  confidence?: number;
  flip_to_paid?: boolean;  // when true, also marks the portal entity as paid
  notes?: string;
}

export async function POST(req: NextRequest) {
  const session = await requirePermission("finance:banking:reconcile");
  if (session instanceof NextResponse) return session;
  await ensureFinanceIndexes();
  const body = (await req.json()) as Body;
  if (!body.bank_txn_id || !body.matched_kind || !body.matched_id) {
    return NextResponse.json({ error: "bank_txn_id, matched_kind, matched_id required" }, { status: 400 });
  }

  const txnColl = coll<BankTransactionSyncedRecord>(FINANCE_COLLECTIONS.bankTxnSynced);
  const txn = await txnColl.findOne({ _id: body.bank_txn_id });
  if (!txn) return NextResponse.json({ error: "Bank txn not found" }, { status: 404 });

  const now = new Date().toISOString();
  const matchDoc: ReconciliationMatchRecord = {
    _id: newId("match"),
    bank_txn_id: body.bank_txn_id,
    matched_kind: body.matched_kind === "refund" ? "expense" : body.matched_kind, // refund stored as expense kind for reporting consistency
    matched_id: body.matched_id,
    matched_label: body.matched_label,
    amount: Math.abs(txn.amount),
    confidence: body.confidence ?? 1,
    matched_at: now,
    matched_by: session.name,
    notes: body.notes,
  };

  await coll<ReconciliationMatchRecord>(FINANCE_COLLECTIONS.reconMatch).insertOne(matchDoc);
  await txnColl.updateOne(
    { _id: body.bank_txn_id },
    {
      $set: {
        recon_status: "matched",
        matched_kind: body.matched_kind === "refund" ? "expense" : body.matched_kind,
        matched_id: body.matched_id,
        match_confidence: body.confidence ?? 1,
        matched_at: now,
        matched_by: session.name,
        updated_at: now,
      },
    }
  );

  // Optionally flip the matched entity to "paid"
  if (body.flip_to_paid) {
    let target: (typeof FINANCE_COLLECTIONS)[keyof typeof FINANCE_COLLECTIONS] | null = null;
    if (body.matched_kind === "expense") target = FINANCE_COLLECTIONS.expense;
    else if (body.matched_kind === "payout") target = FINANCE_COLLECTIONS.payout;
    else if (body.matched_kind === "refund") target = FINANCE_COLLECTIONS.refund;
    if (target) {
      await coll(target).updateOne(
        { _id: body.matched_id },
        { $set: { status: "paid", paid_at: now, paid_by: session.name } }
      );
    }
  }

  return NextResponse.json({ ok: true, match: matchDoc });
}

export async function DELETE(req: NextRequest) {
  const session = await requirePermission("finance:banking:reconcile");
  if (session instanceof NextResponse) return session;
  await ensureFinanceIndexes();
  const id = req.nextUrl.searchParams.get("bank_txn_id");
  if (!id) return NextResponse.json({ error: "bank_txn_id required" }, { status: 400 });

  const txnColl = coll<BankTransactionSyncedRecord>(FINANCE_COLLECTIONS.bankTxnSynced);
  await coll<ReconciliationMatchRecord>(FINANCE_COLLECTIONS.reconMatch).deleteMany({ bank_txn_id: id });
  await txnColl.updateOne(
    { _id: id },
    {
      $set: {
        recon_status: "unmatched",
        matched_kind: undefined,
        matched_id: undefined,
        match_confidence: undefined,
        matched_at: undefined,
        matched_by: undefined,
        updated_at: new Date().toISOString(),
      },
    }
  );
  return NextResponse.json({ ok: true });
}
