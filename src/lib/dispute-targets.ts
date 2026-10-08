/* ═══════════════════════════════════════════════════════════════════════════
   Dispute / refund ledger targets — the ONE canonical posting model.

   A dispute is not settled with one party. The allocation engine
   (lib/dispute-share) already splits every loss four ways, and each slice may
   be charged to a different ledger: the Area Manager's, the technician's, the
   provider's. "Posted" therefore means *at least one* ledger posting exists —
   never "no further posting is allowed".

   Nothing here is invented. The four targets are exactly the `party` values
   lib/dispute-service already accepts, and each amount is the slice that
   service already posts. This module names them, says which are eligible,
   says which collide, and derives what has actually been posted from the
   ledger entries themselves.

   TWO RULES SHAPE EVERYTHING BELOW.

   1. Coverage is DERIVED, never stored. There is no `providerPosted: true`
      flag anywhere. A target reads as posted because a finance_ledger_entry
      exists for it, which means a posting made from the Provider Ledger
      screen counts exactly as much as one made from the inbox — the UI has
      no privileged knowledge of what it did itself.

   2. `combined` overlaps. It is AM-own + technician charged as one line, so
      it cannot coexist with either of them. That is a property of the locked
      formula (amLedgerCharge = technicianPortion + areaManagerOwnPortion),
      not a rule this module adds, and it is the one way a careless second
      posting could double-charge somebody.

   Pure. No database, no session, no I/O — so the rules can be enumerated in
   tests rather than reasoned about.
   ═══════════════════════════════════════════════════════════════════════════ */

import type { DisputeChargeSnapshot } from "./dispute-charge.ts";

/** The parties a dispute/refund slice can be charged to. Mirrors the
 *  `party` union lib/dispute-service has accepted since 2026-09-11. */
export const POSTING_TARGETS = ["combined", "area_manager", "technician", "provider"] as const;
export type PostingTarget = (typeof POSTING_TARGETS)[number];

export const TARGET_LABEL: Record<PostingTarget, string> = {
  combined: "AM + Technician",
  area_manager: "Area Manager",
  technician: "Technician",
  provider: "Provider",
};

/** Longer form, for the places that explain rather than label. */
export const TARGET_DESCRIPTION: Record<PostingTarget, string> = {
  combined: "The full Area-Manager ledger charge — the AM's own portion and the technician's, as one line.",
  area_manager: "The Area Manager's own portion, without the technician's.",
  technician: "The technician's portion: the recovered net tip, their share of operational profit, and all of the parts loss.",
  provider: "The provider's share of the recovered operational profit.",
};

/**
 * Which targets a posting consumes.
 *
 * Only `combined` covers more than itself, and it does so because its amount
 * IS the sum of the other two. Posting it and then posting the technician
 * slice would charge the technician twice.
 */
const COVERS: Record<PostingTarget, readonly PostingTarget[]> = {
  combined: ["combined", "area_manager", "technician"],
  area_manager: ["area_manager"],
  technician: ["technician"],
  provider: ["provider"],
};

/** True when posting `posted` already accounts for `target`. */
export function covers(posted: PostingTarget, target: PostingTarget): boolean {
  return COVERS[posted].includes(target);
}

/**
 * Company is deliberately absent from the target list.
 *
 * `companyCharge` is computed by the engine and shown on the report, but the
 * company does not hold a ledger it charges itself through — the loss simply
 * sits with it. Adding a "company" target would invent a financial flow that
 * does not exist.
 */
export const COMPANY_IS_INFORMATIONAL = true;

/* ── Amounts ─────────────────────────────────────────────────────────── */

/**
 * The slice a target is charged.
 *
 * This is the single definition. lib/dispute-service posts exactly what this
 * returns, so the amount shown as "what posting the provider would charge"
 * and the amount actually written cannot differ.
 */
export function amountForTarget(
  snapshot: Pick<DisputeChargeSnapshot,
    "technicianPortion" | "areaManagerOwnPortion" | "providerCharge" | "amLedgerCharge">,
  target: PostingTarget,
): number {
  switch (target) {
    case "technician": return snapshot.technicianPortion;
    case "area_manager": return snapshot.areaManagerOwnPortion;
    case "provider": return snapshot.providerCharge;
    case "combined": return snapshot.amLedgerCharge;
  }
}

/* ── What a posted ledger entry looks like to this module ────────────── */

/**
 * The minimum a finance_ledger_entry has to expose to be classified.
 *
 * Structural rather than the full record, so a fixture in a test is the same
 * shape as a document from the collection.
 */
