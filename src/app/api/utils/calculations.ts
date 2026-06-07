import type { JobRow } from '../../../types/job';

export const toNumber = (value: any) => {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
};

type PaidOptions = { includeTotalAmount?: boolean };

export const calcPaidSum = (job: Partial<JobRow>) => {
  return toNumber(job.techPaidCash) +
    toNumber(job.totalPaidCard) +
    toNumber(job.totalPaidCompanyCheck) +
    toNumber(job.totalPaidFinance) +
    toNumber(job.totalPaidCompanyCash) +
    toNumber(job.lmCash) +
    toNumber(job.lmCheck);
};

// Payment-fee rule (locked 2026-06-04): only COMPANY CHECK carries a 10%
// check fee. lmCheck is treated as full-value: the LM physically holds the
// paper check, the company never pays a processor to cash it, so no fee is
// taken. (Previous code charged lmCheck 10% — that was wrong.)
export const calcPaymentFee = (job: Partial<JobRow>) =>
  toNumber(job.totalPaidCard) * 0.05 +
  toNumber(job.totalPaidFinance) * 0.1 +
  toNumber(job.totalPaidCompanyCheck) * 0.1;

// Same rule as calcPaymentFee but with the companyCheck fee excluded — used
// by legacy provider-tab columns that report "fees w/o check". lmCheck is
// likewise full-value (no fee).
export const calcPaymentFeeNoCheck = (job: Partial<JobRow>) =>
  toNumber(job.totalPaidCard) * 0.05 +
  toNumber(job.totalPaidFinance) * 0.1;

export const calcTotalAfterFee = (job: Partial<JobRow>) =>
  toNumber(job.totalPaidCard) * 0.95 +
  toNumber(job.totalPaidFinance) * 0.9 +
  toNumber(job.totalPaidCompanyCheck) * 0.9 +
  toNumber(job.techPaidCash) +
  toNumber(job.totalPaidCompanyCash) +
  toNumber(job.lmCash) +
  toNumber(job.lmCheck);

export const calcParts = (job: Partial<JobRow>) =>
  toNumber(job.techParts) + toNumber(job.companyParts) + toNumber(job.lmParts);

type TipsOptions = {
  includeCheck?: boolean;
  includeCompanyCashBonus?: boolean;
};

// Tips total — net of processor fees, never double-counted. Tips belong
// 100% to the technician side (folded into tech_balance only, never into
// location_balance). Rule locked 2026-06-04 (replaces a pre-existing bug
// where tipsCompanyCash was counted at 0.9 PLUS a "bonus" 1.0 = 1.9x).
//
// Per-tip-kind treatment:
//   tipsCard         × 0.95  (5% processor fee)
//   tipsFinance      × 0.9   (10% processor fee)
//   tipsCheck        × 0.9   (10% processor fee — when includeCheck = true)
//   tipsCompanyCash  × 1.0   (no processor; full face value)
//                    × 0.9   when includeCompanyCashBonus = false (legacy
//                           dispute-pool variant that discounts it like a
//                           card tip).
export const calcTipsTotal = (job: Partial<JobRow>, opts: TipsOptions = {}) => {
  const { includeCheck = true, includeCompanyCashBonus = true } = opts;
  return (
    toNumber(job.tipsCard) * 0.95 +
    toNumber(job.tipsFinance) * 0.9 +
    toNumber(job.tipsCompanyCash) * (includeCompanyCashBonus ? 1 : 0.9) +
    (includeCheck ? toNumber(job.tipsCheck) * 0.9 : 0)
  );
};

export const calcJobProfit = (paidSum: number, parts: number) => toNumber(paidSum) - toNumber(parts);

// Standard share calculation used in most reports: (profit * percent / 100)
export const calcStandardShare = (profit: number, percent: number) =>
  toNumber(profit) * (toNumber(percent) / 100);

export const calcOldBalance = (
  totalAfterFee: number,
  parts: number,
  techPaidCash: number,
  techProfitPercent: number
) => toNumber(totalAfterFee) * (toNumber(techProfitPercent) / 100) - toNumber(parts) - toNumber(techPaidCash);

/** Cap a dispute/refund `amount` at the job's after-fee revenue. Beyond
 *  that, the company never received the money, so a tech / location-manager
 *  / provider can't owe more than what was actually in the till. Passing
 *  `totalAfterFee = undefined` disables the cap (legacy behaviour).
 *  Business rule confirmed 2026-05-29. */
