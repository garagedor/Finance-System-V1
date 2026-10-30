/**
 * 317 LIVE ARENA — technician API contract (v1).
 *
 * The ONLY shape the technician app (Weekly Balance "Arena" tab) may see.
 * A byte-identical copy lives in the-convert at src/arena/contract.ts; change
 * both together and bump ARENA_TECH_API_VERSION.
 *
 * Rules for every endpoint:
 *  - Caller is a technician holding an Arena pass (audience "arena"), never a
 *    CRM session. The pass identifies ONE competitor; nothing else.
 *  - No customer data, job ids, addresses, phones, invoice numbers, CRM names,
 *    commission or payout data. Other competitors appear only as public
 *    leaderboard rows (display name, location, rank, score, gates met, prize).
 *  - Money is integer cents, rates are basis points (4000 = 40.00%), scores are
 *    plain numbers rounded to 2 decimals server-side.
 *  - Celebrations are driven ONLY by `result_approved` events.
 */

export const ARENA_TECH_API_VERSION = 1;

// ---------------------------------------------------------------- auth
/** POST /api/arena/auth/exchange
 *  Header: Authorization: Bearer <Weekly Balance Supabase access token>
 *  The server verifies the token against the Weekly Balance JWKS (issuer and
 *  audience pinned), requires an active, approved technician or area-manager
 *  profile, maps the Supabase user id to a competitor, and returns a short pass. */
export interface ExchangeResponse {
  pass: string;            // RS256 JWT, aud "arena", ~15 min
  expiresAt: string;       // ISO
  competitorId: string;
  displayName: string;
}
export type ExchangeError =
  | "invalid_token" | "account_inactive" | "not_a_competitor" | "arena_disabled" | "rate_limited";

// ---------------------------------------------------------------- shared
export type CompetitionPhase =
  | "upcoming"      // created, week not started
  | "live"          // Mon 00:00 – Sun 23:59:59 in the competition timezone
  | "frozen"        // week ended, results pending review
  | "in_review"     // review window open
  | "approved"      // owner approved; official
  | "cancelled";

export interface GateView { met: boolean; actual: number; required: number }

export interface RulesView {
  timezone: string;
  minQualifyingJobs: number;
  minAvgTicketCents: number;
  minClosingRateBp: number;
  closingRateWeight: number;   // e.g. 0.6
  avgTicketWeight: number;     // e.g. 0.4
  closingRateTargetBp: number;
  avgTicketTargetCents: number;
  cap: number;                 // index cap shown to technicians (both caps when equal)
  prizesCents: number[];       // best first
  mostImprovedCents: number | null;
  showPotentialPrize: boolean;
  refreshSeconds: number;
}

export interface LeaderboardRow {
  rank: number;
  competitorId: string;        // opaque; lets the app highlight "me"
  displayName: string;
  location: string;
  score: number;
  eligible: boolean;
  gatesMet: { jobs: boolean; avgTicket: boolean; closingRate: boolean };
  /** Shown only when rules.display.showIneligibleMetrics or the row is eligible. */
  closingRateBp: number | null;
  avgTicketCents: number | null;
  qualifyingJobs: number | null;
  /** Potential (live) or awarded (approved) prize for this rank. */
  prizeCents: number;
  isMe: boolean;
}

export interface MyStanding {
  rank: number | null;          // null when not ranked yet (no jobs)
  score: number;
  eligible: boolean;
  gates: { jobs: GateView; avgTicket: GateView; closingRate: GateView };
  closingRateBp: number;
  avgTicketCents: number;
  assignedJobs: number;
  closedJobs: number;
  qualifyingJobs: number;
  closingIndex: number;
  avgIndex: number;
  potentialPrizeCents: number;  // 0 unless eligible and in a prize position
  /** Plain-language next steps, computed server-side (e.g. "2 more qualifying jobs"). */
  nextSteps: { kind: "jobs" | "closes" | "avg_ticket" | "rank"; text: string; amount: number }[];
  pointsToNextRank: number | null;
  mostImproved: { baselineScore: number; improvement: number; validWeeks: number } | null;
}

// ---------------------------------------------------------------- endpoints
/** GET /api/arena/tech/me — the "My Arena" dashboard. */
export interface MeResponse {
  apiVersion: number;
  serverTime: string;
  competitor: { id: string; displayName: string; location: string };
  competition: {
    id: string;
    weekStart: string;           // YYYY-MM-DD (Monday)
    weekEnd: string;             // YYYY-MM-DD (Sunday)
    phase: CompetitionPhase;
    endsAt: string;              // ISO instant of the week end (countdown)
    reviewOpensAt: string;       // ISO
    dataAsOf: string;            // ISO of the snapshot the numbers come from
  } | null;                      // null = no competition this week
  rules: RulesView | null;
  standing: MyStanding | null;   // null = not participating this week
  /** Only after approval: what this technician officially won. */
  award: { prizeCents: number; position: number | null; mostImproved: boolean } | null;
  /** ADDED (server agent, additive): participant notices for this competition, newest
   *  first — owner mid-week rule changes and suspensions (spec Addendum B.5). */
  notices: { kind: "rules_amended" | "suspended" | "resumed"; message: string; at: string }[];
}

/** GET /api/arena/tech/leaderboard?view=national|eligible&week=YYYY-MM-DD */
export interface LeaderboardResponse {
  apiVersion: number;
  weekStart: string;
  phase: CompetitionPhase;
  view: "national" | "eligible";
  dataAsOf: string;
  rows: LeaderboardRow[];
  eligibleCount: number;
  participantCount: number;
  prizePoolCents: number;
}

/** GET /api/arena/tech/history?limit=12 — completed (approved) weeks only. */
export interface HistoryResponse {
  apiVersion: number;
  weeks: {
    weekStart: string;
    myRank: number | null;
    myScore: number | null;
    eligible: boolean;
    prizeCents: number;
    mostImproved: boolean;
    winners: { rank: number; displayName: string; location: string; prizeCents: number }[];
    mostImprovedWinner: { displayName: string; location: string; prizeCents: number } | null;
  }[];
}

/** GET /api/arena/tech/events?since=<cursor> — polled every rules.refreshSeconds. */
export type ArenaEvent =
  | { kind: "rank_changed"; at: string; from: number | null; to: number }
  | { kind: "qualified"; at: string; gate: "jobs" | "avgTicket" | "closingRate" | "all" }
  | { kind: "lost_qualification"; at: string; gate: "jobs" | "avgTicket" | "closingRate" }
  | { kind: "entered_prize_zone"; at: string; position: number }
  | { kind: "phase_changed"; at: string; phase: CompetitionPhase }
  /** The ONLY event that may trigger a winner celebration. */
  | { kind: "result_approved"; at: string; weekStart: string; prizeCents: number; position: number | null; mostImproved: boolean };

export interface EventsResponse {
  apiVersion: number;
  cursor: string;
  events: ArenaEvent[];
}

export interface ArenaErrorBody { error: string; code: ExchangeError | "unauthorized" | "forbidden" | "not_found" | "bad_request" }
