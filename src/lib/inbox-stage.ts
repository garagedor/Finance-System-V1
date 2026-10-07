/* ═══════════════════════════════════════════════════════════════════════════
   The Disputes & Refunds inbox pipeline — ONE classifier.

   A ScanPay record (dispute or refund) carries a single `matchStatus`, and that
   field alone already describes where the record sits in the operating flow:

     new       imported from ScanPay, no job attached
     matched   auto-matched on invoice number — a GUESS, still needs a human
     verified  a human picked/confirmed the job (Pick job → Verify)
     posted    posted to a ledger            ← terminal
     ignored   parked                        ← terminal

   The pipeline reads left to right:

     Needs action  ──Pick job──▶  Refunds / Disputes  ──Post──▶   Posted
                                                      ──Ignore──▶ Ignored

   Everything about tab membership derives from the one table below: the rows a
   tab queries, and the number printed on that tab. There is deliberately no
   second implementation to drift from the first.

   The five statuses partition exactly — every record lands in one stage, never
   two and never none. `inbox-stage.test.ts` proves that by enumeration.
   ═══════════════════════════════════════════════════════════════════════════ */

import type { ScanpayMatchStatus } from "@/types/scanpay";

/** The five tabs, in pipeline order. */
export type InboxStage = "action" | "refunds" | "disputes" | "posted" | "ignored";

/** Which collection a record came from. Only splits the active queue in two. */
export type InboxKind = "refund" | "dispute";

export const INBOX_STAGES: readonly InboxStage[] = [
  "action", "refunds", "disputes", "posted", "ignored",
] as const;

/**
 * The statuses each stage owns.
 *
 * `refunds` and `disputes` hold the same status — they are one stage split by
 * kind, which is why they share `verified` without overlapping.
 *
 * Terminal states come first in intent: a posted or ignored record is OUT of
 * the active queue no matter what else is true of it.
 */
export const STAGE_STATUSES: Record<InboxStage, readonly ScanpayMatchStatus[]> = {
  ignored: ["ignored"],
  posted: ["posted"],
  action: ["new", "matched"],
  refunds: ["verified"],
  disputes: ["verified"],
};

/** True when this stage is the active processing queue for that kind. */
function stageKind(stage: InboxStage): InboxKind | null {
  return stage === "refunds" ? "refund" : stage === "disputes" ? "dispute" : null;
}

/**
 * The one classifier. Given a record's status and which collection it came
 * from, return the single tab it belongs to.
 *
 * Priority is the point: terminal states win over the active queue, and the
 * active queue is only reachable once a human has verified the job match.
 */
export function stageOf(matchStatus: ScanpayMatchStatus, kind: InboxKind): InboxStage {
  if (matchStatus === "ignored") return "ignored";
  if (matchStatus === "posted") return "posted";
  if (matchStatus === "new" || matchStatus === "matched") return "action";
  return kind === "refund" ? "refunds" : "disputes";
}

/**
 * The Mongo filter for a stage, built from the same table the classifier uses.
 *
 * Returns null when the stage does not apply to that collection at all — the
 * Refunds tab asks nothing of the disputes collection, and vice versa — so the
 * caller skips the query rather than filtering an answer away afterwards.
 */
export function stageFilter(
  stage: InboxStage,
  kind: InboxKind,
): { matchStatus: { $in: string[] } } | null {
  const only = stageKind(stage);
  if (only !== null && only !== kind) return null;
  return { matchStatus: { $in: [...STAGE_STATUSES[stage]] } };
}

/** Human label for a stage. Used by the tabs and the card shell heading. */
export const STAGE_LABEL: Record<InboxStage, string> = {
  action: "Needs action",
  refunds: "Refunds",
  disputes: "Disputes",
  posted: "Posted",
  ignored: "Ignored",
};

/** Stages that span both collections, and so offer the Both/Refunds/Disputes
 *  sub-filter. The two active queues are already one kind each. */
export function isMixedStage(stage: InboxStage): boolean {
  return stageKind(stage) === null;
}

/** Narrow an arbitrary query value to a stage, defaulting to the queue head. */
export function parseStage(v: unknown): InboxStage {
  return INBOX_STAGES.includes(v as InboxStage) ? (v as InboxStage) : "action";
}