export interface PostedEntryView {
  _id: string;
  ledger_id: string;
  /**
   * Which slice this entry charged.
   *
   * Null on entries written before the field existed. Those were all posted
   * by the Disputes module with no party, which charged `amLedgerCharge` —
   * so null means `combined`. That is a fact about the old code path, not a
   * guess: the service had no other branch.
   */
  posted_party?: PostingTarget | null;
  amount: number;
  date?: string | null;
  created_at?: string;
  ledger_name?: string | null;
  ledger_role?: string | null;
}

/** Null posted_party means the legacy no-party post, which was `combined`. */
export function targetOfEntry(entry: PostedEntryView): PostingTarget {
  const p = entry.posted_party;
  return p && (POSTING_TARGETS as readonly string[]).includes(p) ? p : "combined";
}

/* ── Eligibility ─────────────────────────────────────────────────────── */

/** What the resolver needs to know beyond the money. */
export interface CoverageContext {
  /** Job has a provider on it. Without one there is nobody to charge. */
  hasProvider: boolean;
  /** An Area Manager is assigned to the job's location. */
  hasAreaManager: boolean;
  /** The job names a technician. */
  hasTechnician: boolean;
  /**
   * Targets already charged under a DIFFERENT canonical record for what
   * looks like the same economic dispute.
   *
   * Before multi-target posting existed, charging a second party meant
   * creating a second finance_dispute from a ledger page — so production
   * carries pairs like "AM on disp_A, provider on disp_B" for one job and
   * one amount. Coverage is per record and cannot see the sibling, so
   * without this the Posted tab would cheerfully offer a provider charge
   * that already exists.
   *
   * It only ever BLOCKS. The sibling is not claimed as this record's own
   * posting, because it is not: it belongs to another record, and merging
   * the two is a decision for a person, not an inference.
   */
  chargedElsewhere?: readonly { target: PostingTarget; recordId: string }[];
}

export interface TargetCoverage {
  target: PostingTarget;
  label: string;
  /** The slice this target would be charged, from the locked formula. */
  amount: number;
  /** Could be posted, if nothing already covers it. */
  eligible: boolean;
  /** Why not, when it is not eligible or not available. */
  reason: string | null;
  /** A live (un-reversed) ledger entry exists for it. */
  posted: boolean;
  ledgerId: string | null;
  ledgerEntryId: string | null;
  ledgerName: string | null;
  postedAt: string | null;
  postedAmount: number | null;
  /** Posted, then reversed. Not charged any more, so it may be posted again. */
  reversed: boolean;
  /** Charged under a sibling record for the same job and amount. Blocks, but
   *  is not this record's own posting — see CoverageContext.chargedElsewhere. */
  chargedElsewhere: string | null;
  /** Eligible, not posted, and nothing already covers it. */
  available: boolean;
}

export interface PostingCoverage {
  /** Every target, in a stable order, whatever its state. */
  targets: TargetCoverage[];
  /** At least one live posting exists → the item belongs in Posted. */
  anyPosted: boolean;
  /** Targets still open to a posting. */
  remaining: PostingTarget[];
  /** Sum actually charged across live postings. */
  postedTotal: number;
}

function eligibilityOf(
  target: PostingTarget,
  amount: number,
  ctx: CoverageContext,
): { eligible: boolean; reason: string | null } {
  if (target === "provider" && !ctx.hasProvider) {
    return { eligible: false, reason: "This job has no provider, so there is nobody to charge." };
  }
  if (target === "area_manager" && !ctx.hasAreaManager) {
    return { eligible: false, reason: "No Area Manager is assigned to this job's location." };
  }
  if (target === "technician" && !ctx.hasTechnician) {
    return { eligible: false, reason: "This job names no technician." };
  }
  if (target === "combined" && !ctx.hasAreaManager && !ctx.hasTechnician) {
    return { eligible: false, reason: "Neither an Area Manager nor a technician is resolvable for this job." };
  }
  // A zero slice is not a charge. Posting it would put a $0.00 line on
  // somebody's ledger, which is noise pretending to be a record.
  if (!(amount > 0)) {
    return { eligible: false, reason: "This party's share of the loss is zero." };
  }
  return { eligible: true, reason: null };
}

/**
 * The canonical resolver.
 *
 * Takes the slices (from the locked formula), the ledger entries that already
 * exist for this dispute, and the ids of entries that have been reversed.
 * Returns the state of every target. Nothing is read from a flag.
 */
