// Maps a CRM job + a dispute/refund into the full allocation, using the
// authoritative engine (src/lib/dispute-share.ts → computeDisputeAllocation).
//
// Field mapping (verified against the existing job calculations):
//   jobAmount (excl tip) = totalAmount   (falls back to the payment buckets;
//                          totalAmount is stored BEFORE tip)
//   grossTip             = tipsCard + tipsFinance + tipsCompanyCash + tipsCheck
//   partsCost            = techParts + companyParts + lmParts
//
// The AM ledger charge = technicianPortion + areaManagerOwnPortion. The report
// shows every party (provider/tech/AM-own/company) + parts loss.

import type { JobRow } from "@/types/job";
import { computeDisputeAllocation, type DisputeType } from "./dispute-share.ts";

const n = (v: unknown): number => {
  if (v == null || v === "") return 0;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};

export type DisputeKind = "dispute" | "refund";

export type JobDisputeInputs = {
  /** Job Amount, excluding tip. */
  jobAmount: number;
  /** Gross tip. */
  grossTip: number;
  /** Consolidated parts cost. */
  partsCost: number;
  sources: {
    jobAmount: "totalAmount" | "paymentBuckets";
    grossTip: "tipsCard+tipsFinance+tipsCompanyCash+tipsCheck";
    partsCost: "techParts+companyParts+lmParts";
  };
};

/** Derive Job Amount (excl tip) / gross tip / parts from a job row. */
export function jobDisputeInputs(job: Partial<JobRow>): JobDisputeInputs {
  const grossTip =
    n(job.tipsCard) + n(job.tipsFinance) + n(job.tipsCompanyCash) + n(job.tipsCheck);
  const partsCost = n(job.techParts) + n(job.companyParts) + n(job.lmParts);

  const totalAmount = n(job.totalAmount);
  let jobAmount: number;
  let jobSource: JobDisputeInputs["sources"]["jobAmount"];
  if (totalAmount > 0) {
    jobAmount = totalAmount;
    jobSource = "totalAmount";
  } else {
    jobAmount =
      n(job.totalPaidCard) + n(job.totalPaidCompanyCheck) + n(job.totalPaidFinance) +
      n(job.totalPaidCompanyCash) + n(job.techPaidCash) + n(job.lmCash) + n(job.lmCheck);
    jobSource = "paymentBuckets";
  }

  return {
    jobAmount,
    grossTip,
    partsCost,
    sources: {
      jobAmount: jobSource,
      grossTip: "tipsCard+tipsFinance+tipsCompanyCash+tipsCheck",
      partsCost: "techParts+companyParts+lmParts",
    },
  };
}

export type ComputeDisputeChargeInput = {
  job: Partial<JobRow>;
  disputeAmount: number;
  type: DisputeKind;
  technicianPercent: number;
  providerPercent: number;
  areaManagerPoolPercent: number;
  cardFeePercent?: number;
  sourceJobId?: string;
  sourceRecordId?: string;
};

/** Complete calculation snapshot stored on the dispute/refund + ledger entry. */
export type DisputeChargeSnapshot = {
  type: DisputeKind;
  // Inputs / derived (report + audit).
  jobAmount: number;
  grossTip: number;
  netTip: number;
  netJob: number;
  totalCollected: number;
  partsCost: number;
  operationalProfit: number;
  disputeOrRefundAmount: number;
  cardFeePercent: number;
  technicianPercent: number;
  providerPercent: number;
  areaManagerPoolPercent: number;
  companyPercent: number;
  // Recovery + classification.
  tipRecovered: number;
  operationalRecovered: number;
  partsLoss: number;
  reachesParts: boolean;
  disputeClassification: DisputeType;
  // Party charges.
  providerCharge: number;
  technicianPortion: number;
  areaManagerOwnPortion: number;
  companyCharge: number;
  /** Posted to the AM ledger = technicianPortion + areaManagerOwnPortion. */
  amLedgerCharge: number;
  // Provenance.
  sourceJobId: string | null;
  sourceDisputeOrRefundId: string | null;
  inputSources: JobDisputeInputs["sources"];
  computedAt: string;
};

export function computeDisputeCharge(input: ComputeDisputeChargeInput): DisputeChargeSnapshot {
  const cardFeePercent = input.cardFeePercent ?? 5;
  const { jobAmount, grossTip, partsCost, sources } = jobDisputeInputs(input.job);

  const a = computeDisputeAllocation({
    jobAmount,
    grossTip,
    partsCost,
    disputeAmount: input.disputeAmount,
    technicianPercent: input.technicianPercent,
    providerPercent: input.providerPercent,
    areaManagerPoolPercent: input.areaManagerPoolPercent,
    cardFeePercent,
  });

  return {
    type: input.type,
    jobAmount,
    grossTip,
    netTip: a.netTip,
    netJob: a.netJob,
    totalCollected: a.totalCollected,
    partsCost,
    operationalProfit: a.operationalProfit,
    disputeOrRefundAmount: input.disputeAmount,
    cardFeePercent,
    technicianPercent: input.technicianPercent,
    providerPercent: input.providerPercent,
    areaManagerPoolPercent: input.areaManagerPoolPercent,
    companyPercent: a.companyPercent,
    tipRecovered: a.tipRecovered,
    operationalRecovered: a.operationalRecovered,
    partsLoss: a.partsLoss,
    reachesParts: a.reachesParts,
    disputeClassification: a.disputeType,
    providerCharge: a.providerCharge,
    technicianPortion: a.technicianPortion,
    areaManagerOwnPortion: a.areaManagerOwnPortion,
    companyCharge: a.companyCharge,
    amLedgerCharge: a.amLedgerCharge,
    sourceJobId: input.sourceJobId ?? null,
    sourceDisputeOrRefundId: input.sourceRecordId ?? null,
    inputSources: sources,
    computedAt: new Date().toISOString(),
  };
}
