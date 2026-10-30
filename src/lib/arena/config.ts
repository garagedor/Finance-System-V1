/**
 * Arena configuration: validation, canonical hashing, and the one-time seed.
 *
 * The seed values below are the owner-approved starting point (2026-10-29).
 * They are written to the database once as the "Standard Week" template and
 * are edited there from then on. Nothing else in the Arena may hardcode a
 * business rule — see arena-structure.test.ts.
 */
import { createHash } from "node:crypto";
import type { ArenaRules, ArenaSettings, TieBreakKey } from "./types";
import { SCORING_METHODOLOGIES } from "./types";
import { isValidTimezone } from "./week";

export const TIE_BREAK_KEYS: readonly TieBreakKey[] = ["closingRate", "avgTicket", "qualifyingJobs", "closedJobs"];

export const SEED_STANDARD_WEEK: ArenaRules = {
  schemaVersion: 1,
  timezone: "America/New_York",
  eligibility: { minQualifyingJobs: 10, minAvgTicketCents: 40_000, minClosingRateBp: 4_000 },
  scoring: {
    closingRate: { weight: 60, targetBp: 5_000, cap: 1.5 },
    avgTicket: { weight: 40, targetCents: 50_000, cap: 1.5 },
  },
  prizes: { positionsCents: [45_000, 30_000, 20_000, 15_000, 10_000, 5_000], budgetCents: 150_000 },
  mostImproved: {
    enabled: true,
    amountCents: 25_000,
    baselineWeeks: 4,
    minValidWeeks: 3,
    minQualifyingJobsPerWeek: 5,
    minImprovement: 0,
  },
  qualifying: { statuses: ["Closed", "X close", "Estimate", "Cancel Estimate", "Price Issue", "Deposit", "Refund"] },
  participants: { onlyCompetitorIds: [], excludeCompetitorIds: [], excludeLocations: [], displayNames: {} },
  tieBreak: ["closingRate", "avgTicket", "qualifyingJobs"],
  review: { approvalOpensDaysAfterWeekEnd: 1, approvalOpensLocalTime: "12:00" },
  display: { showPotentialPrize: true, showIneligibleMetrics: true, showPodium: true, refreshSeconds: 30 },
};

/**
 * "Balanced Performance" template (owner-approved 2026-10-30): the Standard Week
 * with the BALANCED_PERFORMANCE_V1 methodology. Scoring targets 50% / $500, cap
 * 1.5 (score 0–150). Eligibility minimums are identical to the Standard Week —
 * they are not part of the methodology change.
 */
export const SEED_BALANCED_PERFORMANCE: ArenaRules = {
  ...SEED_STANDARD_WEEK,
  scoring: {
    methodology: "BALANCED_PERFORMANCE_V1",
    closingRate: { ...SEED_STANDARD_WEEK.scoring.closingRate },
    avgTicket: { ...SEED_STANDARD_WEEK.scoring.avgTicket },
  },
};

export const SEED_SETTINGS_BUDGET_CEILING_CENTS = 150_000;

