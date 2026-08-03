// Assign / categorize / remove bank transactions within an expense group.
// Tags the synced bank txn in place (group_id + group_category) — same
// write-back pattern as reconciliation. A txn belongs to at most one group.

import { NextRequest, NextResponse } from "next/server";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { readPortalSession } from "@/lib/portal-auth";
import type { ExpenseGroupRecord } from "@/types/finance";
import type { BankTransactionSyncedRecord } from "@/types/finance-plaid";

// POST { group_id, txn_ids: string[] } — add transactions to a group. Each txn's
// group_category defaults to its Plaid category (or "other").
export async function POST(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await ensureFinanceIndexes();
    const body = (await req.json()) as { group_id?: string; txn_ids?: string[] };
    const groupId = String(body.group_id ?? "").trim();
    const ids = Array.isArray(body.txn_ids) ? body.txn_ids.map(String) : [];
    if (!groupId || ids.length === 0) {
      return NextResponse.json({ error: "group_id and txn_ids required" }, { status: 400 });
    }
    const group = await coll<ExpenseGroupRecord>(FINANCE_COLLECTIONS.expenseGroup).findOne({ _id: groupId });
    if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });

    const txnColl = coll<BankTransactionSyncedRecord>(FINANCE_COLLECTIONS.bankTxnSynced);
    const now = new Date().toISOString();
    let assigned = 0;
    for (const id of ids) {
      const t = await txnColl.findOne({ _id: id });
      if (!t) continue;
      await txnColl.updateOne(
        { _id: id },
        { $set: { group_id: groupId, group_category: t.group_category ?? t.category ?? "other", updated_at: now } },
      );
      assigned++;
    }
    return NextResponse.json({ ok: true, assigned });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Assign failed" }, { status: 400 });
  }
}

// PATCH { txn_id, category } — set a transaction's category within its group.
export async function PATCH(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await ensureFinanceIndexes();
    const body = (await req.json()) as { txn_id?: string; category?: string };
    const id = String(body.txn_id ?? "").trim();
    if (!id) return NextResponse.json({ error: "txn_id required" }, { status: 400 });
    const category = String(body.category ?? "").trim() || "other";
    const r = await coll<BankTransactionSyncedRecord>(FINANCE_COLLECTIONS.bankTxnSynced).updateOne(
      { _id: id },
      { $set: { group_category: category, updated_at: new Date().toISOString() } },
    );
    if (r.matchedCount === 0) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Update failed" }, { status: 400 });
  }
}

// DELETE ?txn_id=  — remove a transaction from its group.
export async function DELETE(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureFinanceIndexes();
  const id = req.nextUrl.searchParams.get("txn_id");
  if (!id) return NextResponse.json({ error: "txn_id required" }, { status: 400 });
  await coll<BankTransactionSyncedRecord>(FINANCE_COLLECTIONS.bankTxnSynced).updateOne(
    { _id: id },
    { $unset: { group_id: "", group_category: "" }, $set: { updated_at: new Date().toISOString() } },
  );
  return NextResponse.json({ ok: true });
}
