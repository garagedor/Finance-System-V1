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
import type { ScanpayDisputeRecord } from "@/types/scanpay";
import { enrichJobs } from "@/lib/scanpay/enrich";

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

// A single dispute's effect on the filtered period. The company only ever eats
// ITS slice of a dispute (charge_snapshot.companyCharge from the dispute
// formula — the rest is charged back to provider/tech/AM). Event-based timing:
//   • the slice is booked as a LOSS in the month the dispute was FILED (date)
//   • if later WON, the recovered slice is booked as a GAIN in the month it was
//     RESOLVED (resolved_date) — a loss "leaves as is" (never recovered).
export interface DisputeImpactRow {
  _id: string;
  date: string;                 // filed
  resolved_date: string | null;
  customer_name: string | null;
  job_id: string | null;
  status: string;
  amount_disputed: number;
  companySlice: number;         // our slice of the loss (from the formula)
  filedInRange: boolean;
  recoveredInRange: boolean;
  recoveredSlice: number;       // slice recovered (prorated by amount recovered)
  periodImpact: number;         // net effect on THIS period's profit
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

async function computeDisputeImpact(range: DateWindow): Promise<{
  open: number;
  recovered: number;
  filedLoss: number;       // Σ company slice for disputes filed in range
  recoveredSlice: number;  // Σ company slice recovered (resolved) in range
  impact: number;          // recoveredSlice − filedLoss (≤0 when losses dominate)
  rows: DisputeImpactRow[];
}> {
  const c = await coll<DisputeRecord>(FINANCE_COLLECTIONS.dispute);
  // Anything filed in range OR resolved in range touches this period.
  const rowsRaw = await c
    .find({
      $or: [
        { date: { $gte: range.from, $lte: range.to } },
        { resolved_date: { $gte: range.from, $lte: range.to } },
      ],
    })
    .toArray();

  let open = 0, recovered = 0, filedLoss = 0, recoveredSlice = 0;
  const rows: DisputeImpactRow[] = [];
  for (const r of rowsRaw) {
    const snap = (r.charge_snapshot ?? {}) as Record<string, unknown>;
    const companySlice = Number(snap.companyCharge ?? 0) || 0;
    const disputed = r.amount_disputed ?? 0;
    const rec = r.amount_recovered ?? 0;
    const filedInRange = r.date >= range.from && r.date <= range.to;
    const resolvedInRange =
      !!r.resolved_date && r.resolved_date >= range.from && r.resolved_date <= range.to && rec > 0;
    const recFraction = disputed > 0 ? Math.min(1, rec / disputed) : 0;
    const rSlice = resolvedInRange ? companySlice * recFraction : 0;

    if (filedInRange) {
      open += r.amount_open ?? Math.max(0, disputed - rec);
      filedLoss += companySlice;
    }
    if (resolvedInRange) {
      recovered += rec;
      recoveredSlice += rSlice;
    }

    if (filedInRange || resolvedInRange) {
      rows.push({
        _id: r._id,
        date: r.date,
        resolved_date: r.resolved_date ?? null,
        customer_name: r.customer_name ?? null,
        job_id: r.job_id ?? null,
        status: r.status,
        amount_disputed: disputed,
        companySlice: round2(companySlice),
        filedInRange,
        recoveredInRange: resolvedInRange,
        recoveredSlice: round2(rSlice),
        periodImpact: round2((filedInRange ? -companySlice : 0) + rSlice),
      });
    }
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return {
    open: round2(open),
    recovered: round2(recovered),
    filedLoss: round2(filedLoss),
    recoveredSlice: round2(recoveredSlice),
    impact: round2(recoveredSlice - filedLoss),
    rows,
  };
}

// Refund impact is simpler than disputes: a refund is a pure loss booked on its
// date (you don't recover a refund). Only the company's slice counts. Only
// engine-posted refunds carry charge_snapshot.companyCharge.
export interface RefundImpactRow {
  _id: string;
  date: string;
  customer_name: string | null;
  job_id: string | null;
  companySlice: number;
}

async function computeRefundImpact(range: DateWindow): Promise<{ loss: number; rows: RefundImpactRow[] }> {
  const c = await coll<RefundRecord>(FINANCE_COLLECTIONS.refund);
  const rowsRaw = await c.find({ date: { $gte: range.from, $lte: range.to } }).toArray();
  let loss = 0;
  const rows: RefundImpactRow[] = [];
  for (const r of rowsRaw) {
    const snap = (r.charge_snapshot ?? {}) as Record<string, unknown>;
    const companySlice = Number(snap.companyCharge ?? 0) || 0;
    if (companySlice <= 0) continue; // only engine-posted refunds carry a slice
    loss += companySlice;
    rows.push({
      _id: r._id,
      date: r.date,
      customer_name: r.customer_name ?? null,
      job_id: r.job_id ?? null,
      companySlice: round2(companySlice),
    });
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { loss: round2(loss), rows };
}

// Dispute breakdowns for the owner: group the ScanPay disputes (filed in range)
// by provider / technician / area manager — count, total disputed, won, lost,
// and the engine-computed SHARE each party is charged. Business rule: a party is
// charged their slice when the dispute is FILED; if it's later WON we give the
// slice back; if LOST the charge stays. So `share` sums the computed slice over
// every dispute EXCEPT won ones (won = returned). Provider / tech / AM come from
// each dispute's matched CRM job; the slice from the sync-time snapshot.
export interface DisputeGroup { name: string; count: number; disputed: number; won: number; lost: number; share: number }

async function disputeBreakdowns(range: DateWindow): Promise<{
  count: number; total: number; won: number; lost: number;
  byProvider: DisputeGroup[]; byTechnician: DisputeGroup[]; byAreaManager: DisputeGroup[];
}> {
  const c = coll<ScanpayDisputeRecord>(FINANCE_COLLECTIONS.scanpayDispute);
  const all = await c.find({}).toArray();
  const inRange = all.filter((r) => {
    const d = r.disputedAt ? r.disputedAt.slice(0, 10) : "";
    return d && d >= range.from && d <= range.to;
  });
  const enrich = await enrichJobs(inRange.map((r) => r.matchedJobId));

  const prov = new Map<string, DisputeGroup>();
  const tech = new Map<string, DisputeGroup>();
  const am = new Map<string, DisputeGroup>();
  let total = 0, won = 0, lost = 0;
  const bump = (m: Map<string, DisputeGroup>, key: string, amt: number, outcome: string, share: number) => {
    const g = m.get(key) ?? { name: key, count: 0, disputed: 0, won: 0, lost: 0, share: 0 };
    g.count++; g.disputed += amt;
    if (outcome === "won") g.won += amt;      // returned — not charged
    else {
      if (outcome === "lost") g.lost += amt;
      g.share += share;                        // charged on filing (pending + lost)
    }
    m.set(key, g);
  };
  for (const r of inRange) {
    const en = r.matchedJobId ? enrich.get(r.matchedJobId) : undefined;
    const amt = r.amount || 0;
    const cs = r.computedShare;
    total += amt;
    if (r.outcome === "lost") lost += amt;
    else if (r.outcome === "won") won += amt;
    bump(prov, en?.provider || "Unmatched", amt, r.outcome, cs?.providerCharge ?? 0);
    bump(tech, en?.tech || "Unmatched", amt, r.outcome, cs?.technicianPortion ?? 0);
    bump(am, en?.areaManager || (en?.areaManagerMissing ? "⚠ unassigned" : "Unmatched"), amt, r.outcome, cs?.amLedgerCharge ?? 0);
  }
  const fin = (m: Map<string, DisputeGroup>) =>
    [...m.values()]
      .map((g) => ({ ...g, disputed: round2(g.disputed), won: round2(g.won), lost: round2(g.lost), share: round2(g.share) }))
      .sort((a, b) => b.disputed - a.disputed);
  return { count: inRange.length, total: round2(total), won: round2(won), lost: round2(lost), byProvider: fin(prov), byTechnician: fin(tech), byAreaManager: fin(am) };
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
  netAfterDisputes: number;
  cashOnHand: number;
  outstandingPayables: number;
  outstandingReceivables: number;
  // Dispute impact on the filtered period (company slice only)
  disputeFiledLoss: number;      // slice lost on disputes FILED in range
  disputeRecoveredSlice: number; // slice recovered on disputes RESOLVED (won) in range
  disputeImpact: number;         // recovered − filed loss
  disputeRows: DisputeImpactRow[];
  refundLoss: number;            // slice lost on refunds ISSUED in range
  refundRows: RefundImpactRow[];
  // Breakdowns
  incomeBySource: Array<{ source: string; total: number }>;
  expenseByCategory: Array<{ category: string; total: number; count: number }>;
  topAreas: Array<{ area: string; total: number; count: number }>;
  byDay: Array<{ day: string; total: number; count: number }>;
  // Dispute breakdowns (from the ScanPay dispute inbox, filtered by disputed date)
  disputeCount: number;
  disputeTotalAmount: number;
  disputeWonAmount: number;
  disputeLostAmount: number;
  disputesByProvider: DisputeGroup[];
  disputesByTechnician: DisputeGroup[];
  disputesByAreaManager: DisputeGroup[];
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
    computeDisputeImpact(range),
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
  // Dispute + refund impact is kept OUT of netProfit (which mirrors the CRM home
  // page) and shown as a separate adjustment for the filtered period. Disputes
  // can net positive (won recoveries); refunds are always a loss.
  const refundImpact = await computeRefundImpact(range);
  const disputeAgg = await disputeBreakdowns(range);
  const netAfterDisputes = round2(netProfit + disputes.impact - refundImpact.loss);

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
    netAfterDisputes,
    disputeFiledLoss: disputes.filedLoss,
    disputeRecoveredSlice: disputes.recoveredSlice,
    disputeImpact: disputes.impact,
    disputeRows: disputes.rows,
    refundLoss: refundImpact.loss,
    refundRows: refundImpact.rows,
    cashOnHand: bankBalanceTotal,
    outstandingPayables: expenses.unpaid + payouts.unpaid + debts.we_owe,
    outstandingReceivables: disputes.open,
    incomeBySource,
    expenseByCategory: expCategorySplit,
    topAreas: crmAgg.byArea.slice(0, 8),
    byDay: crmAgg.byDay,
    disputeCount: disputeAgg.count,
    disputeTotalAmount: disputeAgg.total,
    disputeWonAmount: disputeAgg.won,
    disputeLostAmount: disputeAgg.lost,
    disputesByProvider: disputeAgg.byProvider,
    disputesByTechnician: disputeAgg.byTechnician,
    disputesByAreaManager: disputeAgg.byAreaManager,
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
