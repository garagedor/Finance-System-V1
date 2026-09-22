import "server-only";

// Item source for the CUSTOM itemized report. Every category resolves to the
// same normalized shape ({ id, date, primary, secondary, amount }) with an
// authoritative, server-computed `amount`, so the builder can cherry-pick
// specific rows across categories and combine them into one grouped report.

import { getDb, coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { calcPaidSum, calcParts, calcJobProfit, calcTotalAfterFee, calcStandardShare, toNumber } from "@/app/api/utils/calculations";
import { ensureJobMirrorsFresh } from "@/lib/job-mirror";
import type { JobRow } from "@/types/job";
import type { LedgerEntryRecord } from "@/types/finance-ledger";
import type { PayoutRecord, ExpenseRecord, ManualIncomeRecord } from "@/types/finance";
import type { ScanpayDisputeRecord } from "@/types/scanpay";

export const CUSTOM_ITEM_TYPES = ["ledgerLine", "providerJob", "payout", "penalty", "disputeRefund", "expense", "income"] as const;
export type CustomItemType = (typeof CUSTOM_ITEM_TYPES)[number];

export const CUSTOM_ITEM_LABELS: Record<CustomItemType, string> = {
  ledgerLine: "Ledger lines",
  providerJob: "Provider jobs",
  payout: "Payouts",
  penalty: "Penalties",
  disputeRefund: "Disputes & Refunds",
  expense: "Expenses",
  income: "Income",
};

export interface CustomItem {
  id: string;
  date: string;
  primary: string;   // main label (address / recipient / vendor / description / holder line)
  secondary: string; // sub label (tech · provider / category · status / entry type)
  amount: number;    // authoritative money figure for this row
}

export interface CustomItemList {
  type: CustomItemType;
  amountLabel: string;  // header for the amount column (e.g. "AM 50%", "Net")
  items: CustomItem[];
  truncated: boolean;
}

export interface ListCustomItemsParams {
  type: CustomItemType;
  from: string;
  to: string;
  ledgerId?: string;
  providers?: string[];
  techs?: string[];
  locations?: string[];
  limit?: number;
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const s = (v: unknown) => (v == null ? "" : String(v));

export async function listCustomItems(p: ListCustomItemsParams): Promise<CustomItemList> {
  await ensureFinanceIndexes();
  const db = await getDb();
  const { from, to } = p;
  const cap = Math.min(p.limit ?? 500, 1000);

  if (p.type === "ledgerLine") {
    if (!p.ledgerId) return { type: p.type, amountLabel: "Amount", items: [], truncated: false };
    const rows = await coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry)
      .find({ ledger_id: p.ledgerId, date: { $gte: from, $lte: to } })
      .sort({ date: 1, _id: 1 }).limit(cap + 1).toArray();
    const truncated = rows.length > cap;
    return {
      type: p.type, amountLabel: "Amount", truncated,
      items: rows.slice(0, cap).map((e) => ({ id: e._id, date: e.date, primary: e.description ?? String(e.type), secondary: String(e.type), amount: round2(e.amount) })),
    };
  }

  if (p.type === "providerJob") {
    await ensureJobMirrorsFresh().catch(() => {});
    const match: Record<string, unknown> = { statusCanonical: { $in: ["Closed", "X close"] }, date: { $gte: from, $lte: to } };
    if (p.providers?.length) match.provider = { $in: p.providers };
    if (p.techs?.length) match.tech = { $in: p.techs };
    if (p.locations?.length) match.location = { $in: p.locations };
    const jobs = await db.collection<JobRow>("Job").find(match as never).limit(cap + 1).toArray();
    const provDocs = await db.collection("Provider").find(p.providers?.length ? { _id: { $in: p.providers } } as never : {}).toArray();
    const pct = new Map<string, number>();
    provDocs.forEach((d) => pct.set(s((d as { _id?: unknown })._id), toNumber((d as { profitPercent?: unknown }).profitPercent)));
    const truncated = jobs.length > cap;
    return {
      type: p.type, amountLabel: "Provider share", truncated,
      items: jobs.slice(0, cap).map((j) => {
        const share = calcStandardShare(calcJobProfit(calcTotalAfterFee(j), calcParts(j)), pct.get(s(j.provider)) ?? 0);
        return { id: s((j as { _id?: unknown })._id), date: s(j.date).slice(0, 10), primary: s(j.address) || s((j as { _id?: unknown })._id), secondary: `${s(j.provider)}${j.tech ? ` · ${s(j.tech)}` : ""}`, amount: round2(share) };
      }),
    };
  }

  if (p.type === "payout") {
    const rows = await coll<PayoutRecord>(FINANCE_COLLECTIONS.payout)
      .find({ period_end: { $gte: from, $lte: to } }).sort({ period_end: -1 }).limit(cap + 1).toArray();
    const truncated = rows.length > cap;
    return {
      type: p.type, amountLabel: "Net", truncated,
      items: rows.slice(0, cap).map((r) => ({ id: r._id, date: r.period_end, primary: r.recipient_name || "—", secondary: `${r.recipient_role || ""}${r.status ? ` · ${r.status}` : ""}`.trim(), amount: round2(r.net) })),
    };
  }

  if (p.type === "penalty") {
    await ensureJobMirrorsFresh().catch(() => {});
    const match: Record<string, unknown> = { statusCanonical: "X close", date: { $gte: from, $lte: to } };
    if (p.providers?.length) match.provider = { $in: p.providers };
    if (p.techs?.length) match.tech = { $in: p.techs };
    if (p.locations?.length) match.location = { $in: p.locations };
    const jobs = await db.collection<JobRow>("Job").find(match as never).limit(cap + 1).toArray();
    const provDocs = await db.collection("Provider").find({}).toArray();
    const pct = new Map<string, number>();
    provDocs.forEach((d) => pct.set(s((d as { _id?: unknown })._id), toNumber((d as { profitPercent?: unknown }).profitPercent)));
    const truncated = jobs.length > cap;
    return {
      type: p.type, amountLabel: "AM 50%", truncated,
      items: jobs.slice(0, cap).map((j) => {
        const totalLoss = calcStandardShare(calcJobProfit(calcPaidSum(j), calcParts(j)), pct.get(s(j.provider)) ?? 0);
        return { id: s((j as { _id?: unknown })._id), date: s(j.date).slice(0, 10), primary: s(j.address) || s((j as { _id?: unknown })._id), secondary: `${s(j.tech)}${j.provider ? ` · ${s(j.provider)}` : ""}`, amount: round2(totalLoss * 0.5) };
      }),
    };
  }

  if (p.type === "disputeRefund") {
    const [disputes, refunds] = await Promise.all([
      coll<ScanpayDisputeRecord>(FINANCE_COLLECTIONS.scanpayDispute).find({ matchStatus: { $in: ["verified", "posted"] } } as never).sort({ disputedAt: -1 }).limit(cap).toArray(),
      coll(FINANCE_COLLECTIONS.scanpayRefund).find({ matchStatus: { $in: ["verified", "posted"] } } as never).sort({ paymentDate: -1 }).limit(cap).toArray(),
    ]);
    const items: CustomItem[] = [];
    for (const r of disputes) {
      const d = (r.disputedAt || "").slice(0, 10);
      if (!d || d < from || d > to) continue;
      items.push({ id: `dispute:${r._id}`, date: d, primary: r.customerName || r.invoiceNumber || r.serviceAddress || "—", secondary: `Dispute${r.reason ? ` · ${r.reason}` : ""}`, amount: round2(r.amount || 0) });
    }
    for (const rr of refunds) {
      const r = rr as unknown as Record<string, unknown>;
      const d = (String(r.refundDate ?? r.paymentDate ?? "")).slice(0, 10);
      if (!d || d < from || d > to) continue;
      items.push({ id: `refund:${String(r._id)}`, date: d, primary: String(r.customerName ?? r.invoiceNumber ?? "—"), secondary: `Refund${r.reason ? ` · ${String(r.reason)}` : ""}`, amount: round2(Number(r.refundAmount ?? r.originalAmount ?? 0)) });
    }
    items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return { type: p.type, amountLabel: "Amount", items: items.slice(0, cap), truncated: items.length > cap };
  }

  if (p.type === "expense") {
    const rows = await coll<ExpenseRecord>(FINANCE_COLLECTIONS.expense)
      .find({ date: { $gte: from, $lte: to } }).sort({ date: -1 }).limit(cap + 1).toArray();
    const truncated = rows.length > cap;
    return {
      type: p.type, amountLabel: "Amount", truncated,
      items: rows.slice(0, cap).map((r) => ({ id: r._id, date: r.date, primary: r.vendor_name || r.description || r.category, secondary: `${r.category}${r.status ? ` · ${r.status}` : ""}`, amount: round2(r.amount) })),
    };
  }

  // income
  const rows = await coll<ManualIncomeRecord>(FINANCE_COLLECTIONS.income)
    .find({ date: { $gte: from, $lte: to } }).sort({ date: -1 }).limit(cap + 1).toArray();
  const truncated = rows.length > cap;
  return {
    type: "income", amountLabel: "Amount", truncated,
    items: rows.slice(0, cap).map((r) => ({ id: r._id, date: r.date, primary: r.description || r.source, secondary: r.source, amount: round2(r.amount) })),
  };
}
