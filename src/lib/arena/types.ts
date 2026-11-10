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

export type ScoringMethodology = "WEIGHTED_V0" | "BALANCED_PERFORMANCE_V1";
export const SCORING_METHODOLOGIES: readonly ScoringMethodology[] = ["WEIGHTED_V0", "BALANCED_PERFORMANCE_V1"];

/**
 * What the eligibility job minimum (and the Most Improved per-week minimum) counts.
 * Versioned: ABSENT = "qualifying" (every rule version written before the field
 * existed, reproducible bit for bit, identical fingerprints).
 *   qualifying  jobs whose status is in `qualifying.statuses`
 *   assigned    EVERY job assigned to the technician in the week, any status —
 *               the CRM's official Closing Rate / AVG TICKET denominator
 *               (owner rule 2026-11-09)
 * Either way, separately approved Arena exclusions (confirmed duplicates, admin
 * job exclusions with a reason) are the only deductions, and they change the job
 * count only — never Closing Rate or AVG TICKET.
 */
export type JobCountBasis = "assigned" | "qualifying";
export const JOB_COUNT_BASES: readonly JobCountBasis[] = ["assigned", "qualifying"];

/** Tie-break keys an admin may order. Score is always the primary key and the
 *  competitor id is always the final stable key — neither is configurable. */
export type TieBreakKey = "closingRate" | "avgTicket" | "qualifyingJobs" | "closedJobs";

export interface ArenaRules {
  schemaVersion: 1;
  /** IANA zone the Monday–Sunday week is anchored to (locked per competition). */
  timezone: string;
  eligibility: {
    /** The job minimum; what it counts is set by `jobCountBasis`. */
    minQualifyingJobs: number;
    minAvgTicketCents: number;
    /** 4000 = 40.00% */
    minClosingRateBp: number;
    /** ABSENT = "qualifying" (see JobCountBasis). */
    jobCountBasis?: JobCountBasis;
  };
  scoring: {
    /**
     * Versioned scoring methodology. ABSENT = "WEIGHTED_V0" (every rule version
     * written before the field existed, reproducible bit-for-bit).
     *   WEIGHTED_V0             score = Σ weight × min(actual / target, cap)
     *   BALANCED_PERFORMANCE_V1 C = 100 × min(CR / CR target, cap C),
     *                           A = 100 × min(AVG / AVG target, cap A),
     *                           score = min(C, A); weights and tieBreak unused.
     */
    methodology?: ScoringMethodology;
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
    /** A baseline week is valid when it has at least this many counted jobs
     *  (on the rules' `eligibility.jobCountBasis`). */
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
  /** Absent on maps built before display-name formats existed (= FULL_NAME_V0). */
  nameFormat?: import("./display-name").DisplayNameFormat;
  /** Public name of every verified person (empty under FULL_NAME_V0). */
  publicNames?: Map<string, import("./display-name").PublicName>;
  /**
   * Verified people the owner EXCLUDED from the Arena (Manage Technicians,
   * arena_participation), sorted. Their CRM names stay attributed to them in
   * `byCrmName` (so their jobs are a decided exclusion, never "unmapped"), but
   * they are not in `competitors`: no result, rank, prize, projection or Most
   * Improved. Absent when nobody is excluded (maps and snapshots made before
   * the feature are unchanged, bit for bit).
   */
  notParticipating?: string[];
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

export type LimitingMetric = "closingRate" | "avgTicket" | "both";

export interface CompetitorResult {
  competitorId: string;
  displayName: string;
  location: string;
  /** Official CRM denominator: every job assigned in the week, any status. */
  assignedJobs: number;
  closedJobs: number;
  xCloseJobs: number;
  /** Jobs counted toward the job minimum on the rules' jobCountBasis, after
   *  approved exclusions (= assigned − exclusions under "assigned"). */
  qualifyingJobs: number;
  excludedFromQualifying: number;
  /** Σ profit of non-X-close jobs, micro-dollars (exact). */
  profitMicro: number;
  closingRate: number;
  avgTicket: number;
  closingIndex: number;
  avgIndex: number;
  score: number;
  /** 100 × closingIndex and 100 × avgIndex (unrounded normalized metric scores). */
  closingScore: number;
  avgScore: number;
  /** BALANCED_PERFORMANCE_V1: the metric that sets the score (lower one); null under WEIGHTED_V0. */
  limitingMetric: LimitingMetric | null;
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
  /** How displayName was built; absent on results computed before 2026-10-31 (= FULL_NAME_V0). */
  displayNameFormat?: import("./display-name").DisplayNameFormat;
  /**
   * Owner-excluded people (Manage Technicians) who had jobs in the week: not
   * ranked, never "unattributed". Absent when there are none (older results unchanged).
   */
  notParticipating?: { competitorId: string; jobs: number }[];
}
