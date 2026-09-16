// Accountant-facing "full financial picture" report builder.
//
// ONE server-side gatherer that both the on-screen page
// (/api/portal/finance-report) and the PDF (/api/finance-report/pdf) call, so
// the numbers can never disagree between screen and print.
//
// It reuses the dashboard's authoritative P&L (`fetchDashboardData`, keyed by
// date range) for revenue / profit / expenses / dispute + refund impact, and
// adds a LEDGERS section: per-ledger opening → movement → closing balance for
// the period PLUS the current outstanding balance (what to settle now), with a
// by-type composition. Ledgers can be scoped by role / location / holder.
//
// Sign convention (matches the ledgers everywhere): a POSITIVE balance means the
// holder/location owes the company; NEGATIVE means the company owes them.

import type { Filter } from "mongodb";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "./finance-db";
import { fetchDashboardData } from "./portal-data";
import type { LedgerRecord, LedgerEntryRecord } from "@/types/finance-ledger";

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// The sections a report can contain, in a stable canonical order. The UI lets
// the user toggle + reorder them; unknown keys are ignored by the renderers.
export const SECTION_KEYS = ["pnl", "income", "expenses", "disputes", "byLocation", "ledgers"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const SECTION_LABELS: Record<SectionKey, string> = {
  pnl: "P&L Summary",
  income: "Income breakdown",
  expenses: "Expenses breakdown",
  disputes: "Disputes & Refunds impact",
  byLocation: "Revenue by location",
  ledgers: "Ledgers — balances to settle",
};

export interface LedgerBreakdown {
  id: string;
  holderName: string;
  role: string;
  location: string;
  label: string | null;
  opening: number;    // Σ entries dated BEFORE the period start
  movement: number;   // Σ entries dated within the period
  closing: number;    // opening + movement (Σ entries dated on/before period end)
  current: number;    // Σ ALL entries — the live outstanding balance to settle
  entryCount: number; // entries within the period
  lastActivity: string | null;
  byType: Array<{ type: string; total: number; count: number }>; // period movement, signed
}

export interface FinancialReportOptions {
  from: string;
  to: string;
  roles?: string[];
  locations?: string[];
  holders?: string[];
  includeArchived?: boolean;
}

export interface FinancialReportData {
  meta: {
    from: string;
    to: string;
    generatedAt: string;
    filters: { roles: string[]; locations: string[]; holders: string[] };
  };
  pnl: {
    totalRevenue: number;
    jobRevenue: number;
    manualIncome: number;
    grossProfit: number;
    totalExpenses: number;
    unpaidExpenses: number;
    payouts: number;          // derived: grossProfit − expenses − netProfit
    netProfit: number;
    netAfterDisputes: number;
    disputeFiledLoss: number;
    disputeRecoveredSlice: number;
    disputeImpact: number;
    refundLoss: number;
    jobCount: number;
    cashOnHand: number;
    outstandingPayables: number;
    outstandingReceivables: number;
  };
  income: Array<{ source: string; total: number }>;
  expenses: Array<{ category: string; total: number; count: number }>;
  disputes: {
    disputeCount: number;
    disputeTotalAmount: number;
    disputeWonAmount: number;
    disputeLostAmount: number;
    filedLoss: number;
    recoveredSlice: number;
    impact: number;
    refundLoss: number;
  };
  byLocation: Array<{ area: string; total: number; count: number }>;
  ledgers: {
    rows: LedgerBreakdown[];
    totalOwedToCompany: number; // Σ positive current balances
    totalCompanyOwes: number;   // Σ |negative current balances|
    netPosition: number;        // Σ current balances (signed)
  };
}

export async function buildFinancialReport(opts: FinancialReportOptions): Promise<FinancialReportData> {
  await ensureFinanceIndexes();
  const from = opts.from;
  const to = opts.to;
  const range = { from, to };

  // 1) Business P&L / income / expenses / dispute impact — the dashboard engine.
  const dash = await fetchDashboardData(range);
  const payouts = round2(dash.grossProfit - dash.totalExpenses - dash.netProfit);

  // 2) Ledgers section — scoped by role / location / holder.
  const lf: Filter<LedgerRecord> = {};
  if (!opts.includeArchived) lf.status = "active";
  if (opts.roles?.length) lf.role = { $in: opts.roles };
  if (opts.locations?.length) lf.location = { $in: opts.locations };
  if (opts.holders?.length) lf.holder_name = { $in: opts.holders };

  const ledgerDocs = await coll<LedgerRecord>(FINANCE_COLLECTIONS.ledger)
    .find(lf)
    .sort({ holder_name: 1 })
    .toArray();
  const ids = ledgerDocs.map((l) => l._id);

  const ledgerRows: LedgerBreakdown[] = [];
  if (ids.length) {
    const entryColl = coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry);
    // Opening / movement / closing / current per ledger (string date compare is
    // valid for ISO YYYY-MM-DD dates), + last activity + in-period entry count.
    const balAgg = await entryColl
      .aggregate<{
        _id: string; current: number; opening: number; movement: number;
        closing: number; count: number; lastActivity: string | null;
      }>([
        { $match: { ledger_id: { $in: ids } } },
        {
          $group: {
            _id: "$ledger_id",
            current: { $sum: "$amount" },
            opening: { $sum: { $cond: [{ $lt: ["$date", from] }, "$amount", 0] } },
            movement: { $sum: { $cond: [{ $and: [{ $gte: ["$date", from] }, { $lte: ["$date", to] }] }, "$amount", 0] } },
            closing: { $sum: { $cond: [{ $lte: ["$date", to] }, "$amount", 0] } },
            count: { $sum: { $cond: [{ $and: [{ $gte: ["$date", from] }, { $lte: ["$date", to] }] }, 1, 0] } },
            lastActivity: { $max: "$date" },
          },
        },
      ])
      .toArray();
    const balById = new Map(balAgg.map((b) => [b._id, b]));

    // Per-ledger movement composition by entry type (within the period).
    const typeAgg = await entryColl
      .aggregate<{ _id: { ledger_id: string; type: string }; total: number; count: number }>([
        { $match: { ledger_id: { $in: ids }, date: { $gte: from, $lte: to } } },
        { $group: { _id: { ledger_id: "$ledger_id", type: "$type" }, total: { $sum: "$amount" }, count: { $sum: 1 } } },
      ])
      .toArray();
    const typesById = new Map<string, Array<{ type: string; total: number; count: number }>>();
    for (const t of typeAgg) {
      const arr = typesById.get(t._id.ledger_id) ?? [];
      arr.push({ type: String(t._id.type ?? "misc"), total: round2(t.total), count: t.count });
      typesById.set(t._id.ledger_id, arr);
    }

    for (const l of ledgerDocs) {
      const b = balById.get(l._id);
      const byType = (typesById.get(l._id) ?? []).sort((a, z) => Math.abs(z.total) - Math.abs(a.total));
      ledgerRows.push({
        id: l._id,
        holderName: l.holder_name,
        role: l.role,
        location: l.location,
        label: l.label ?? null,
        opening: round2(b?.opening ?? 0),
        movement: round2(b?.movement ?? 0),
        closing: round2(b?.closing ?? 0),
        current: round2(b?.current ?? 0),
        entryCount: b?.count ?? 0,
        lastActivity: b?.lastActivity ?? null,
        byType,
      });
    }
  }

  const totalOwedToCompany = round2(ledgerRows.reduce((s, r) => (r.current > 0 ? s + r.current : s), 0));
  const totalCompanyOwes = round2(ledgerRows.reduce((s, r) => (r.current < 0 ? s + Math.abs(r.current) : s), 0));
  const netPosition = round2(totalOwedToCompany - totalCompanyOwes);

  return {
    meta: {
      from,
      to,
      generatedAt: new Date().toISOString(),
      filters: {
        roles: opts.roles ?? [],
        locations: opts.locations ?? [],
        holders: opts.holders ?? [],
      },
    },
    pnl: {
      totalRevenue: round2(dash.totalRevenue),
      jobRevenue: round2(dash.jobRevenue),
      manualIncome: round2(dash.manualIncome),
      grossProfit: round2(dash.grossProfit),
      totalExpenses: round2(dash.totalExpenses),
      unpaidExpenses: round2(dash.unpaidExpenses),
      payouts,
      netProfit: round2(dash.netProfit),
      netAfterDisputes: round2(dash.netAfterDisputes),
      disputeFiledLoss: round2(dash.disputeFiledLoss),
      disputeRecoveredSlice: round2(dash.disputeRecoveredSlice),
      disputeImpact: round2(dash.disputeImpact),
      refundLoss: round2(dash.refundLoss),
      jobCount: dash.jobCount,
      cashOnHand: round2(dash.cashOnHand),
      outstandingPayables: round2(dash.outstandingPayables),
      outstandingReceivables: round2(dash.outstandingReceivables),
    },
    income: dash.incomeBySource.map((r) => ({ source: r.source, total: round2(r.total) })),
    expenses: dash.expenseByCategory.map((r) => ({ category: r.category, total: round2(r.total), count: r.count })),
    disputes: {
      disputeCount: dash.disputeCount,
      disputeTotalAmount: round2(dash.disputeTotalAmount),
      disputeWonAmount: round2(dash.disputeWonAmount),
      disputeLostAmount: round2(dash.disputeLostAmount),
      filedLoss: round2(dash.disputeFiledLoss),
      recoveredSlice: round2(dash.disputeRecoveredSlice),
      impact: round2(dash.disputeImpact),
      refundLoss: round2(dash.refundLoss),
    },
    byLocation: dash.topAreas.map((a) => ({ area: a.area, total: round2(a.total), count: a.count })),
    ledgers: { rows: ledgerRows, totalOwedToCompany, totalCompanyOwes, netPosition },
  };
}