const capByAfterFee = (amount: number, totalAfterFee?: number): number => {
  if (totalAfterFee === undefined) return toNumber(amount);
  return Math.min(toNumber(amount), toNumber(totalAfterFee));
};

// ─────────────────────────────────────────────────────────────────────────────
// Chargeback / refund allocation (rules locked 2026-05-31)
//
// Inputs are all GROSS (customer-facing) amounts — the company absorbs the
// credit-card processing fee loss separately and it's not part of this math.
//
// Allocation order:
//   1. Recover the technician tip first — 100% to the 40%-side (AM pool).
//   2. Remaining refund is charged against operational revenue
//        = totalCharge − parts − tip
//      split by the revenue percentages (40% / 50% / 10% in the canonical
//      setup, but the function accepts arbitrary percentages).
//   3. If the refund still has unrecovered balance after consuming all
//      operational revenue, the leftover is "parts-loss participation"
//      and is absorbed entirely by the 40%-side (provider + company are
//      not charged for parts).
//   4. The 40%-side total is then split internally between technician and
//      area manager proportional to their configured profit-share
//      percentages (e.g. tech=30, AM pool=40 → tech takes 30/40, AM takes
//      the residual 10/40).
//
// Returned values are the absolute dollar amounts each party owes.
// ─────────────────────────────────────────────────────────────────────────────

export interface ChargebackInputs {
  /** Gross amount the customer paid. */
  totalCharge: number;
  /** Total parts cost (tech + company + LM parts). */
  parts: number;
  /** Gross tip the technician received on the job. */
  tip: number;
  /** Refund / disputed amount the customer charged back. */
  refund: number;
  /** Technician's profit-share % (e.g. 30 for 30%). Slice of the AM pool. */
  techPct: number;
  /** Area-manager pool % (e.g. 40 for 40%). Tech's share lives inside this. */
  amPoolPct: number;
  /** Provider's profit-share % (e.g. 50). */
  providerPct: number;
  /** Company's residual share % (e.g. 10). Defaults to 100 − provider − amPool. */
  companyPct?: number;
}

export interface ChargebackBreakdown {
  /** Total recovered from the 40%-side (tip + their op-rev share + parts loss).
   *  Same value as `managerShare` — the AM IS the 40%-side for settlement. */
  amPoolShare: number;
  /** Display-only: how the AM might internally allocate to the tech. Does
   *  NOT reduce `managerShare` and is not what gets recovered from the
   *  tech's balance. */
  techShare: number;
  /** The Area Manager's chargeback — equals `amPoolShare`. AM is the
   *  responsible party for settlement. */
  managerShare: number;
  /** Provider's portion (only op-rev share). */
  providerShare: number;
  /** Company's portion (only op-rev share). */
  companyShare: number;
  /** True when the tech's configured % exceeds the 40% pool — typically a
   *  subcontractor on a flat 50% deal. Chargeback math still caps them at
   *  the full pool; the "extra" % they earn on normal jobs lives outside the
   *  dispute model. UI may flag the row for review. */
  isSubcontractor: boolean;
  /** Diagnostics — what each phase consumed. */
  details: {
    tipRecovered: number;
    opRevRecovered: number;
    partsLossRecovered: number;
    opRev: number;
  };
}

