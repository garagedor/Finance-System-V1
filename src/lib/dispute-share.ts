// Dispute / refund allocation engine — the SINGLE SOURCE OF TRUTH.
//
// (Supersedes every earlier dispute formula in this project. Spec: the owner's
// "Final Dispute & Refund Calculation Specification".)
//
// Model
// ─────
// A job has a Job Amount (excl tip) and a Gross Tip. A 5% card fee is deducted
// from BOTH:  netJob = job × 0.95,  netTip = tip × 0.95. The technician actually
// receives the NET tip. Operational Profit comes only from the job:
//   operationalProfit = netJob − parts
//
// Operational Profit is split by percentage:
//   Provider = provider%,  Area-Manager pool = 40% (Tech% inside it, AM-own =
//   40% − Tech%),  Company = the residual (100 − provider% − 40%).
//
// A dispute is FULL when disputeAmount >= totalCollected (job + gross tip),
// otherwise PARTIAL. Every dispute recovers in this order:
//   1. the NET tip (100% technician side),
//   2. Operational Profit (split by the percentages),
//   3. Parts loss — the excess that eats into parts — which is 100% the
//      TECHNICIAN's, never shared with provider / AM / company.
//
// AM Ledger charge (what the company settles with the AM) = Technician Portion
// + Area-Manager Own Portion. Only final values are rounded to two decimals.

export type DisputeType = "full" | "partial";

export type DisputeAllocationInput = {
  /** Job Amount, EXCLUDING tip. */
  jobAmount: number;
  /** Gross tip (before card fee). */
  grossTip: number;
  /** Parts cost. */
  partsCost: number;
  /** Dispute / refund amount. */
  disputeAmount: number;
  /** Technician % (0–100) — override dispute_pct ?? Technician.profitPercent. */
  technicianPercent: number;
  /** Provider % (0–100) — Provider.profitPercent. */
  providerPercent: number;
  /** Area-Manager pool % (0–100) — Location.managerProfitPercent (normally 40). */
  areaManagerPoolPercent: number;
  /** Card processing fee % (default 5). */
  cardFeePercent?: number;
};

export type DisputeAllocation = {
  // Derived amounts (for the report + audit snapshot).
  netTip: number;
  netJob: number;
  totalCollected: number;
  operationalProfit: number;
  // Recovery breakdown.
  tipRecovered: number;
  operationalRecovered: number;
  partsLoss: number;
  reachesParts: boolean;
  disputeType: DisputeType;
  companyPercent: number;
  // Party charges (rounded).
  providerCharge: number;
  technicianPortion: number;
  areaManagerOwnPortion: number;
  companyCharge: number;
  /** The amount posted to the AM ledger = technicianPortion + areaManagerOwnPortion. */
  amLedgerCharge: number;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function computeDisputeAllocation(i: DisputeAllocationInput): DisputeAllocation {
  const cardNet = 1 - (i.cardFeePercent ?? 5) / 100;

  const netTip = i.grossTip * cardNet;
  const netJob = i.jobAmount * cardNet;
  const operationalProfit = Math.max(0, netJob - i.partsCost);
  const totalCollected = i.jobAmount + i.grossTip;
  const disputeType: DisputeType = i.disputeAmount >= totalCollected ? "full" : "partial";

  // Recover net tip → operational profit → parts loss, in that order.
  const tipRecovered = Math.min(i.disputeAmount, netTip);
  const remaining = Math.max(0, i.disputeAmount - netTip);
  const operationalRecovered = Math.min(remaining, operationalProfit);
  const partsLoss = Math.min(Math.max(0, remaining - operationalProfit), i.partsCost);

  const techRate = i.technicianPercent / 100;
  const providerRate = i.providerPercent / 100;
  const amPoolRate = i.areaManagerPoolPercent / 100;
  const companyPercent = Math.max(0, 100 - i.providerPercent - i.areaManagerPoolPercent);
  const companyRate = companyPercent / 100;

  // Provider / company only touch operational profit. Parts loss is 100% tech.
  const providerCharge = operationalRecovered * providerRate;
  const technicianPortion = tipRecovered + operationalRecovered * techRate + partsLoss;
  const areaManagerOwnPortion = operationalRecovered * (amPoolRate - techRate);
  const companyCharge = operationalRecovered * companyRate;
  const amLedgerCharge = technicianPortion + areaManagerOwnPortion;

  return {
    netTip: round2(netTip),
    netJob: round2(netJob),
    totalCollected: round2(totalCollected),
    operationalProfit: round2(operationalProfit),
    tipRecovered: round2(tipRecovered),
    operationalRecovered: round2(operationalRecovered),
    partsLoss: round2(partsLoss),
    reachesParts: partsLoss > 0,
    disputeType,
    companyPercent,
    providerCharge: round2(providerCharge),
    technicianPortion: round2(technicianPortion),
    areaManagerOwnPortion: round2(areaManagerOwnPortion),
    companyCharge: round2(companyCharge),
    amLedgerCharge: round2(amLedgerCharge),
  };
}
