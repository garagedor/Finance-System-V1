import { NextRequest, NextResponse } from "next/server";
import { makeCrud } from "../crud-helper";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { readPortalSession } from "@/lib/portal-auth";
import type { ExpenseGroupRecord } from "@/types/finance";
import type { BankTransactionSyncedRecord } from "@/types/finance-plaid";

const crud = makeCrud<ExpenseGroupRecord>({
  collection: "expenseGroup",
  idPrefix: "grp",
  sort: { created_at: -1 },
  normalize: (body, mode) => {
    const name = String(body.name ?? "").trim();
    if (mode === "create" && !name) throw new Error("Name is required");
    const out: Record<string, unknown> = {};
    if (mode === "create" || body.name !== undefined) out.name = name;
    if (body.note !== undefined) out.note = body.note ? String(body.note) : null;
    if (mode === "create" || body.status !== undefined) out.status = body.status === "closed" ? "closed" : "open";
    return out;
  },
});

export const GET = crud.GET;
export const POST = crud.POST;
export const PUT = crud.PUT;

// Deleting a group detaches its transactions (clears group_id/group_category)
// so no bank txn is left pointing at a group that no longer exists.
export async function DELETE(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureFinanceIndexes();
  const id = req.nextUrl.searchParams.get("_id");
  if (!id) return NextResponse.json({ error: "_id required" }, { status: 400 });

  await coll<BankTransactionSyncedRecord>(FINANCE_COLLECTIONS.bankTxnSynced).updateMany(
    { group_id: id },
    { $unset: { group_id: "", group_category: "" }, $set: { updated_at: new Date().toISOString() } },
  );
  const r = await coll<ExpenseGroupRecord>(FINANCE_COLLECTIONS.expenseGroup).deleteOne({ _id: id });
  return NextResponse.json({ deletedCount: r.deletedCount });
}
