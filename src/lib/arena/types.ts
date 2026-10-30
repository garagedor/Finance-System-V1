/**
 * 317 LIVE ARENA — shared types.
 *
 * Every business rule lives in an `ArenaRules` object stored in the database
 * (see config.ts / config-store.ts). The engine consumes one of these and
 * contains no business constants of its own.
 *
 * Money is held in integer cents (rules) or integer micro-dollars (sums), and
 * rates in integer basis points, so every threshold comparison is exact.
 */

/** Tie-break keys an admin may order. Score is always the primary key and the
 *  competitor id is always the final stable key — neither is configurable. */
export type TieBreakKey = "closingRate" | "avgTicket" | "qualifyingJobs" | "closedJobs";

export interface ArenaRules {
  schemaVersion: 1;
  /** IANA zone the Monday–Sunday week is anchored to (locked per competition). */
  timezone: string;
  eligibility: {
    minQualifyingJobs: number;
    minAvgTicketCents: number;
    /** 4000 = 40.00% */
    minClosingRateBp: number;
  };
  scoring: {
    closingRate: { weight: number; targetBp: number; cap: number };
    avgTicket: { weight: number; targetCents: number; cap: number };
  };
  prizes: {
    /** Amount per prize position, best first. Length = number of positions. */
    positionsCents: number[];
    /** This competition's budget; must not exceed the owner's budget ceiling. */
    budgetCents: number;
  };
  mostImproved: {
    enabled: boolean;
    amountCents: number;
    /** How many completed weeks before this one form the baseline window. */
    baselineWeeks: number;
    /** Minimum weeks in the window that must be valid. */
    minValidWeeks: number;
    /** A baseline week is valid when it has at least this many qualifying jobs. */
    minQualifyingJobsPerWeek: number;
    /** Score points the improvement must strictly exceed. */
    minImprovement: number;
  };
  qualifying: {
    /** Canonical CRM statuses that count toward the qualifying-job minimum. */
    statuses: string[];
  };
  participants: {
    /** When non-empty, only these competitor ids take part. */
    onlyCompetitorIds: string[];
    excludeCompetitorIds: string[];
    excludeLocations: string[];
    /** Admin-chosen English display names, by competitor id. */
    displayNames: Record<string, string>;
  };
  /** Applied after score, in order. */
  tieBreak: TieBreakKey[];
  review: {
    /** Winner approval opens this many days after the Monday that ends the
     *  week, at `approvalOpensLocalTime` in the competition timezone. */
    approvalOpensDaysAfterWeekEnd: number;
    approvalOpensLocalTime: string; // "HH:MM"
  };
  display: {
    showPotentialPrize: boolean;
    showIneligibleMetrics: boolean;
    showPodium: boolean;
    refreshSeconds: number;
  };
}

/** Owner-level settings that bound every competition. */
export interface ArenaSettings {
  budgetCeilingCents: number;
  /** The primary owner account (CRM users._id as string). */
  ownerUserId: string;
  /** Accounts allowed to approve winners. Only the owner can edit this list. */
  approverUserIds: string[];
}

/** A production job reduced to what the Arena needs. No customer data. */
export interface ArenaJob {
  id: string;
  /** Raw `Job.tech` (CRM name). */
  tech: string;
  /** Service date, ISO "YYYY-MM-DD" (parsed exactly like SRC_DATE_EXPR). */
  date: string;
  /** canonicalStatus(Job.status) */
  status: string;
  location: string;
  /** calcJobBalances(job).totalProfit — the Balance Report's own number. */
  profit: number;
  /** Opaque keys used only to group suspected duplicates (hashed contact). */
  dupKeys: string[];
}

export type ExclusionKind = "erroneous_assignment" | "duplicate";

/** An admin decision removing a job from the qualifying-job count ONLY.
 *  Never changes the official Closing Rate or AVG TICKET. */
export interface JobExclusion {
  jobId: string;
  kind: ExclusionKind;
  reason: string;
  by: string;
  at: string;
  revokedAt?: string | null;
}