export function resolveCoverage(args: {
  snapshot: Pick<DisputeChargeSnapshot,
    "technicianPortion" | "areaManagerOwnPortion" | "providerCharge" | "amLedgerCharge">;
  entries: PostedEntryView[];
  /** `_id`s of dispute entries that a reversal entry points at. */
  reversedEntryIds?: readonly string[];
  context: CoverageContext;
}): PostingCoverage {
  const reversed = new Set(args.reversedEntryIds ?? []);
  const live = args.entries.filter((e) => !reversed.has(e._id));
  const dead = args.entries.filter((e) => reversed.has(e._id));

  // Newest live entry wins per target, so re-posting the same target after a
  // correction shows the one that currently stands.
  const liveByTarget = new Map<PostingTarget, PostedEntryView>();
  for (const e of live) {
    const t = targetOfEntry(e);
    const prev = liveByTarget.get(t);
    if (!prev || (e.created_at ?? "") >= (prev.created_at ?? "")) liveByTarget.set(t, e);
  }
  const reversedTargets = new Set(dead.map(targetOfEntry));

  const postedTargets = [...liveByTarget.keys()];

  const targets: TargetCoverage[] = POSTING_TARGETS.map((target) => {
    const amount = amountForTarget(args.snapshot, target);
    const { eligible, reason } = eligibilityOf(target, amount, args.context);
    const own = liveByTarget.get(target) ?? null;

    // Covered by something already posted — `combined` and the two slices it
    // contains are the only pair this can happen to.
    const coveringPost = postedTargets.find((p) => p !== target && covers(p, target)) ?? null;
    const blocksSomethingPosted = postedTargets.find((p) => p !== target && covers(target, p)) ?? null;

    // A sibling record charging this party counts as charged for the purpose
    // of refusing, never for the purpose of claiming it was posted here.
    const sibling = (args.context.chargedElsewhere ?? [])
      .find((c) => covers(c.target, target) || covers(target, c.target)) ?? null;

    const blockedReason =
      coveringPost
        ? `Already charged as part of the ${TARGET_LABEL[coveringPost]} posting.`
        : blocksSomethingPosted
          ? `${TARGET_LABEL[blocksSomethingPosted]} is already posted on its own; posting this would charge it twice.`
          : sibling
            ? `${TARGET_LABEL[sibling.target]} was already charged on a separate record for this job (${sibling.recordId}), from before one dispute could carry several postings. Check that record — charging again here would duplicate it.`
            : null;

    return {
      target,
      label: TARGET_LABEL[target],
      amount,
      eligible,
      reason: reason ?? blockedReason,
      posted: !!own,
      ledgerId: own?.ledger_id ?? null,
      ledgerEntryId: own?._id ?? null,
      ledgerName: own?.ledger_name ?? null,
      postedAt: own?.date ?? own?.created_at ?? null,
      postedAmount: own ? own.amount : null,
      reversed: !own && reversedTargets.has(target),
      chargedElsewhere: sibling?.recordId ?? null,
      available: eligible && !own && !coveringPost && !blocksSomethingPosted && !sibling,
    };
  });

  return {
    targets,
    anyPosted: liveByTarget.size > 0,
    remaining: targets.filter((t) => t.available).map((t) => t.target),
    postedTotal: [...liveByTarget.values()].reduce((sum, e) => sum + e.amount, 0),
  };
}

/* ── The guard the write path uses ───────────────────────────────────── */

export type PostRefusal =
  | { ok: true }
  | { ok: false; code: "already_posted" | "covered" | "conflicts" | "not_eligible" | "charged_elsewhere"; error: string };

/**
 * May this target be posted right now?
 *
 * The same answer the UI renders, so a button that is offered succeeds and a
 * refusal says exactly what is in the way. Called server-side on every write;
 * the UI state is a convenience, never the gate.
 */
export function canPost(coverage: PostingCoverage, target: PostingTarget): PostRefusal {
  const row = coverage.targets.find((t) => t.target === target);
  if (!row) return { ok: false, code: "not_eligible", error: `Unknown target "${target}".` };

  if (row.posted) {
    return {
      ok: false,
      code: "already_posted",
      error: `${TARGET_LABEL[target]} is already posted for this item${row.ledgerEntryId ? ` (entry ${row.ledgerEntryId})` : ""}. Posting again would charge them twice.`,
    };
  }
  if (!row.eligible) {
    return { ok: false, code: "not_eligible", error: row.reason ?? `${TARGET_LABEL[target]} cannot be charged here.` };
  }
  if (!row.available) {
    if (row.chargedElsewhere) {
      return { ok: false, code: "charged_elsewhere", error: row.reason ?? `${TARGET_LABEL[target]} is already charged on another record.` };
    }
    // Eligible and unposted, so the only thing left is an overlap.
    const covered = coverage.targets.some((t) => t.posted && t.target !== target && covers(t.target, target));
    return {
      ok: false,
      code: covered ? "covered" : "conflicts",
      error: row.reason ?? `${TARGET_LABEL[target]} overlaps a posting that already exists.`,
    };
  }
  return { ok: true };
}
