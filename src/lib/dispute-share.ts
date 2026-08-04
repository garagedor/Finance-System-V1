// Dispute / refund cost-share calculation.
//
// This is the authoritative business logic, transcribed from the owner's Google
// Sheet (the app's previous `gross × pct` formula was incorrect and is replaced
// by this). It computes how much of a disputed/refunded charge a given party
// (at a given profit-share %) is liable for.
//
// Original spreadsheet formula (40% Area-Manager column), where
//   G = total job amount incl. tip, H = disputed amount, I = parts cost,
//   J = tip amount, 0.95 = net after 5% card fee, 0.4 = share:
//
//   =IF( H >= (G-J),
//        (G*0.95 - I - J)*0.4 + I + J,
//        IF( H < J,
//            H,
//            (H-J)*0.4 + J*0.95 ) )
//
// Rounding rule: intermediate values are NOT rounded (to match Google Sheets);
// only the final result is rounded to two decimals.

export type DisputeShareInput = {
  /** G — total job amount, including tip. */
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

/** Which branch of the spreadsheet formula produced the result. */
export type DisputeShareBranch = "full_or_large" | "below_tip" | "partial_above_tip";

export type DisputeShareResult = {
  /** Final liability, rounded to two decimals. */
  amount: number;
  branch: DisputeShareBranch;
  /** Echo of the effective rates used, for the stored calculation snapshot. */
  shareRate: number;
  cardNetRate: number;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Full result incl. which branch ran + the rates used — used for snapshots/UI. */
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

  let amount: number;
  let branch: DisputeShareBranch;

  if (disputeAmount >= totalCharge - tipAmount) {
    // Case 1 — full or large dispute: card fee applied to the whole charge,
    // parts + tip removed before the % then added back in full.
    amount = (totalCharge * cardNetRate - partsCost - tipAmount) * shareRate + partsCost + tipAmount;
    branch = "full_or_large";
  } else if (disputeAmount < tipAmount) {
    // Case 2 — dispute smaller than the tip: the whole dispute is assigned.
    amount = disputeAmount;
    branch = "below_tip";
  } else {
    // Case 3 — partial dispute above the tip: % of (dispute − tip), plus 95% of
    // the tip (the 5% card fee on the tip is not recovered).
    amount = (disputeAmount - tipAmount) * shareRate + tipAmount * cardNetRate;
    branch = "partial_above_tip";
  }

  return { amount: round2(amount), branch, shareRate, cardNetRate };
}

/** The party's dispute/refund liability, rounded to two decimals. */
export function calculateDisputeShare(input: DisputeShareInput): number {
  return disputeShareDetailed(input).amount;
}