/** An admin identity decision (Phase 2 UI). */
export interface IdentityOverride {
  crmName: string;
  /** competitor id to attach the name to, or null to block it. */
  competitorId: string | null;
  reason: string;
  by: string;
  at: string;
}

export interface Competitor {
  id: string;
  displayName: string;
  crmNames: string[];
  location: string;
}

export type IdentityIssueKind =
  | "unmapped_name"
  | "name_in_multiple_mappings"
  | "normalized_collision"
  | "normalized_match";

export interface IdentityIssue {
  kind: IdentityIssueKind;
  crmName: string;
  candidates: string[];
  /** true when the name is NOT attributed to anyone until an admin resolves it */
  blocking: boolean;
}

export interface CompetitorMap {
  competitors: Competitor[];
  /** exact CRM name → competitor id (only verified attributions) */
  byCrmName: Map<string, string>;
  issues: IdentityIssue[];
}

/**
 * Weekly Balance account standing of a competitor, as decided OUTSIDE the
 * engine (by the account verifier) and passed in as input:
 *   eligible            active, approved, competing role
 *   pending             signed up, not approved yet
 *   inactive            deactivated, rejected or archived
 *   unmapped            the mapped id is not a Weekly Balance account
 *   not_competing_role  an account whose role cannot compete
 *   unverified          the verifier could not answer (UNRESOLVED: never a
 *                       disqualification, never a reason to move prizes)
 */
export type AccountState = "eligible" | "pending" | "inactive" | "unmapped" | "not_competing_role" | "unverified";

export interface AccountInput {
  state: AccountState;
  /** When the answer was obtained (null when it never was). */
  checkedAt: string | null;
  /** Live phase only: a fresh check failed and the last known answer was used. */
  lastKnown?: boolean;
}

export interface Gate {
  met: boolean;
  actual: number;
  required: number;
}

export interface CompetitorResult {
  competitorId: string;
  displayName: string;
  location: string;
  /** Official CRM denominator: every job assigned in the week, any status. */
  assignedJobs: number;
  closedJobs: number;
  xCloseJobs: number;
  qualifyingJobs: number;
  excludedFromQualifying: number;
  /** Σ profit of non-X-close jobs, micro-dollars (exact). */
  profitMicro: number;
  closingRate: number;
  avgTicket: number;
  closingIndex: number;
  avgIndex: number;
  score: number;
  gates: { jobs: Gate; avgTicket: Gate; closingRate: Gate };
  /** All three performance gates met (unchanged by the account rule). */
  eligible: boolean;
  /** The Weekly Balance account standing this result was computed with. */
  account: AccountInput;
  /** May hold a prize: performance-eligible AND the account is not excluded.
   *  An `unverified` account keeps its place (unresolved, never redistributed). */
  prizeEligible: boolean;
  /** 1-based rank among all participants (score, tie-break, id). */
  rank: number;
  prizePosition: number | null;
  prizeCents: number;
  mostImproved: { baselineScore: number; improvement: number; validWeeks: number } | null;
  wonMostImproved: boolean;
  jobIds: string[];
}

export interface DuplicateGroup {
  key: string;
  competitorId: string | null;
  jobIds: string[];
  /** Resolution is required before approval when this is true. */
  mayAffectPrizes: boolean;
}

export interface CompetitionResult {
  weekStart: string;
  rulesHash: string;
  results: CompetitorResult[];
  eligibleCount: number;
  /** Performance-eligible competitors whose account does not exclude them. */
  prizeEligibleCount: number;
  /** Performance-eligible competitors whose account could not be verified:
   *  their eligibility is UNRESOLVED and blocks approval. */
  accountUnresolved: string[];
  gateCounts: { jobs: number; avgTicket: number; closingRate: number; allThree: number };
  awardedCents: number;
  unallocatedCents: number;
  mostImprovedWinner: string | null;
  duplicateGroups: DuplicateGroup[];
  /** Jobs whose CRM name has no verified competitor (pools, subs, unmapped). */
  unattributed: { crmName: string; jobs: number }[];
}
