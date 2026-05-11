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

export const calcPaymentFee = (job: Partial<JobRow>) =>
  toNumber(job.totalPaidCard) * 0.05 +
  toNumber(job.totalPaidFinance) * 0.1 +
  toNumber(job.totalPaidCompanyCheck) * 0.1 +
  toNumber(job.lmCheck) * 0.1;

// lmCheck fee is included here too — per business rule (2026-05-07): lmCheck
// must always carry the 10% check fee, even in variants that exclude
// companyCheck fee. (companyCheck/no-check inconsistency is a pre-existing
// bug not fixed in this scope.)
export const calcPaymentFeeNoCheck = (job: Partial<JobRow>) =>
  toNumber(job.totalPaidCard) * 0.05 +
  toNumber(job.totalPaidFinance) * 0.1 +
  toNumber(job.lmCheck) * 0.1;

export const calcTotalAfterFee = (job: Partial<JobRow>) =>
  toNumber(job.totalPaidCard) * 0.95 +
  toNumber(job.totalPaidFinance) * 0.9 +
  toNumber(job.totalPaidCompanyCheck) * 0.9 +
  toNumber(job.techPaidCash) +
  toNumber(job.totalPaidCompanyCash) +
  toNumber(job.lmCash) +
  toNumber(job.lmCheck) * 0.9;

export const calcParts = (job: Partial<JobRow>) =>
  toNumber(job.techParts) + toNumber(job.companyParts) + toNumber(job.lmParts);

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
// LM (Location Manager) extension — accounting model (locked 2026-05-07).
//
// Recognition (in the original revenue/cost helpers above):
//   - lmCash and lmCheck ARE recognized job revenue. They flow into
//     calcPaidSum and calcTotalAfterFee like any other payment method.
//     lmCheck always carries a 10% fee in BOTH calcPaymentFee and
//     calcPaymentFeeNoCheck (no exceptions, even where companyCheck fee
//     is excluded for legacy reasons).
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

export const calcLmCheckFee = (job: Partial<JobRow>) =>
  toNumber(job.lmCheck) * 0.1;

export const calcLmOwesCompany = (job: Partial<JobRow>) =>
  toNumber(job.lmCash) + toNumber(job.lmCheck);
export const calcCompanyReceivableFromLm = (job: Partial<JobRow>) =>
  calcLmOwesCompany(job);
