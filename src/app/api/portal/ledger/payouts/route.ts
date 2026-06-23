// Portal payouts (finance_payout) that a ledger payment can be matched to.
// Flags ones already linked to a ledger entry.

import { NextRequest, NextResponse } from "next/server";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { readPortalSession } from "@/lib/portal-auth";
import type { Filter } from "mongodb";
import type { PayoutRecord } from "@/types/finance";
import type { LedgerEntryRecord } from "@/types/finance-ledger";

export async function GET(req: NextRequest) {
  const session = await readPortalSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await ensureFinanceIndexes();
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim();
  const limit = Math.min(Number(sp.get("limit") ?? 40), 200);

  const filter: Filter<PayoutRecord> = {};
  if (q) filter.recipient_name = { $regex: q, $options: "i" };

  const payouts = await coll<PayoutRecord>(FINANCE_COLLECTIONS.payout)
    .find(filter)
    .sort({ period_end: -1, _id: -1 })
    .limit(limit)
    .toArray();

  const ids = payouts.map((p) => p._id);
  const linkedRows = ids.length
    ? await coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry)
        .find({ payout_id: { $in: ids } })
        .project({ payout_id: 1 })
        .toArray()
    : [];
  const linkedSet = new Set(linkedRows.map((r) => (r as { payout_id?: string }).payout_id));

  const rows = payouts.map((p) => ({
    _id: p._id,
    recipient_name: p.recipient_name,
    recipient_role: p.recipient_role ?? null,
    period_start: p.period_start,
    period_end: p.period_end,
    net: p.net,
    status: p.status,
    linked: linkedSet.has(p._id),
  }));

  return NextResponse.json({ rows });
}