export class ArenaConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid Arena configuration: ${problems.join("; ")}`);
    this.problems = problems;
  }
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Total money a competition could pay out. */
export function maxPayoutCents(rules: ArenaRules): number {
  const positions = rules.prizes.positionsCents.reduce((s, c) => s + c, 0);
  return positions + (rules.mostImproved.enabled ? rules.mostImproved.amountCents : 0);
}

/**
 * Validate rules. `knownStatuses` is the live CRM JobStatus list; `ceilingCents`
 * is the owner's budget ceiling. Returns a list of problems (empty = valid).
 */
export function validateRules(
  rules: ArenaRules,
  ctx: { knownStatuses: readonly string[]; ceilingCents: number },
): string[] {
  const p: string[] = [];
  if (rules.schemaVersion !== 1) p.push("unsupported schemaVersion");
  if (!isValidTimezone(rules.timezone)) p.push(`unknown timezone "${rules.timezone}"`);

  const e = rules.eligibility;
  if (!isInt(e.minQualifyingJobs) || e.minQualifyingJobs < 0) p.push("minimum qualifying jobs must be a whole number ≥ 0");
  if (!isInt(e.minAvgTicketCents) || e.minAvgTicketCents < 0) p.push("minimum AVG TICKET must be ≥ $0.00 (whole cents)");
  if (!isInt(e.minClosingRateBp) || e.minClosingRateBp < 0 || e.minClosingRateBp > 10_000)
    p.push("minimum Closing Rate must be between 0% and 100% (0.01% steps)");

  for (const [name, c] of [
    ["Closing Rate", rules.scoring.closingRate],
    ["AVG TICKET", rules.scoring.avgTicket],
  ] as const) {
    if (!isNum(c.weight) || c.weight < 0) p.push(`${name} weight must be ≥ 0`);
    if (!isNum(c.cap) || c.cap < 1) p.push(`${name} cap must be ≥ 1`);
  }
  const m = rules.scoring.methodology;
  if (m !== undefined && !SCORING_METHODOLOGIES.includes(m)) p.push(`unknown scoring methodology "${String(m)}"`);
  // Weights are part of WEIGHTED_V0 only; BALANCED_PERFORMANCE_V1 ignores them.
  if ((m ?? "WEIGHTED_V0") === "WEIGHTED_V0" && rules.scoring.closingRate.weight + rules.scoring.avgTicket.weight <= 0)
    p.push("at least one scoring weight must be > 0");
  if (!isInt(rules.scoring.closingRate.targetBp) || rules.scoring.closingRate.targetBp <= 0 || rules.scoring.closingRate.targetBp > 10_000)
    p.push("Closing Rate target must be between 0.01% and 100%");
  if (!isInt(rules.scoring.avgTicket.targetCents) || rules.scoring.avgTicket.targetCents <= 0)
    p.push("AVG TICKET target must be > $0.00 (whole cents)");

  const pz = rules.prizes;
  if (!Array.isArray(pz.positionsCents)) p.push("prize positions must be a list");
  else if (pz.positionsCents.some((c) => !isInt(c) || c <= 0)) p.push("every prize amount must be > $0.00 (whole cents)");
  if (!isInt(pz.budgetCents) || pz.budgetCents < 0) p.push("budget must be ≥ $0.00 (whole cents)");

  const mi = rules.mostImproved;
  if (mi.enabled) {
    if (!isInt(mi.amountCents) || mi.amountCents <= 0) p.push("Most Improved amount must be > $0.00");
    if (!isInt(mi.baselineWeeks) || mi.baselineWeeks < 1) p.push("Most Improved baseline must be ≥ 1 week");
    if (!isInt(mi.minValidWeeks) || mi.minValidWeeks < 1 || mi.minValidWeeks > mi.baselineWeeks)
      p.push("Most Improved valid-week minimum must be between 1 and the baseline length");
    if (!isInt(mi.minQualifyingJobsPerWeek) || mi.minQualifyingJobsPerWeek < 0)
      p.push("Most Improved per-week job minimum must be a whole number ≥ 0");
    if (!isNum(mi.minImprovement) || mi.minImprovement < 0) p.push("Most Improved minimum improvement must be ≥ 0");
  }

  const payout = maxPayoutCents(rules);
  if (payout > pz.budgetCents)
    p.push(`prizes total $${(payout / 100).toFixed(2)} exceeds the weekly budget $${(pz.budgetCents / 100).toFixed(2)}`);
  if (pz.budgetCents > ctx.ceilingCents)
    p.push(`weekly budget $${(pz.budgetCents / 100).toFixed(2)} exceeds the owner's ceiling $${(ctx.ceilingCents / 100).toFixed(2)}`);

  const known = new Set(ctx.knownStatuses);
  const statuses = rules.qualifying.statuses;
  if (!Array.isArray(statuses) || statuses.length === 0) p.push("at least one qualifying status is required");
  else {
    for (const s of statuses) if (!known.has(s)) p.push(`"${s}" is not a CRM job status`);
    if (new Set(statuses).size !== statuses.length) p.push("qualifying statuses contain duplicates");
  }

  const tb = rules.tieBreak;
  if (!Array.isArray(tb) || tb.some((k) => !TIE_BREAK_KEYS.includes(k)) || new Set(tb).size !== tb.length)
    p.push(`tie-break keys must be distinct values from: ${TIE_BREAK_KEYS.join(", ")}`);

  const r = rules.review;
  if (!isInt(r.approvalOpensDaysAfterWeekEnd) || r.approvalOpensDaysAfterWeekEnd < 0) p.push("approval delay must be ≥ 0 days");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.approvalOpensLocalTime)) p.push("approval time must be HH:MM (24h)");

  if (!isInt(rules.display.refreshSeconds) || rules.display.refreshSeconds < 5) p.push("refresh interval must be ≥ 5 seconds");
  return p;
}

export function assertValidRules(rules: ArenaRules, ctx: { knownStatuses: readonly string[]; ceilingCents: number }): void {
  const problems = validateRules(rules, ctx);
  if (problems.length) throw new ArenaConfigError(problems);
}

export function validateSettings(s: ArenaSettings): string[] {
  const p: string[] = [];
  if (!isInt(s.budgetCeilingCents) || s.budgetCeilingCents < 0) p.push("budget ceiling must be ≥ $0.00 (whole cents)");
  if (!s.ownerUserId) p.push("owner account is required");
  if (!Array.isArray(s.approverUserIds) || s.approverUserIds.length === 0) p.push("at least one approver is required");
  return p;
}

/** Key-order-independent JSON, so equal rules always hash equally. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

export function rulesHash(rules: ArenaRules): string {
  return createHash("sha256").update(canonicalJson(rules)).digest("hex");
}

export function cloneRules(rules: ArenaRules): ArenaRules {
  return JSON.parse(JSON.stringify(rules)) as ArenaRules;
}
