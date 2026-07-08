// Server-side data fetchers that aggregate CRM data + portal collections
// for the dashboard and reports. These are called from server components
// (no client API roundtrip needed).

import type { Document } from "mongodb";
import { coll, FINANCE_COLLECTIONS, ensureFinanceIndexes } from "./finance-db";
import { getDb } from "./finance-db";
import type {
  ExpenseRecord,
  ManualIncomeRecord,
  PayoutRecord,
  DebtRecord,
  DisputeRecord,
  RefundRecord,
} from "@/types/finance";
import type {
  BankAccountSyncedRecord,
  BankTransactionSyncedRecord,
} from "@/types/finance-plaid";

interface DateWindow {
  from: string;
  to: string;
}

function rangeMatch(field: string, range: DateWindow): Record<string, unknown> {
  return { [field]: { $gte: range.from, $lte: range.to } };
}

// Sum a numeric Mongo field over a date range.
async function sumExpenseByCategory(
  range: DateWindow
): Promise<Array<{ category: string; total: number; count: number }>> {
  const c = await coll<ExpenseRecord>(FINANCE_COLLECTIONS.expense);
  return c
    .aggregate<{ category: string; total: number; count: number }>([
      { $match: { date: { $gte: range.from, $lte: range.to } } },
      {
        $group: {
          _id: "$category",
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $project: { category: "$_id", total: 1, count: 1, _id: 0 } },
      { $sort: { total: -1 } },
    ])
    .toArray();
}

async function sumExpensesTotal(range: DateWindow): Promise<{ total: number; unpaid: number }> {
  const c = await coll<ExpenseRecord>(FINANCE_COLLECTIONS.expense);
  const [aggTotal, aggUnpaid] = await Promise.all([
    c
      .aggregate<{ total: number }>([
        { $match: { date: { $gte: range.from, $lte: range.to } } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ])
      .toArray(),
    c
      .aggregate<{ total: number }>([
        { $match: { ...rangeMatch("date", range), status: "unpaid" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ])
      .toArray(),
  ]);
  return { total: aggTotal[0]?.total ?? 0, unpaid: aggUnpaid[0]?.total ?? 0 };
}

async function sumManualIncome(range: DateWindow): Promise<{ total: number; bySource: Map<string, number> }> {
  const c = await coll<ManualIncomeRecord>(FINANCE_COLLECTIONS.income);
  const rows = await c
    .aggregate<{ source: string; total: number }>([
      { $match: { date: { $gte: range.from, $lte: range.to } } },
      { $group: { _id: "$source", total: { $sum: "$amount" } } },
      { $project: { source: "$_id", total: 1, _id: 0 } },
    ])
    .toArray();
  const bySource = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    bySource.set(r.source, r.total);
    total += r.total;
  }
  return { total, bySource };
}

async function sumPayouts(range: DateWindow): Promise<{ paid: number; unpaid: number }> {
  const c = await coll<PayoutRecord>(FINANCE_COLLECTIONS.payout);
  const rows = await c
    .aggregate<{ status: string; total: number }>([
      { $match: { period_end: { $gte: range.from, $lte: range.to } } },
      { $group: { _id: "$status", total: { $sum: "$net" } } },
      { $project: { status: "$_id", total: 1, _id: 0 } },
    ])
    .toArray();
  let paid = 0;
  let unpaid = 0;
  for (const r of rows) {
    if (r.status === "paid") paid += r.total;
    else if (r.status === "unpaid") unpaid += r.total;
  }
  return { paid, unpaid };
}

async function sumDebts(): Promise<{ owed_to_us: number; we_owe: number }> {
  const c = await coll<DebtRecord>(FINANCE_COLLECTIONS.debt);
  const rows = await c
    .aggregate<{ status: string; total: number }>([
      { $match: { status: "open" } },
      { $group: { _id: "$status", total: { $sum: "$amount" } } },
    ])
    .toArray();
  // For now we don't split direction; both ends are tracked the same way.
  // A debt amount > 0 is what `from_party` owes `to_party`.
  const total = rows.reduce((sum, r) => sum + r.total, 0);
  return { owed_to_us: 0, we_owe: total };
}

async function sumDisputes(range: DateWindow): Promise<{ open: number; recovered: number }> {
  const c = await coll<DisputeRecord>(FINANCE_COLLECTIONS.dispute);
  const rows = await c
    .find({ date: { $gte: range.from, $lte: range.to } })
    .toArray();
  let open = 0;
  let recovered = 0;
  for (const r of rows) {
    open += r.amount_open ?? Math.max(0, (r.amount_disputed ?? 0) - (r.amount_recovered ?? 0));
    recovered += r.amount_recovered ?? 0;
  }
  return { open, recovered };
}

async function sumRefunds(range: DateWindow): Promise<number> {
  const c = await coll<RefundRecord>(FINANCE_COLLECTIONS.refund);
  const agg = await c
    .aggregate<{ total: number }>([
      { $match: { date: { $gte: range.from, $lte: range.to } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ])
    .toArray();
  return agg[0]?.total ?? 0;
}

// ── CRM job-based revenue + profit aggregations ────────────────────────────

/** Sum CRM Job collection. Mirrors the math used by /api/home-stats so the
 *  finance portal dashboard reports the same KPIs as the CRM home page.
 *
 *  Gross profit formula (locked 2026-06-01):
 *    grossProfit = companyNetProfit − penaltyLoss − companyParts + cardFeeProfit
 *
 *  Where:
 *    valTotalProfit    = revenue − parts − paymentFee   (op-profit per job)
 *    companyNetProfit  = sum of valTotalProfit × (1 − LM%/100 − provider%/100)
 *    penaltyLoss       = sum of valTotalProfit / 4
 *    companyParts      = sum of companyParts only (not tech/LM parts)
 *    cardFeeProfit     = sum of totalPaidCard × 0.02 (2% net after processor)
 */
async function aggregateCrmJobs(range: DateWindow): Promise<{
  jobCount: number;
  totalPaid: number;
  totalProfit: number;            // legacy: revenue − all parts
  totalSales: number;             // CRM home-page "Total Sales" (valTotalAmount sum)
  jobsProfit: number;             // CRM stats "Jobs Profit" (sales − all fees − all parts)
  companyNetProfit: number;
  penaltyLoss: number;
  companyParts: number;
  cardFeeProfit: number;
  financeFeeProfit: number;
  checkFeeProfit: number;
  byArea: Array<{ area: string; total: number; count: number }>;
  byDay: Array<{ day: string; total: number; count: number }>;
}> {
  const db = await getDb();
  // The CRM stores money as strings — coerce via $toDouble with $convert + onError.
  // We accept both `Closed` (completed jobs) and `X close` (cancellations) — each
  // metric filters down inside its own facet. Penalty loss applies only to
  // `X close`; everything else aggregates over `Closed`.
  const matchClosed = {
    date: { $gte: range.from, $lte: range.to },
    $or: [
      { status: { $regex: /^closed$/i } },
      { status: { $regex: /^x close$/i } },
    ],
  };
  const toNum = (field: string) => ({
    $convert: { input: `$${field}`, to: "double", onError: 0, onNull: 0 },
  });

  const pipeline: Document[] = [
    { $match: matchClosed },
    // Join provider & location to read profit %s for the company-net calc.
    {
      $lookup: {
        from: "Provider",
        let: { providerStr: "$provider" },
        pipeline: [
          { $match: { $expr: { $or: [{ $eq: ["$_id", "$$providerStr"] }, { $eq: ["$name", "$$providerStr"] }] } } },
        ],
        as: "providerData",
      },
    },
    { $unwind: { path: "$providerData", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "Location",
        let: { locStr: "$location" },
        pipeline: [
          { $match: { $expr: { $or: [{ $eq: ["$_id", "$$locStr"] }, { $eq: ["$name", "$$locStr"] }] } } },
        ],
        as: "locationData",
      },
    },
    { $unwind: { path: "$locationData", preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        // Field names must match the CRM Job schema exactly. Earlier versions
        // dropped the "total" prefix on four fields and silently undercounted
        // ~75% of revenue. Confirmed against /api/home-stats (2026-06-01).
        _paid: {
          $add: [
            toNum("techPaidCash"),
            toNum("totalPaidCard"),
            toNum("totalPaidCompanyCheck"),
            toNum("totalPaidFinance"),
            toNum("totalPaidCompanyCash"),
            toNum("lmCash"),
            toNum("lmCheck"),
          ],
        },
        _parts: { $add: [toNum("techParts"), toNum("companyParts"), toNum("lmParts")] },
        // Total parts cost on the job — tech + company + LM parts. Mirrors
        // valCompanyParts in /api/home-stats. The Closed-only status filter
        // is already applied inside the `totals` facet below.
        _companyParts: { $add: [toNum("techParts"), toNum("companyParts"), toNum("lmParts")] },
        // Card processing margin: customer charged 5%, processor takes 3%, company keeps 2%.
        _cardFee: { $multiply: [toNum("totalPaidCard"), 0.02] },
        // Finance margin: charged 10%, processor 7.5%, company keeps 2.5%.
        _financeFee: { $multiply: [toNum("totalPaidFinance"), 0.025] },
        // Company check margin: charged 10%, bank 5%, company keeps 5%.
        _checkFee: { $multiply: [toNum("totalPaidCompanyCheck"), 0.05] },
        // valTotalAmount per CRM convention: prefer the cached totalAmount
        // field when set, otherwise fall back to the sum of paid fields.
        _valTotalAmount: {
          $cond: [
            { $gt: [toNum("totalAmount"), 0] },
            toNum("totalAmount"),
            {
              $add: [
                toNum("techPaidCash"),
                toNum("totalPaidCard"),
                toNum("totalPaidCompanyCheck"),
                toNum("totalPaidFinance"),
                toNum("totalPaidCompanyCash"),
                toNum("lmCash"),
                toNum("lmCheck"),
              ],
            },
          ],
        },
        // Per-job payment-fee burden (paid out of the till), per CRM home-stats.
        _paymentFee: {
          $add: [
            { $multiply: [toNum("totalPaidCard"), 0.05] },
            { $multiply: [toNum("totalPaidFinance"), 0.10] },
            { $multiply: [toNum("totalPaidCompanyCheck"), 0.10] },
            { $multiply: [toNum("lmCheck"), 0.10] },
          ],
        },
        _lmPct: { $convert: { input: "$locationData.managerProfitPercent", to: "double", onError: 0, onNull: 0 } },
        _providerPct: { $convert: { input: "$providerData.profitPercent", to: "double", onError: 0, onNull: 0 } },
      },
    },
    {
      $addFields: {
        _profit: { $subtract: ["$_paid", "$_parts"] },
        // Per-job operational profit per CRM convention (revenue − parts − fees).
        _opProfit: { $subtract: [{ $subtract: ["$_paid", "$_parts"] }, "$_paymentFee"] },
      },
    },
    {
      $addFields: {
        // Company's share = opProfit × (1 − LM%/100 − provider%/100).
        // Normally 10% for LM=40, provider=50; varies per job.
        _companyNet: {
          $multiply: [
            "$_opProfit",
            {
              $subtract: [
                1,
                {
                  $add: [
                    { $divide: ["$_lmPct", 100] },
                    { $divide: ["$_providerPct", 100] },
                  ],
                },
              ],
            },
          ],
        },
        // Penalty loss = op profit / 4, per CRM home-stats.
        _penaltyLoss: { $divide: ["$_opProfit", 4] },
      },
    },
    {
      $facet: {
        // Closed-only metrics: revenue, company-net, fee margins, parts, jobs profit.
        totals: [
          { $match: { status: { $regex: /^closed$/i } } },
          {
            $group: {
              _id: null,
              jobCount: { $sum: 1 },
              totalPaid: { $sum: "$_paid" },
              totalProfit: { $sum: "$_profit" },
              totalSales: { $sum: "$_valTotalAmount" },
              // Jobs profit per job = valTotalAmount − paymentFee − parts.
              // Sum across all Closed jobs.
              jobsProfit: { $sum: { $subtract: [
                { $subtract: ["$_valTotalAmount", "$_paymentFee"] },
                "$_parts"
              ] } },
              financeFeeProfit: { $sum: "$_financeFee" },
              checkFeeProfit:   { $sum: "$_checkFee" },
              companyNetProfit: { $sum: "$_companyNet" },
              companyParts: { $sum: "$_companyParts" },
              cardFeeProfit: { $sum: "$_cardFee" },
            },
          },
        ],
        // Penalty loss applies only to cancelled / no-show jobs ('X close').
        penaltyTotals: [
          { $match: { status: { $regex: /^x close$/i } } },
          {
            $group: {
              _id: null,
              penaltyLoss: { $sum: "$_penaltyLoss" },
            },
          },
        ],
        byArea: [
          { $match: { status: { $regex: /^closed$/i } } },
          {
            $group: {
              _id: { $ifNull: ["$location", "—"] },
              total: { $sum: "$_paid" },
              count: { $sum: 1 },
            },
          },
          { $project: { area: "$_id", total: 1, count: 1, _id: 0 } },
          { $sort: { total: -1 } },
        ],
        byDay: [
          { $match: { status: { $regex: /^closed$/i } } },
          {
            $group: {
              _id: "$date",
              total: { $sum: "$_paid" },
              count: { $sum: 1 },
            },
          },
          { $project: { day: "$_id", total: 1, count: 1, _id: 0 } },
          { $sort: { day: 1 } },
        ],
      },
    },
  ];
  const out = await db.collection("Job").aggregate(pipeline).toArray();
  const facet = (out[0] ?? {}) as {
    totals?: Array<{
      jobCount: number;
      totalPaid: number;
      totalProfit: number;
      totalSales: number;
      jobsProfit: number;
      companyNetProfit: number;
      companyParts: number;
      cardFeeProfit: number;
      financeFeeProfit: number;
      checkFeeProfit: number;
    }>;
    penaltyTotals?: Array<{ penaltyLoss: number }>;
    byArea?: Array<{ area: string; total: number; count: number }>;
    byDay?: Array<{ day: string; total: number; count: number }>;
  };
  const t = facet.totals?.[0];
  return {
    jobCount: t?.jobCount ?? 0,
    totalPaid: t?.totalPaid ?? 0,
    totalProfit: t?.totalProfit ?? 0,
    totalSales: t?.totalSales ?? 0,
    jobsProfit: t?.jobsProfit ?? 0,
    companyNetProfit: t?.companyNetProfit ?? 0,
    penaltyLoss: facet.penaltyTotals?.[0]?.penaltyLoss ?? 0,
    companyParts: t?.companyParts ?? 0,
    cardFeeProfit: t?.cardFeeProfit ?? 0,
    financeFeeProfit: t?.financeFeeProfit ?? 0,
    checkFeeProfit: t?.checkFeeProfit ?? 0,
    byArea: facet.byArea ?? [],
    byDay: facet.byDay ?? [],
  };
}

// ── Composite dashboard fetch ──────────────────────────────────────────────

export interface DashboardData {
  range: DateWindow;
  // KPIs
  totalRevenue: number;
  jobRevenue: number;
  manualIncome: number;
  grossProfit: number;
  jobCount: number;
  totalExpenses: number;
  unpaidExpenses: number;
  netProfit: number;
  cashOnHand: number;
  outstandingPayables: number;
  outstandingReceivables: number;
  // Breakdowns
  incomeBySource: Array<{ source: string; total: number }>;
  expenseByCategory: Array<{ category: string; total: number; count: number }>;
  topAreas: Array<{ area: string; total: number; count: number }>;
  byDay: Array<{ day: string; total: number; count: number }>;
  // Lists
  recentExpenses: ExpenseRecord[];
  recentIncome: ManualIncomeRecord[];
  pendingPayouts: PayoutRecord[];
  openDisputes: number;
  openDisputesAmount: number;
  refunds: number;
  // Bank (Plaid-synced; shape kept compatible with the dashboard's legacy render code)
  bankAccounts: Array<{
    _id: string;
    label: string;
    bank_name: string | null;
    last4: string | null;
    account_type: string | null;
    active: boolean;
    _balance: number;
    _available: number | null;
    _is_credit: boolean;
  }>;
  bankBalanceTotal: number;
  // Plaid txn aggregates over the same date window
  bankInflow: number;
  bankOutflow: number;
  bankNet: number;
  bankUnmatched: number;
  recentBankTxns: BankTransactionSyncedRecord[];
  bankByDay: Array<{ day: string; inflow: number; outflow: number }>;
}

export async function fetchDashboardData(range: DateWindow): Promise<DashboardData> {
  await ensureFinanceIndexes();
  const [
    crmAgg,
    expenses,
    expCategorySplit,
    income,
    payouts,
    debts,
    disputes,
    refunds,
    recentExpenses,
    recentIncome,
    pendingPayouts,
    bankAccounts,
    bankTxnsInRange,
  ] = await Promise.all([
    aggregateCrmJobs(range),
    sumExpensesTotal(range),
    sumExpenseByCategory(range),
    sumManualIncome(range),
    sumPayouts(range),
    sumDebts(),
    sumDisputes(range),
    sumRefunds(range),
    coll<ExpenseRecord>(FINANCE_COLLECTIONS.expense)
      .find({ date: { $gte: range.from, $lte: range.to } })
      .sort({ date: -1 })
      .limit(8)
      .toArray(),
    coll<ManualIncomeRecord>(FINANCE_COLLECTIONS.income)
      .find({ date: { $gte: range.from, $lte: range.to } })
      .sort({ date: -1 })
      .limit(8)
      .toArray(),
    coll<PayoutRecord>(FINANCE_COLLECTIONS.payout)
      .find({ status: "unpaid" })
      .sort({ period_end: -1 })
      .limit(8)
      .toArray(),
    // Bank data now comes from Plaid synced collections. Manual accounts are gone.
    coll<BankAccountSyncedRecord>(FINANCE_COLLECTIONS.bankAccountSynced)
      .find({ active: true })
      .toArray(),
    coll<BankTransactionSyncedRecord>(FINANCE_COLLECTIONS.bankTxnSynced)
      .find({ date: { $gte: range.from, $lte: range.to } })
      .sort({ date: -1 })
      .toArray(),
  ]);

  // Plaid reports current_balance and available_balance directly — use those.
  // We map to the dashboard's expected shape so the existing rendering works
  // (label / bank_name / last4 / _balance).
  // For credit cards Plaid reports `current_balance` as the owed amount
  // (positive). We treat that as a negative cash contribution.
  const bankAcctsWithBalance = bankAccounts.map((a) => {
    const isCredit = (a.type ?? "").toLowerCase() === "credit" ||
                     (a.subtype ?? "").toString().toLowerCase() === "credit_card";
    const balance = isCredit
      ? -(a.current_balance ?? 0)
      : (a.current_balance ?? 0);
    return {
      _id: a._id,
      label: a.name + (a.mask ? ` ··${a.mask}` : ""),
      bank_name: a.institution_name ?? null,
      last4: a.mask ?? null,
      account_type: a.subtype ?? a.type ?? null,
      starting_balance: 0,
      currency: a.iso_currency_code ?? "USD",
      active: a.active,
      notes: a.notes ?? null,
      created_at: a.created_at,
      _balance: balance,
      _available: a.available_balance ?? null,
      _is_credit: isCredit,
    };
  });
  const bankBalanceTotal = bankAcctsWithBalance.reduce((s, a) => s + (a._balance ?? 0), 0);

  // Plaid transactions — derived stats for the dashboard
  const bankInflow = bankTxnsInRange.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const bankOutflow = bankTxnsInRange.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0); // negative
  const bankNet = bankInflow + bankOutflow;
  const bankUnmatched = bankTxnsInRange.filter((t) => t.recon_status === "unmatched").length;
  const recentBankTxns = bankTxnsInRange.slice(0, 8);

  // Per-day money in/out for cash-flow chart (groups by date)
  const bankByDayMap = new Map<string, { day: string; inflow: number; outflow: number }>();
  for (const t of bankTxnsInRange) {
    const cur = bankByDayMap.get(t.date) ?? { day: t.date, inflow: 0, outflow: 0 };
    if (t.amount > 0) cur.inflow += t.amount;
    else cur.outflow += t.amount;
    bankByDayMap.set(t.date, cur);
  }
  const bankByDay = Array.from(bankByDayMap.values()).sort((a, b) => a.day.localeCompare(b.day));

  const jobRevenue = crmAgg.totalSales;
  const manualIncome = income.total;
  // Total Revenue mirrors the CRM home page "Total Sales" (valTotalAmount,
  // Closed only) and adds anything captured as manual income in the portal.
  const totalRevenue = jobRevenue + manualIncome;
  // Gross profit mirrors the CRM home page "Net Profit" KPI:
  //   (Jobs Profit × 10%) − penalty loss + card + finance + check fee profits
  // Plus manual income (no provider/LM/penalty overhead on those).
  const grossProfit =
    (crmAgg.jobsProfit * 0.10)
    - crmAgg.penaltyLoss
    + crmAgg.cardFeeProfit
    + crmAgg.financeFeeProfit
    + crmAgg.checkFeeProfit
    + manualIncome;
  const netProfit = grossProfit - expenses.total - payouts.paid - payouts.unpaid;

  const incomeBySource: Array<{ source: string; total: number }> = [
    { source: "crm_jobs", total: jobRevenue },
    ...Array.from(income.bySource.entries()).map(([source, total]) => ({ source, total })),
  ].filter((x) => x.total > 0);

  return {
    range,
    totalRevenue,
    jobRevenue,
    manualIncome,
    grossProfit,
    jobCount: crmAgg.jobCount,
    totalExpenses: expenses.total,
    unpaidExpenses: expenses.unpaid,
    netProfit,
    cashOnHand: bankBalanceTotal,
    outstandingPayables: expenses.unpaid + payouts.unpaid + debts.we_owe,
    outstandingReceivables: disputes.open,
    incomeBySource,
    expenseByCategory: expCategorySplit,
    topAreas: crmAgg.byArea.slice(0, 8),
    byDay: crmAgg.byDay,
    recentExpenses,
    recentIncome,
    pendingPayouts,
    openDisputes: disputes.open > 0 ? 1 : 0,
    openDisputesAmount: disputes.open,
    refunds,
    bankAccounts: bankAcctsWithBalance,
    bankBalanceTotal,
    bankInflow,
    bankOutflow,
    bankNet,
    bankUnmatched,
    recentBankTxns,
    bankByDay,
  };
}
