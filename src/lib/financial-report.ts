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
import { fetchDashboardData, type DisputeGroup } from "./portal-data";
import type { LedgerRecord, LedgerEntryRecord } from "@/types/finance-ledger";
import type { PayoutRecord, DebtRecord } from "@/types/finance";
import type { EquipmentOrder } from "@/types/equipment";

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// The sections a report can contain, in a stable canonical order. The UI lets
// the user toggle + reorder them; unknown keys are ignored by the renderers.
export const SECTION_KEYS = [
  "pnl", "income", "expenses", "disputes", "disputesByParty",
  "byLocation", "payouts", "debts", "equipment", "banking", "ledgers", "ledgerDetail",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const SECTION_LABELS: Record<SectionKey, string> = {
  pnl: "P&L Summary",
  income: "Income breakdown",
  expenses: "Expenses breakdown",
  disputes: "Disputes & Refunds impact",
  disputesByParty: "Disputes by provider / tech / AM",
  byLocation: "Revenue by location",
  payouts: "Payouts",
  debts: "Debts & balances",
  equipment: "Equipment orders",
  banking: "Cash & banking",
  ledgers: "Ledgers — balances to settle",
  ledgerDetail: "Ledger detail (per ledger)",
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

export interface LedgerDetailEntry {
  date: string;
  type: string;
  description: string;
  amount: number;
  running: number;    // running balance starting from the ledger's opening
}

export interface LedgerDetail {
  id: string;
  holderName: string;
  role: string;
  location: string;
  label: string | null;
  opening: number;
  movement: number;
  closing: number;
  current: number;
  entries: LedgerDetailEntry[]; // entries within the period, oldest → newest
  truncated: boolean;           // true if the ledger had more entries than the cap
}

export interface FinancialReportOptions {
  from: string;
  to: string;
  roles?: string[];
  locations?: string[];
  holders?: string[];
  includeArchived?: boolean;
  /** When true, also pull each in-scope ledger's per-entry breakdown (heavier). */
  includeLedgerDetail?: boolean;
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
  disputesByParty: {
    byProvider: DisputeGroup[];
    byTechnician: DisputeGroup[];
    byAreaManager: DisputeGroup[];
  };
  byLocation: Array<{ area: string; total: number; count: number }>;
  payouts: {
    paid: number;
    unpaid: number;
    count: number;
    rows: Array<{ recipient: string; role: string; net: number; status: string; periodEnd: string }>;
  };
  debts: {
    openTotal: number;
    count: number;
    rows: Array<{ from: string; to: string; amount: number; reason: string; dueDate: string | null }>;
  };
  equipment: {
    orderCount: number;
    amCharge: number;      // Σ amChargeTotal (non-cancelled) — posted to AM ledgers
    companyCost: number;
    grossProfit: number;
    rows: Array<{ order: string; areaManager: string; date: string; status: string; amCharge: number; grossProfit: number }>;
  };
  banking: {
    balanceTotal: number;
    inflow: number;
    outflow: number;
    net: number;
    accounts: Array<{ label: string; bank: string | null; balance: number; isCredit: boolean }>;
  };
  ledgers: {
    rows: LedgerBreakdown[];
    totalOwedToCompany: number; // Σ positive current balances
    totalCompanyOwes: number;   // Σ |negative current balances|
    netPosition: number;        // Σ current balances (signed)
  };
  ledgerDetail: {
    rows: LedgerDetail[];       // populated only when includeLedgerDetail
    truncatedLedgers: boolean;  // true if more ledgers were in scope than the cap
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

  // Per-ledger entry breakdown (only when requested — it's heavier). Each ledger
  // becomes its own statement: period entries with a running balance starting at
  // the ledger's opening. Capped to keep the report/PDF bounded.
  const LEDGER_DETAIL_MAX = 40;   // max ledgers rendered with full detail
  const ENTRY_MAX = 300;          // max entries per ledger
  const ledgerDetailRows: LedgerDetail[] = [];
  let truncatedLedgers = false;
  if (opts.includeLedgerDetail && ledgerRows.length) {
    truncatedLedgers = ledgerRows.length > LEDGER_DETAIL_MAX;
    const detailLedgers = ledgerRows.slice(0, LEDGER_DETAIL_MAX);
    const ec = coll<LedgerEntryRecord>(FINANCE_COLLECTIONS.ledgerEntry);
    const details = await Promise.all(detailLedgers.map(async (lr) => {
      const raw = await ec.find({ ledger_id: lr.id, date: { $gte: from, $lte: to } })
        .sort({ date: 1, _id: 1 })
        .limit(ENTRY_MAX + 1)
        .toArray();
      const truncated = raw.length > ENTRY_MAX;
      const slice = truncated ? raw.slice(0, ENTRY_MAX) : raw;
      let running = lr.opening;
      const entries: LedgerDetailEntry[] = slice.map((e) => {
        running = round2(running + e.amount);
        return { date: e.date, type: String(e.type), description: e.description ?? "", amount: round2(e.amount), running };
      });
      return {
        id: lr.id, holderName: lr.holderName, role: lr.role, location: lr.location, label: lr.label,
        opening: lr.opening, movement: lr.movement, closing: lr.closing, current: lr.current,
        entries, truncated,
      } as LedgerDetail;
    }));
    ledgerDetailRows.push(...details);
  }

  // 3) Extra whole-system sections — payouts, debts, equipment orders (all in
  //    the period; debts are outstanding-as-of-now). Banking + dispute-by-party
  //    come straight off the dashboard aggregation already fetched above.
  const payoutColl = coll<PayoutRecord>(FINANCE_COLLECTIONS.payout);
  const debtColl = coll<DebtRecord>(FINANCE_COLLECTIONS.debt);
  const eqColl = coll<EquipmentOrder>(FINANCE_COLLECTIONS.equipmentOrder);
  const [payoutStatusAgg, payoutList, debtList, eqList] = await Promise.all([
    payoutColl.aggregate<{ _id: string; total: number; count: number }>([
      { $match: { period_end: { $gte: from, $lte: to } } },
      { $group: { _id: "$status", total: { $sum: "$net" }, count: { $sum: 1 } } },
    ]).toArray(),
    payoutColl.find({ period_end: { $gte: from, $lte: to } }).sort({ net: -1 }).limit(30).toArray(),
    debtColl.find({ status: "open" }).sort({ amount: -1 }).limit(60).toArray(),
    eqColl.find({ orderDate: { $gte: from, $lte: to } }).sort({ orderDate: -1 }).limit(60).toArray(),
  ]);

  const payoutPaid = round2(payoutStatusAgg.filter((r) => r._id === "paid").reduce((s, r) => s + r.total, 0));
  const payoutUnpaid = round2(payoutStatusAgg.filter((r) => r._id === "unpaid").reduce((s, r) => s + r.total, 0));
  const payoutCount = payoutStatusAgg.reduce((s, r) => s + r.count, 0);

  const debtOpenTotal = round2(debtList.reduce((s, d) => s + (Number(d.amount) || 0), 0));

  const eqActive = eqList.filter((o) => o.status !== "Cancelled");
  const eqAmCharge = round2(eqActive.reduce((s, o) => s + (Number(o.totals?.amChargeTotal) || 0), 0));
  const eqCompanyCost = round2(eqActive.reduce((s, o) => s + (Number(o.totals?.companyCostTotal) || 0), 0));
  const eqGrossProfit = round2(eqActive.reduce((s, o) => s + (Number(o.totals?.grossProfit) || 0), 0));

  const bankNet = round2(dash.bankInflow + dash.bankOutflow); // outflow is negative

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
    disputesByParty: {
      byProvider: dash.disputesByProvider,
      byTechnician: dash.disputesByTechnician,
      byAreaManager: dash.disputesByAreaManager,
    },
    byLocation: dash.topAreas.map((a) => ({ area: a.area, total: round2(a.total), count: a.count })),
    payouts: {
      paid: payoutPaid,
      unpaid: payoutUnpaid,
      count: payoutCount,
      rows: payoutList.map((p) => ({
        recipient: p.recipient_name || "—",
        role: p.recipient_role || "",
        net: round2(p.net),
        status: p.status,
        periodEnd: p.period_end,
      })),
    },
    debts: {
      openTotal: debtOpenTotal,
      count: debtList.length,
      rows: debtList.map((d) => ({
        from: d.from_party_name || "—",
        to: d.to_party_name || "—",
        amount: round2(d.amount),
        reason: d.reason || "",
        dueDate: d.due_date ?? null,
      })),
    },
    equipment: {
      orderCount: eqActive.length,
      amCharge: eqAmCharge,
      companyCost: eqCompanyCost,
      grossProfit: eqGrossProfit,
      rows: eqList.map((o) => ({
        order: o.orderNumber,
        areaManager: o.areaManagerName || "—",
        date: o.orderDate,
        status: o.status,
        amCharge: round2(o.totals?.amChargeTotal ?? 0),
        grossProfit: round2(o.totals?.grossProfit ?? 0),
      })),
    },
    banking: {
      balanceTotal: round2(dash.bankBalanceTotal),
      inflow: round2(dash.bankInflow),
      outflow: round2(dash.bankOutflow),
      net: bankNet,
      accounts: dash.bankAccounts.map((a) => ({
        label: a.label,
        bank: a.bank_name,
        balance: round2(a._balance),
        isCredit: a._is_credit,
      })),
    },
    ledgers: { rows: ledgerRows, totalOwedToCompany, totalCompanyOwes, netPosition },
    ledgerDetail: { rows: ledgerDetailRows, truncatedLedgers },
  };
}
