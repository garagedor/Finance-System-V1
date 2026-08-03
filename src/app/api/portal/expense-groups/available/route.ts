// Bank transactions not yet in any group — the source list for the "add
// transactions" picker. Read-only, searchable by text + date window.

import { NextRequest, NextResponse } from "next/server";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { readPortalSession } from "@/lib/portal-auth";
import type { BankTransactionSyncedRecord } from "@/types/finance-plaid";
import type { Filter } from "mongodb";

export async function GET(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureFinanceIndexes();

  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim();
  const from = sp.get("from");
  const to = sp.get("to");
  const dir = sp.get("direction"); // "out" | "in"
  const limit = Math.min(Number(sp.get("limit") ?? 100), 300);

  const filter: Filter<BankTransactionSyncedRecord> = { group_id: { $exists: false } };
  if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  if (dir === "out" || dir === "in") filter.direction = dir;
  if (q) {
    filter.$or = [
      { description: { $regex: q, $options: "i" } },
      { merchant_name: { $regex: q, $options: "i" } },
    ];
  }

  const rows = await coll<BankTransactionSyncedRecord>(FINANCE_COLLECTIONS.bankTxnSynced)
    .find(filter)
    .sort({ date: -1, _id: -1 })
    .limit(limit)
    .toArray();

  const slim = rows.map((r) => ({
    _id: r._id,
    date: r.date,
    description: r.description,
    merchant_name: r.merchant_name ?? null,
    amount: r.amount,
    category: r.category ?? null,
    account: r.institution_name ?? null,
  }));
  return NextResponse.json({ rows: slim });
}