/** Compute the full chargeback breakdown per the rules above. */
export function computeChargeback(i: ChargebackInputs): ChargebackBreakdown {
  const totalCharge = Math.max(0, toNumber(i.totalCharge));
  const parts = Math.max(0, toNumber(i.parts));
  const tip = Math.max(0, toNumber(i.tip));
  // Cap the refund at what the customer actually paid — they can never
  // recover more than they sent.
  const refund = Math.max(0, Math.min(toNumber(i.refund), totalCharge));

  const opRev = Math.max(0, totalCharge - parts - tip);

  const amPoolPct = toNumber(i.amPoolPct);
  const providerPct = toNumber(i.providerPct);
  const techPct = toNumber(i.techPct);
  const companyPct = i.companyPct !== undefined
    ? toNumber(i.companyPct)
    : Math.max(0, 100 - amPoolPct - providerPct);

  // Provider cap (rule 2026-05-31): once the refund overflows past tip + opRev,
  // the provider does not absorb their full opRev × providerPct share. They
  // also do not cover the "company operational share" — defined as the
  // company's percentage of (operational revenue minus parts), i.e. the
  // company's earned slice of the post-materials revenue pool. The $25 that
  // would otherwise go to the provider in overflow rolls over to company.
  const companyOpShare = ((opRev - parts) * companyPct) / 100;
  const providerCap = ((opRev - companyOpShare) * providerPct) / 100;

  // Phase 1 — tips first, all to the 40%-side.
  const tipRecovered = Math.min(refund, tip);
  let amPoolShare = tipRecovered;
  let providerShare = 0;
  let companyShare = 0;

  // Phase 2 — operational revenue, split by the configured percentages.
  const afterTip = refund - tipRecovered;
  const opRevRecovered = Math.min(afterTip, opRev);
  amPoolShare   += opRevRecovered * (amPoolPct   / 100);
  providerShare += opRevRecovered * (providerPct / 100);
  companyShare  += opRevRecovered * (companyPct  / 100);

  // Phase 3 — parts loss, 40%-side only.
  const afterOp = afterTip - opRevRecovered;
  const partsLossRecovered = Math.min(afterOp, parts);
  amPoolShare += partsLossRecovered;

  // Overflow: the refund reached parts territory. Apply the provider cap
  // and redirect the surplus to the company.
  const isOverflow = partsLossRecovered > 0;
  if (isOverflow) {
    const providerSurplus = Math.max(0, providerShare - providerCap);
    providerShare -= providerSurplus;
    companyShare += providerSurplus;
  }

  // ── Business model (locked 2026-05-31) ──────────────────────────────────
  // The official profit split is Provider 50% / Area Manager 40% / Company
  // 10%. The technician is NOT part of the official split — the techPct
  // stored on each Technician record is just how much the Area Manager
  // chooses to pay that tech out of the AM's own 40%.
  //
  // For chargebacks / disputes / settlements:
  //   - The Area Manager always receives the FULL 40%-side. Recovery is
  //     against the AM's balance, not the tech's.
  //   - The Tech Share is informational only — it shows how the AM might
  //     internally allocate their 40% to the tech. It does NOT reduce what
  //     the company recovers from the AM.
  //   - Subcontractors (techPct > amPoolPct) flag is still useful: the AM
  //     pays the sub more than the AM recovers, so the AM eats the gap on
  //     normal jobs. For chargebacks the AM still owes the full 40%.
  // -------------------------------------------------------------------------
  const managerShare = amPoolShare;
  const techRatio = amPoolPct > 0 ? Math.min(1, techPct / amPoolPct) : 1;
  const techShare = amPoolShare * techRatio;  // display-only allocation
  const isSubcontractor = techPct > amPoolPct;

  return {
    amPoolShare,
    techShare,
    managerShare,
    providerShare,
    companyShare,
    isSubcontractor,
    details: { tipRecovered, opRevRecovered, partsLossRecovered, opRev },
  };
}

/**
 * Tech / Location-Manager share of a dispute or refund.
 *
 * Tips absorb the disputed amount first. After that:
 *   - If disputed fits inside the job's profit (non-overflow): the person
 *     eats their cut (pct) of what's left after tips. They lose tips
 *     implicitly because the tip pool was already consumed.
 *   - If disputed exceeds profit (overflow): they eat their cut of the
 *     full profit, lose all tips, AND eat the overrun (disputed − profit)
 *     in full — because there's no profit left to share the overrun.
 *
 * Both formulas confirmed against the operations spreadsheet 2026-05-29.
 */
export const calcTechShare = (
  netoTips: number,
  amount: number,
  totalProfit: number,
  techProfitPercent: number,
  totalAfterFee?: number,
) => {
  const nTips = toNumber(netoTips);
  const amt = capByAfterFee(amount, totalAfterFee);
  const profit = toNumber(totalProfit);
  const pct = toNumber(techProfitPercent);

  if (amt > profit) {
    // Overflow: dispute exceeds the job's profit.
    return (profit * pct) / 100 + nTips + (amt - profit);
  }
  // Non-overflow: dispute fits inside profit. Tips cover first, then
  // tech/LM eats their % of the remaining amount.
  return Math.max(0, ((amt - nTips) * pct) / 100);
};

/**
 * Provider share of a dispute or refund.
 *
 *   - When the dispute fits inside the job's profit (non-overflow): the
 *     provider pays nothing, because the job is still net-profitable and
 *     tech/LM absorb their portions from the profit.
 *   - When the dispute exceeds profit (overflow): the provider absorbs
 *     their cut of (profit − tips).
 *
 * Confirmed against the operations spreadsheet 2026-05-29: "we don't
 * charge him if the disputed amount is not full and there is still job
 * profit".
 */
