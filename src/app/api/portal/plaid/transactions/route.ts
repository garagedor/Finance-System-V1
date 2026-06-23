// List synced bank transactions with filters.

import { NextRequest, NextResponse } from "next/server";
import { readPortalSession } from "@/lib/portal-auth";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "@/lib/finance-db";
import type { BankTransactionSyncedRecord } from "@/types/finance-plaid";
import type { Filter } from "mongodb";

export async function GET(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureFinanceIndexes();
  const sp = req.nextUrl.searchParams;
  const filter: Filter<BankTransactionSyncedRecord> = {};

  const from = sp.get("from");
  const to = sp.get("to");
  if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };

  const account = sp.get("account_id");
  if (account) filter.account_id = account;

  const direction = sp.get("direction");
  if (direction === "in" || direction === "out") filter.direction = direction;

  const recon = sp.get("recon");
  if (recon === "unmatched" || recon === "matched" || recon === "ignored" || recon === "pending_review") {
    filter.recon_status = recon;
  }

  const pending = sp.get("pending");
  if (pending === "1") filter.pending = true;
  if (pending === "0") filter.pending = false;

  const q = sp.get("q");
  if (q) filter.$or = [
    { description: { $regex: q, $options: "i" } },
    { merchant_name: { $regex: q, $options: "i" } },
    { raw_name: { $regex: q, $options: "i" } },
  ];

  const minAmt = sp.get("min_amount");
  const maxAmt = sp.get("max_amount");
  if (minAmt || maxAmt) {
    filter.amount = {
      ...(minAmt ? { $gte: parseFloat(minAmt) } : {}),
      ...(maxAmt ? { $lte: parseFloat(maxAmt) } : {}),
    };
  }

  const limit = Math.min(Number(sp.get("limit") ?? 200), 1000);
  const skip = Math.max(Number(sp.get("skip") ?? 0), 0);

  const c = coll<BankTransactionSyncedRecord>(FINANCE_COLLECTIONS.bankTxnSynced);
  const [rows, total] = await Promise.all([
    c.find(filter).sort({ date: -1, _id: -1 }).skip(skip).limit(limit).toArray(),
    c.countDocuments(filter),
  ]);
  return NextResponse.json({ rows, total, limit, skip });
}
