// Dispute / refund cost-share calculation.
//
// Authoritative business logic from the owner's Google Sheet (replaces the app's
// earlier incorrect `gross × pct`). Computes how much of a disputed/refunded
// charge a given party (at a given profit-share %) is liable for.
//
// Classification (corrected): there are only TWO business dispute types —
//   • FULL     — the entire amount COLLECTED from the customer is disputed
//                (collected = job amount + tip = totalCharge). i.e.
//                disputeAmount >= collectedAmount.
//   • PARTIAL  — disputeAmount < collectedAmount. The tip is recovered first.
//
// The tip does NOT create a third type. A PARTIAL dispute first recovers the
// NET tip the technician actually received (netTip = tip × cardNet, 100% of it);
// any dispute amount ABOVE the net tip is treated as a JOB dispute and allocated
// by the party's %. Two audit sub-branches (both display/report as "Partial"):
//   • partial_within_tip — disputeAmount <= netTip → charge = disputeAmount
//   • partial_above_tip  — disputeAmount >  netTip →
//                          netTip + (disputeAmount − netTip) × share
// The card fee is NOT distributed separately — the excess above the net tip
// simply follows the normal percentage allocation.
//
// FULL charge (card fee on the whole charge; parts + tip removed before the %,
// then added back in full):
//   (totalCharge × cardNet − parts − tip) × share + parts + tip
//
// Rounding: intermediates are NOT rounded (to match Google Sheets); only the
// final result is rounded to two decimals.

export type DisputeShareInput = {
  /** G — total job amount, including tip. This IS the "collected" amount. */
  totalCharge: number;
  /** H — the disputed / refunded amount. */
  disputeAmount: number;
  /** I — parts cost. */
  partsCost: number;
  /** J — tip amount. */
  tipAmount: number;
  /** The party's share percentage (e.g. 40 for an Area Manager, or the tech's %). */
  sharePercent: number;
  /** Card processing fee percentage. Default 5 (→ 0.95 net). */
  cardFeePercent?: number;
};

/** Business classification (UI/report). */
export type DisputeType = "full" | "partial";

/** Audit sub-branch. Both partial_* report as "partial". */
export type DisputeShareBranch = "full" | "partial_within_tip" | "partial_above_tip";

export type DisputeShareResult = {
  /** Final liability, rounded to two decimals. */
  amount: number;
  /** Business type shown in UI/report. */
  disputeType: DisputeType;
  /** Audit sub-branch. */
  branch: DisputeShareBranch;
  /** Echo of the effective rates used, for the stored calculation snapshot. */
  shareRate: number;
  cardNetRate: number;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Full result incl. type + branch + the rates used — used for snapshots/UI. */
export function disputeShareDetailed({
  totalCharge,
  disputeAmount,
  partsCost,
  tipAmount,
  sharePercent,
  cardFeePercent = 5,
}: DisputeShareInput): DisputeShareResult {
  const shareRate = sharePercent / 100;
  const cardNetRate = 1 - cardFeePercent / 100;
  // The amount actually collected from the customer = job amount + tip.
  const collectedAmount = totalCharge;

  let amount: number;
  let branch: DisputeShareBranch;
  let disputeType: DisputeType;

  if (disputeAmount >= collectedAmount) {
    // FULL — the whole collected amount is disputed.
    amount = (totalCharge * cardNetRate - partsCost - tipAmount) * shareRate + partsCost + tipAmount;
    branch = "full";
    disputeType = "full";
  } else {
    // PARTIAL — recover the NET tip the technician actually received first, then
    // allocate any excess above the net tip by the party's %.
    const netTip = tipAmount * cardNetRate;
    const recoveredTip = Math.min(disputeAmount, netTip);
    const remaining = Math.max(0, disputeAmount - netTip);
    amount = recoveredTip + remaining * shareRate;
    branch = disputeAmount <= netTip ? "partial_within_tip" : "partial_above_tip";
    disputeType = "partial";
  }

  return { amount: round2(amount), disputeType, branch, shareRate, cardNetRate };
}

/** The party's dispute/refund liability, rounded to two decimals. */
export function calculateDisputeShare(input: DisputeShareInput): number {
  return disputeShareDetailed(input).amount;
}