export const calcProviderShare = (
  netoTips: number,
  amount: number,
  totalProfit: number,
  providerPercent: number,
  totalAfterFee?: number,
) => {
  const nTips = toNumber(netoTips);
  const amt = capByAfterFee(amount, totalAfterFee);
  const profit = toNumber(totalProfit);
  const pct = toNumber(providerPercent);

  if (amt <= profit) return 0;
  return Math.max(0, ((profit - nTips) * pct) / 100);
};

export const calcFinalBalance = (shareAmount: number, techParts: number, techPaidCash: number) => {
  return toNumber(shareAmount) + toNumber(techParts) - toNumber(techPaidCash);
};

// ─────────────────────────────────────────────────────────────────────────────
// Balance-report unified helper (locked 2026-06-03 — final spec, rev 2).
//
// Single source of truth for every number the balance-report consumes per
// job. Both Tech Report and Location Report MUST go through this helper so
// the two views cannot drift.
//
// Pipeline:
//   1. payment_fee = 5%×card + 10%×finance + 10%×companyCheck
//      (lmCheck has 0% fee — the LM holds the paper check, no processor
//      involved. 0 for pure cash jobs.)
//   2. total_profit = job_total − payment_fee − (tech_parts + company_parts + lm_parts)
//   3. tech_share     = total_profit × tech_percentage
//   4. location_share = total_profit × location_percentage
//   5a. tech_balance           = tech_share + tech_parts − tech_cash
//   5b. tech_balance_with_tips = tech_balance + tips
//   6a. location_balance           = location_share + tech_parts + lm_parts
//                                    − lm_cash − lm_check − tech_cash
//   6b. location_balance_with_tips = location_balance  (tips don't flow to LM)
//
// Why tech_parts appears in BOTH balances (locked 2026-06-07): the Area
// Manager pays the technician — including tech parts reimbursement — out of
// their own pocket, then the company settles with the AM. So tech_parts
// raises what the company owes the AM (positive on location side), and
// independently raises what the AM owes the tech (positive on tech side).
// Both views are correct settlement claims sitting on different ledgers.
//
// The UI presents only Balance and Balance + Tips — directional Co.↔Tech /
// LM↔Co. columns were dropped (rule locked 2026-06-07). Balance is the net
// settlement, sign convention below; Balance + Tips includes tips where
// relevant (tech mode only — for location mode it equals Balance).
//
// CRITICAL: total_profit ALREADY deducts all three parts buckets (tech,
// company, lm) before the share is taken. The balance formulas therefore add
// back ONLY the parts the *subject of the report* personally fronted as a
// reimbursement claim — tech_parts in tech mode, lm_parts in location mode.
// Subtracting lm_parts a second time from tech_balance (the previous bug)
// double-counts the LM-parts cost.
//
// Sign convention (the value this helper returns matches the on-screen
// display 1:1 — DO NOT multiply by −1 in the UI):
//   positive  →  company owes the subject (tech / LM is in the black)
//   negative  →  subject owes the company (cash collected exceeds earnings)
//
// Other invariants:
//   - tips flow only to the technician (tech_balance), never to the location.
//   - tech_cash reduces both balances. The tech sits inside the location
//     structure for cash-collection accounting; cash the tech kept "stays"
//     on the LM side and reduces what the company still owes the LM.
//   - lm_parts is positive for location_balance — LM fronted those parts, so
//     the company owes that amount back to the LM on top of the profit share.
// ─────────────────────────────────────────────────────────────────────────────

export type JobBalanceComputation = {
  /** Sum of processor / handling fees on all paid-via-rail methods. */
  paymentFee: number;
  /** tech_parts + company_parts + lm_parts. */
  parts: number;
  /** Gross job total (sum of every payment method received from the customer). */
  jobTotal: number;
  /** job_total − payment_fee − parts. The share-eligible amount. */
  totalProfit: number;
  /** Net-of-processor-fee tip total (already discounted for card / finance / check tips). */
  tipsTotal: number;
  /** total_profit × tech_percentage / 100. */
  techShare: number;
  /** total_profit × location_percentage / 100. */
  locationShare: number;
  /** Tech-perspective balance, EXCLUDING tips. */
  techBalance: number;
  /** Tech-perspective balance WITH tips folded in. */
  techBalanceWithTips: number;
  /** Location-perspective balance. Tips don't flow to LM, so no separate withTips field is needed. */
  locationBalance: number;
  /** Location-perspective balance with tips — equals locationBalance (tips never flow to LM). */
  locationBalanceWithTips: number;
};

