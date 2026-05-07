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
    toNumber(job.totalPaidCompanyCash);
};

export const calcPaymentFee = (job: Partial<JobRow>) =>
  toNumber(job.totalPaidCard) * 0.05 +
  toNumber(job.totalPaidFinance) * 0.1 +
  toNumber(job.totalPaidCompanyCheck) * 0.1;

export const calcPaymentFeeNoCheck = (job: Partial<JobRow>) =>
  toNumber(job.totalPaidCard) * 0.05 +
  toNumber(job.totalPaidFinance) * 0.1;

export const calcTotalAfterFee = (job: Partial<JobRow>) =>
  toNumber(job.totalPaidCard) * 0.95 +
  toNumber(job.totalPaidFinance) * 0.9 +
  toNumber(job.totalPaidCompanyCheck) * 0.9 +
  toNumber(job.techPaidCash) +
  toNumber(job.totalPaidCompanyCash);

export const calcParts = (job: Partial<JobRow>) =>
  toNumber(job.techParts) + toNumber(job.companyParts);

type TipsOptions = {
  includeCheck?: boolean;
  includeCompanyCashBonus?: boolean;
};

export const calcTipsTotal = (job: Partial<JobRow>, opts: TipsOptions = {}) => {
  const { includeCheck = true, includeCompanyCashBonus = true } = opts;
  return (
    toNumber(job.tipsCard) * 0.95 +
    toNumber(job.tipsFinance) * 0.9 +
    toNumber(job.tipsCompanyCash) * 0.9 +
    (includeCheck ? toNumber(job.tipsCheck) * 0.9 : 0) +
    (includeCompanyCashBonus ? toNumber(job.tipsCompanyCash) : 0)
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

export const calcTechShare = (netoTips: number, amount: number, totalProfit: number, techProfitPercent: number) => {
  const nTips = toNumber(netoTips);
  const amt = toNumber(amount);
  const profit = toNumber(totalProfit);
  const pct = toNumber(techProfitPercent);

  if (nTips > amt) {
    return amt;
  } else {
    if (amt > profit) {
      return (profit * pct / 100) + nTips + (amt - profit);
    } else {
      return (profit * pct / 100) + nTips;
    }
  }
};

export const calcProviderShare = (netoTips: number, amount: number, totalProfit: number, providerPercent: number) => {
  const nTips = toNumber(netoTips);
  const amt = toNumber(amount);
  const profit = toNumber(totalProfit);
  const pct = toNumber(providerPercent);

  const base = amt > profit ? (profit - nTips) : (amt - nTips);
  const result = (base * pct) / 100;
  return Math.max(0, result);
};

export const calcFinalBalance = (shareAmount: number, techParts: number, techPaidCash: number) => {
  return toNumber(shareAmount) + toNumber(techParts) - toNumber(techPaidCash);
};

// ─────────────────────────────────────────────────────────────────────────────
// LM (Location Manager) extension — STRICTLY isolated from Company↔Tech math.
//
// Three independent settlement views (locked with user 2026-05-07):
//   View 1 — Company ↔ Tech: uses ORIGINAL helpers above. LM fields play
//            zero role. The displayed Tech balance is byte-identical to
//            baseline regardless of LM data on the job.
//   View 2 — Tech ↔ LM: per job = lmParts. Tech owes LM. Never combined
//            with View 1.
//   View 3 — LM ↔ Company: per job = lmCash + lmCheck. LM owes Company,
//            externally collected revenue not yet remitted. Never combined
//            with View 1 (does NOT enter calcPaidSum / calcTotalAfterFee /
//            tech share / company profit).
//
// Per-job pure-LM accounting helpers below. There are deliberately NO
// `*WithLm` wrappers — the original revenue functions must not be combined
// with LM money under any circumstance.
// ─────────────────────────────────────────────────────────────────────────────

export const calcLmRevenue = (job: Partial<JobRow>) =>
  toNumber(job.lmCash) + toNumber(job.lmCheck);

export const calcLmCheckFee = (job: Partial<JobRow>) =>
  toNumber(job.lmCheck) * 0.1;

export const calcTechOwedToLm = (job: Partial<JobRow>) => toNumber(job.lmParts);
export const calcLmOwedFromTech = (job: Partial<JobRow>) => toNumber(job.lmParts);
export const calcLmOwesCompany = (job: Partial<JobRow>) =>
  toNumber(job.lmCash) + toNumber(job.lmCheck);
export const calcCompanyReceivableFromLm = (job: Partial<JobRow>) =>
  calcLmOwesCompany(job);
