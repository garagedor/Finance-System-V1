// Recent bank OUTFLOWS (real money that left the account, from Plaid) that a
// ledger payment can be matched to. Flags ones already linked to a ledger entry.

import { NextRequest, NextResponse } from "next/server";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { readPortalSession } from "@/lib/portal-auth";
import type { Filter } from "mongodb";
import type {
  BankAccountSyncedRecord,
  BankTransactionSyncedRecord,
} from "@/types/finance-plaid";
import type { LedgerEntryRecord } from "@/types/finance-ledger";

export async function GET(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await ensureFinanceIndexes();
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim();
  const limit = Math.min(Number(sp.get("limit") ?? 40), 200);

  // Outflows only (money out = negative amount).
  const filter: Filter<BankTransactionSyncedRecord> = { amount: { $lt: 0 } };
  if (q) {
    filter.$or = [
      { description: { $regex: q, $options: "i" } },
      { merchant_name: { $regex: q, $options: "i" } },
    ];
  }

  const [txns, accounts] = await Promise.all([
    coll<BankTransactionSyncedRecord>(FINANCE_COLLECTIONS.bankTxnSynced)
      .find(filter)
      .sort({ date: -1, _id: -1 })
      .limit(limit)
      .toArray(),
    coll<BankAccountSyncedRecord>(FINANCE_COLLECTIONS.bankAccountSynced).find({}).toArray(),
  ]);

  const acctById = new Map(accounts.map((a) => [a.account_id, a]));
  const txnIds = txns.map((t) => t._id);
  // Which of these are already linked to a ledger entry?
  const linkedRows = txnIds.length
    ? await coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry)
        .find({ bank_txn_id: { $in: txnIds } })
        .project({ bank_txn_id: 1, ledger_id: 1 })
        .toArray()
    : [];
  const linkedSet = new Set(linkedRows.map((r) => (r as { bank_txn_id?: string }).bank_txn_id));

  const rows = txns.map((t) => {
    const acct = acctById.get(t.account_id);
    return {
      _id: t._id,
      date: t.date,
      description: t.description,
      merchant_name: t.merchant_name ?? null,
      amount: Math.abs(t.amount), // present as a positive "paid" figure
      account_label: acct ? `${acct.name}${acct.mask ? ` ··${acct.mask}` : ""}` : "—",
      linked: linkedSet.has(t._id),
    };
  });

  return NextResponse.json({ rows });
}