export const calcJobBalances = (
  job: Partial<JobRow>,
  techPercentage: number,
  locationPercentage: number,
): JobBalanceComputation => {
  // Step 1
  const paymentFee = calcPaymentFee(job);
  // Step 2
  const jobTotal = calcPaidSum(job);
  const parts = calcParts(job);
  const totalProfit = toNumber(jobTotal) - toNumber(paymentFee) - toNumber(parts);
  // Steps 3 & 4
  const techShare = calcStandardShare(totalProfit, techPercentage);
  const locationShare = calcStandardShare(totalProfit, locationPercentage);
  // Tips are net of processor fees (tipsCard × 0.95 etc.) — they apply only
  // to the technician balance.
  const tipsTotal = calcTipsTotal(job, { includeCheck: true, includeCompanyCashBonus: true });

  const techCash = toNumber(job.techPaidCash);
  const techParts = toNumber(job.techParts);
  const lmParts = toNumber(job.lmParts);
  const lmCash = toNumber(job.lmCash);
  const lmCheck = toNumber(job.lmCheck);

  // Step 5a — tech_balance (no tips). tech_share already reflects the
  //   lm_parts deduction (removed from total_profit upstream), so we DO NOT
  //   subtract lm_parts again here.
  const techBalance =
    techShare +
    techParts -     // tech-fronted parts: company reimburses the tech (+)
    techCash;       // cash the tech kept: reduces what company still owes (−)

  // Step 5b — tech_balance with tips folded in.
  const techBalanceWithTips = techBalance + tipsTotal;

  // Step 6a — location_balance. lm_parts is added because the LM personally
  //   fronted those parts and they get reimbursed on top of their profit
  //   share. tech_parts is added because the AM pays the technician (parts
  //   reimbursement included) and the company settles with the AM — so
  //   tech_parts raises what the company owes the AM. tech_cash deducts
  //   because the tech sits inside the location structure for cash holding.
  const locationBalance =
    locationShare +
    techParts +
    lmParts -
    lmCash -
    lmCheck -
    techCash;

  // Step 6b — location_balance with tips. Tips never flow to the LM, so
  //   this is identical to locationBalance. Exposed so the UI can read both
  //   "balance" and "balanceWithTips" uniformly across modes.
  const locationBalanceWithTips = locationBalance;

  return {
    paymentFee,
    parts,
    jobTotal,
    totalProfit,
    tipsTotal,
    techShare,
    locationShare,
    techBalance,
    techBalanceWithTips,
    locationBalance,
    locationBalanceWithTips,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// LM (Location Manager) extension — accounting model (locked 2026-05-07).
//
// Recognition (in the original revenue/cost helpers above):
//   - lmCash and lmCheck ARE recognized job revenue. They flow into
//     calcPaidSum and calcTotalAfterFee like any other payment method.
//     lmCheck has a 0% fee (locked 2026-06-04): only COMPANY CHECK carries
//     the 10% check fee. lmCheck is a paper check held by the LM, the
//     company never pays a processor to cash it.
//   - lmParts IS a job-profit cost. calcParts includes it alongside
//     techParts and companyParts. The parts were consumed on the job, so
//     their cost is real to the company's profit pool regardless of who
//     fronted the cash.
//
// Settlement views (orthogonal — separate accounting layer):
//   View 1 — Company ↔ Tech: Tech share/balance computed off the recognized
//            profit. calcFinalBalance formula itself unchanged.
//   View 2 — LM ↔ Company: per job = lmCash + lmCheck. LM owes Company the
//            money they collected on its behalf (a receivable; settles when
//            LM remits cash). Note this is intentional double-bookkeeping:
//            the same dollars are both recognized revenue (View 1 inputs)
//            and a pending receivable (View 2) until the LM pays over.
//
// (Tech ↔ LM was removed 2026-05-11: settlement is strictly Company ↔ LM.)
// ─────────────────────────────────────────────────────────────────────────────

export const calcLmRevenue = (job: Partial<JobRow>) =>
  toNumber(job.lmCash) + toNumber(job.lmCheck);

// lmCheck has a 0% fee (rule locked 2026-06-04). Kept as a named helper for
// any caller that wants to be explicit about the LM-check fee being zero.
export const calcLmCheckFee = (_job: Partial<JobRow>) => 0;

export const calcLmOwesCompany = (job: Partial<JobRow>) =>
  toNumber(job.lmCash) + toNumber(job.lmCheck);
export const calcCompanyReceivableFromLm = (job: Partial<JobRow>) =>
  calcLmOwesCompany(job);
