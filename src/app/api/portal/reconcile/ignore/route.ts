import { NextRequest, NextResponse } from "next/server";
import { readPortalSession } from "@/lib/portal-auth";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import type { BankTransactionSyncedRecord } from "@/types/finance-plaid";

export async function POST(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.type !== "admin" && session.type !== "bookkeeper") {
    return NextResponse.json({ error: "Restricted" }, { status: 403 });
  }
  await ensureFinanceIndexes();
  const body = (await req.json()) as { bank_txn_id?: string; reason?: string };
  if (!body.bank_txn_id) {
    return NextResponse.json({ error: "bank_txn_id required" }, { status: 400 });
  }
  const now = new Date().toISOString();
  await coll<BankTransactionSyncedRecord>(FINANCE_COLLECTIONS.bankTxnSynced).updateOne(
    { _id: body.bank_txn_id },
    {
      $set: {
        recon_status: "ignored",
        ignore_reason: body.reason ?? "(no reason)",
        ignored_at: now,
        ignored_by: session.name,
        updated_at: now,
      },
    }
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  // Un-ignore — flip back to unmatched
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureFinanceIndexes();
  const id = req.nextUrl.searchParams.get("bank_txn_id");
  if (!id) return NextResponse.json({ error: "bank_txn_id required" }, { status: 400 });
  await coll<BankTransactionSyncedRecord>(FINANCE_COLLECTIONS.bankTxnSynced).updateOne(
    { _id: id },
    {
      $set: {
        recon_status: "unmatched",
        ignore_reason: undefined,
        ignored_at: undefined,
        ignored_by: undefined,
        updated_at: new Date().toISOString(),
      },
    }
  );
  return NextResponse.json({ ok: true });
}
