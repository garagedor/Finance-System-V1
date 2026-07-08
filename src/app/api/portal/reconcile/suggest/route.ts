import { NextRequest, NextResponse } from "next/server";
import { readPortalSession } from "@/lib/portal-auth";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import { suggestMatchesForTxn } from "@/lib/portal-reconcile";
import type { BankTransactionSyncedRecord } from "@/types/finance-plaid";

export async function GET(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureFinanceIndexes();
  const id = req.nextUrl.searchParams.get("bank_txn_id");
  if (!id) return NextResponse.json({ error: "bank_txn_id required" }, { status: 400 });
  const txn = await coll<BankTransactionSyncedRecord>(FINANCE_COLLECTIONS.bankTxnSynced)
    .findOne({ _id: id });
  if (!txn) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const suggestions = await suggestMatchesForTxn(txn);
  return NextResponse.json({ txn, suggestions });
}
