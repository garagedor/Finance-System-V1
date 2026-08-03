// Manage a category centrally within a group: rename it (updates every
// transaction in the group that uses it) and/or set its chip color.
//
// PATCH { group_id, from, to?, color? }

import { NextRequest, NextResponse } from "next/server";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { readPortalSession } from "@/lib/portal-auth";
import type { ExpenseGroupRecord } from "@/types/finance";
import type { BankTransactionSyncedRecord } from "@/types/finance-plaid";

const HEX = /^#[0-9a-fA-F]{6}$/;

export async function PATCH(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await ensureFinanceIndexes();
    const body = (await req.json()) as { group_id?: string; from?: string; to?: string; color?: string };
    const groupId = String(body.group_id ?? "").trim();
    const from = String(body.from ?? "").trim();
    if (!groupId || !from) return NextResponse.json({ error: "group_id and from required" }, { status: 400 });

    const gColl = coll<ExpenseGroupRecord>(FINANCE_COLLECTIONS.expenseGroup);
    const group = await gColl.findOne({ _id: groupId });
    if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });

    const to = body.to !== undefined ? String(body.to).trim() : from;
    if (!to) return NextResponse.json({ error: "New name cannot be empty" }, { status: 400 });
    const color = body.color && HEX.test(body.color) ? body.color : undefined;
    const rename = to !== from;

    // Bulk-rename the category on every transaction in this group that uses it.
    // The "other" bucket in the breakdown also covers empty/missing categories,
    // so renaming it should catch those too.
    let renamed = 0;
    if (rename) {
      const match =
        from.toLowerCase() === "other"
          ? {
              group_id: groupId,
              $or: [
                { group_category: from },
                { group_category: { $in: [null, ""] } },
                { group_category: { $exists: false } },
              ],
            }
          : { group_id: groupId, group_category: from };
      const r = await coll<BankTransactionSyncedRecord>(FINANCE_COLLECTIONS.bankTxnSynced).updateMany(
        match as never,
        { $set: { group_category: to, updated_at: new Date().toISOString() } },
      );
      renamed = r.modifiedCount ?? 0;
    }

    // Carry / set the custom color, keyed by lowercased name.
    const colors: Record<string, string> = { ...(group.category_colors ?? {}) };
    const fromKey = from.toLowerCase();
    const toKey = to.toLowerCase();
    if (rename && fromKey !== toKey && colors[fromKey] !== undefined) {
      colors[toKey] = colors[fromKey];
      delete colors[fromKey];
    }
    if (color) colors[toKey] = color;

    await gColl.updateOne(
      { _id: groupId },
      { $set: { category_colors: colors, updated_at: new Date().toISOString(), updated_by: session.name } },
    );

    return NextResponse.json({ ok: true, renamed });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Update failed" }, { status: 400 });
  }
}
