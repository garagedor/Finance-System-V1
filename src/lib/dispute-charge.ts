// Turns a CRM job + a dispute/refund amount into the full charge breakdown,
// using the authoritative dispute-share engine (src/lib/dispute-share.ts).
//
// Field mapping (verified against the existing job calculations 2026-08-05):
//   totalCharge (G) = totalAmount + tips        (totalAmount is BEFORE tip;
//                     falls back to the payment-method buckets if totalAmount
//                     is missing — see api/refunds/route.ts jobTotal())
//   partsCost  (I) = techParts + companyParts + lmParts   (all real parts costs)
//   tipAmount  (J) = tipsCard + tipsFinance + tipsCompanyCash + tipsCheck
//
// The Area Manager charge is the amount actually posted to the AM's ledger.
// The technician figure is INFORMATIONAL only (same formula, tech's %), so the
// AM can see how much of the loss should be charged internally to the tech.
// Provider is intentionally NOT computed here (awaiting its own sheet formula).

import type { JobRow } from "@/types/job";
import { calculateDisputeShare, disputeShareDetailed, type DisputeShareBranch } from "./dispute-share.ts";

const n = (v: unknown): number => {
  if (v == null || v === "") return 0;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};

export type DisputeType = "dispute" | "refund";

export type JobDisputeInputs = {
  /** G — total job amount including tip. */
  totalCharge: number;
  /** I — consolidated parts cost. */
  partsCost: number;
  /** J — consolidated tip. */
  tipAmount: number;
  /** Audit: how each consolidated input was derived. */
  sources: {
    totalCharge: "totalAmount+tips" | "paymentBuckets+tips";
    partsCost: "techParts+companyParts+lmParts";
    tipAmount: "tipsCard+tipsFinance+tipsCompanyCash+tipsCheck";
  };
};

/** Derive the Sheet's total-incl-tip / parts / tip inputs from a job row. */
export function jobDisputeInputs(job: Partial<JobRow>): JobDisputeInputs {
  const tipAmount =
    n(job.tipsCard) + n(job.tipsFinance) + n(job.tipsCompanyCash) + n(job.tipsCheck);
  const partsCost = n(job.techParts) + n(job.companyParts) + n(job.lmParts);

  const totalAmount = n(job.totalAmount);
  let base: number;
  let totalSource: JobDisputeInputs["sources"]["totalCharge"];
  if (totalAmount > 0) {
    base = totalAmount;
    totalSource = "totalAmount+tips";
  } else {
    // Fallback matches api/refunds jobTotal(): payment buckets, before tip.
    base =
      n(job.totalPaidCard) + n(job.totalPaidCompanyCheck) + n(job.totalPaidFinance) +
      n(job.totalPaidCompanyCash) + n(job.techPaidCash) + n(job.lmCash) + n(job.lmCheck);
    totalSource = "paymentBuckets+tips";
  }

  return {
    totalCharge: base + tipAmount,
    partsCost,
    tipAmount,
    sources: {
      totalCharge: totalSource,
      partsCost: "techParts+companyParts+lmParts",
      tipAmount: "tipsCard+tipsFinance+tipsCompanyCash+tipsCheck",
    },
  };
}

export type ComputeDisputeChargeInput = {
  job: Partial<JobRow>;
  disputeAmount: number;
  type: DisputeType;
  /** Area Manager share % — Location.managerProfitPercent (normally 40). */
  areaManagerPercent: number;
  /** Technician effective % — finance override dispute_pct ?? Technician.profitPercent. */
  technicianEffectivePercent: number;
  cardFeePercent?: number;
  sourceJobId?: string;
  sourceRecordId?: string;
};

/** The complete calculation snapshot to store on the dispute/refund + ledger. */
export type DisputeChargeSnapshot = {
  type: DisputeType;
  totalCharge: number;
  disputeOrRefundAmount: number;
  partsCost: number;
  tipAmount: number;
  cardFeePercent: number;
  areaManagerPercent: number;
  technicianEffectivePercent: number;
  /** The amount actually posted to the Area Manager ledger. */
  areaManagerCharge: number;
  /** Informational — the technician's share, same formula, tech %. */
  technicianChargebackInfo: number;
  /** areaManagerCharge − technicianChargebackInfo. */
  areaManagerOwnPortionInfo: number;
  calculationBranch: DisputeShareBranch;
  sourceJobId: string | null;
  sourceDisputeOrRefundId: string | null;
  inputSources: JobDisputeInputs["sources"];
  computedAt: string;
};

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Compute the AM charge + technician informational figure + full snapshot. */
export function computeDisputeCharge(input: ComputeDisputeChargeInput): DisputeChargeSnapshot {
  const cardFeePercent = input.cardFeePercent ?? 5;
  const { totalCharge, partsCost, tipAmount, sources } = jobDisputeInputs(input.job);

  const shared = {
    totalCharge,
    disputeAmount: input.disputeAmount,
    partsCost,
    tipAmount,
    cardFeePercent,
  };

  const am = disputeShareDetailed({ ...shared, sharePercent: input.areaManagerPercent });
  const areaManagerCharge = am.amount;
  // Technician figure — SAME formula, run independently with the tech's %.
  const technicianChargebackInfo = calculateDisputeShare({
    ...shared,
    sharePercent: input.technicianEffectivePercent,
  });

  return {
    type: input.type,
    totalCharge,
    disputeOrRefundAmount: input.disputeAmount,
    partsCost,
    tipAmount,
    cardFeePercent,
    areaManagerPercent: input.areaManagerPercent,
    technicianEffectivePercent: input.technicianEffectivePercent,
    areaManagerCharge,
    technicianChargebackInfo,
    areaManagerOwnPortionInfo: round2(areaManagerCharge - technicianChargebackInfo),
    calculationBranch: am.branch,
    sourceJobId: input.sourceJobId ?? null,
    sourceDisputeOrRefundId: input.sourceRecordId ?? null,
    inputSources: sources,
    computedAt: new Date().toISOString(),
  };
}
