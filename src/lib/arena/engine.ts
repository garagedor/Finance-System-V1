/**
 * 317 LIVE ARENA scoring engine — a pure function of
 * (rules, competitor map, jobs, exclusions). No I/O, no clock, and no business
 * constants: every threshold, target, weight, cap, prize, status list and
 * tie-break comes from the versioned `ArenaRules`.
 *
 * Account eligibility (Weekly Balance account active + approved) is an INPUT
 * (`accounts`), decided by the caller; it never changes a KPI, a score or a
 * rank, only who may hold a prize.
 *
 * Official KPIs are the CRM Home Leaderboard / Balance Report definitions,
 * unchanged:
 *   Closing Rate = Closed jobs / ALL assigned jobs in the week
 *   AVG TICKET   = Σ profit of non-X-close jobs / ALL assigned jobs
 * The job count used by the eligibility minimum is a separate Arena metric
 * (rules.eligibility.jobCountBasis: qualifying statuses, or every assigned
 * job); admin exclusions and confirmed duplicates reduce it and nothing else.
 */
import type {
  AccountInput,
  JobCountBasis,
  AccountState,
  ArenaJob,
  ArenaRules,
  CompetitionResult,
  CompetitorMap,
  CompetitorResult,
  DuplicateGroup,
  JobExclusion,
  LimitingMetric,
  ScoringMethodology,
  TieBreakKey,
} from "./types";
import { inWeek, previousWeekStarts } from "./week";

const BP = 10_000; // basis points per 1.0
const MICRO_PER_CENT = 10_000; // micro-dollars per cent
const MICRO = 1_000_000; // micro-dollars per dollar
/** Points a metric scores exactly at its target (the methodology's scale, not a business rule). */
export const SCORE_SCALE = 100;

/** Per-job profit in exact integer micro-dollars. */
export const toMicro = (dollars: number) => Math.round(dollars * MICRO);

interface Tally {
  assigned: number;
  closed: number;
  xClose: number;
  qualifying: number;
  excluded: number;
  profitMicro: number;
  jobIds: string[];
}

const emptyTally = (): Tally => ({ assigned: 0, closed: 0, xClose: 0, qualifying: 0, excluded: 0, profitMicro: 0, jobIds: [] });

/** Does a job of this status count toward the job minimum? */
type CountsToward = (status: string) => boolean;

export const jobCountBasisOf = (rules: ArenaRules): JobCountBasis => rules.eligibility.jobCountBasis ?? "qualifying";

/** The word for the counted jobs in every user-facing text ("10 assigned jobs" / "10 qualifying jobs"). */
export const jobCountWord = (rules: ArenaRules): "assigned" | "qualifying" => jobCountBasisOf(rules);

/** The job-minimum predicate of the rules: every status under "assigned", the qualifying statuses otherwise. */
export function countsTowardJobMinimum(rules: ArenaRules): CountsToward {
  if (jobCountBasisOf(rules) === "assigned") return () => true;
  const qualifying = new Set(rules.qualifying.statuses);
  return (status) => qualifying.has(status);
}

/** Add one job to a tally using the official CRM definitions. */
function addJob(t: Tally, job: ArenaJob, counts: CountsToward, excluded: boolean): void {
  t.assigned += 1;
  t.jobIds.push(job.id);
  if (job.status === "Closed") t.closed += 1;
  if (job.status === "X close") t.xClose += 1;
  else t.profitMicro += toMicro(job.profit);
  if (counts(job.status)) {
    if (excluded) t.excluded += 1;
    else t.qualifying += 1;
  }
}

/** Official KPIs for any set of jobs (used for parity checks too). */
export function officialKpis(jobs: ArenaJob[]): { assigned: number; closed: number; profitMicro: number; closingRate: number; avgTicket: number } {
  const t = emptyTally();
  for (const j of jobs) addJob(t, j, () => false, false);
  return {
    assigned: t.assigned,
    closed: t.closed,
    profitMicro: t.profitMicro,
    closingRate: t.assigned ? t.closed / t.assigned : 0,
    avgTicket: t.assigned ? t.profitMicro / MICRO / t.assigned : 0,
  };
}

export const methodologyOf = (rules: ArenaRules): ScoringMethodology => rules.scoring.methodology ?? "WEIGHTED_V0";

/**
 * Score of a tally under the rules' methodology. Indices are unrounded; only
 * display rounds. WEIGHTED_V0 is today's formula, unchanged.
 */
export function scoreOf(rules: ArenaRules, t: Pick<Tally, "assigned" | "closed" | "profitMicro">) {
  const s = rules.scoring;
  const closingRate = t.assigned ? t.closed / t.assigned : 0;
  const avgTicket = t.assigned ? t.profitMicro / MICRO / t.assigned : 0;
  const closingIndex = Math.min(closingRate / (s.closingRate.targetBp / BP), s.closingRate.cap);
  const avgIndex = Math.min(avgTicket / (s.avgTicket.targetCents / 100), s.avgTicket.cap);
  const closingScore = SCORE_SCALE * Math.max(0, closingIndex);
  const avgScore = SCORE_SCALE * Math.max(0, avgIndex);
  if (methodologyOf(rules) === "BALANCED_PERFORMANCE_V1") {
    const limitingMetric: LimitingMetric = closingScore < avgScore ? "closingRate" : avgScore < closingScore ? "avgTicket" : "both";
    return { closingRate, avgTicket, closingIndex, avgIndex, closingScore, avgScore, limitingMetric, score: Math.min(closingScore, avgScore) };
  }
  return {
    closingRate,
    avgTicket,
    closingIndex,
    avgIndex,
    closingScore,
    avgScore,
    limitingMetric: null,
    score: s.closingRate.weight * closingIndex + s.avgTicket.weight * avgIndex,
  };
}

/** Exact gate checks: integer arithmetic only, so 39.99% < 40% and $399.99 < $400 always. */
function gates(rules: ArenaRules, t: Tally) {
  const e = rules.eligibility;
  const jobs = { met: t.qualifying >= e.minQualifyingJobs, actual: t.qualifying, required: e.minQualifyingJobs };
  const avg = {
    met: t.assigned > 0 && t.profitMicro >= e.minAvgTicketCents * MICRO_PER_CENT * t.assigned,
    actual: t.assigned ? t.profitMicro / MICRO / t.assigned : 0,
    required: e.minAvgTicketCents / 100,
  };
  const cr = {
    met: t.assigned > 0 && t.closed * BP >= e.minClosingRateBp * t.assigned,
    actual: t.assigned ? t.closed / t.assigned : 0,
    required: e.minClosingRateBp / BP,
  };
  return { jobs, avgTicket: avg, closingRate: cr };
}

const TIE_VALUE: Record<TieBreakKey, (r: CompetitorResult) => number> = {
  closingRate: (r) => r.closingRate,
  avgTicket: (r) => r.avgTicket,
  qualifyingJobs: (r) => r.qualifyingJobs,
  closedJobs: (r) => r.closedJobs,
};

/**
 * Ranking order.
 *   WEIGHTED_V0:             score (unrounded), then the configured tie-break keys, then id.
 *   BALANCED_PERFORMANCE_V1: score = min(C, A) (unrounded), then the higher of the
 *                            two metric scores max(C, A), then official assigned
 *                            CRM jobs, then id. The configured tieBreak is NOT used.
 * Higher wins everywhere; the competitor id is the final stable key.
 */
export function compareRanking(rules: ArenaRules) {
  const v1 = methodologyOf(rules) === "BALANCED_PERFORMANCE_V1";
  return (a: CompetitorResult, b: CompetitorResult): number => {
    if (a.score !== b.score) return b.score - a.score;
    if (v1) {
      const ma = Math.max(a.closingScore, a.avgScore), mb = Math.max(b.closingScore, b.avgScore);
      if (ma !== mb) return mb - ma;
      if (a.assignedJobs !== b.assignedJobs) return b.assignedJobs - a.assignedJobs;
    } else {
      for (const k of rules.tieBreak) {
        const d = TIE_VALUE[k](b) - TIE_VALUE[k](a);
        if (d !== 0) return d;
      }
    }
    return a.competitorId < b.competitorId ? -1 : a.competitorId > b.competitorId ? 1 : 0;
  };
}

function participates(rules: ArenaRules, c: { id: string; location: string }): boolean {
  const p = rules.participants;
  if (p.onlyCompetitorIds.length && !p.onlyCompetitorIds.includes(c.id)) return false;
  if (p.excludeCompetitorIds.includes(c.id)) return false;
  if (p.excludeLocations.includes(c.location)) return false;
  return true;
}

/** Account states that keep a competitor from holding any prize. `unverified`
 *  is NOT one of them: an unanswered check never disqualifies anyone. */
export const accountExcludes = (s: AccountState): boolean => s !== "eligible" && s !== "unverified";

const UNVERIFIED: AccountInput = { state: "unverified", checkedAt: null };

/**
 * Prize positions and the Most Improved winner, over RANKED results whose
 * `mostImproved` baseline is already filled in. This is the only prize
 * allocation in the Arena: computeCompetition calls it, and so does any tool
 * that re-allocates stored results under different prize amounts (ranks,
 * scores, eligibility and baselines do not depend on the prize amounts).
 * Resets and then sets prizePosition / prizeCents / wonMostImproved on each
 * result (in place); returns the Most Improved winner's id, or null.
 *
 *   positions: prize-eligible competitors only, in rank order. An
 *   account-excluded competitor keeps their rank but is skipped, so the prize
 *   goes to the next fully eligible one; an unverified one keeps the place.
 *   Most Improved: prize-eligible now (gates AND account), NO position prize,
 *   improvement > minImprovement; largest improvement wins, then rank order.
 *   With N position prizes, the ranks after the N-th paid place are the first
 *   ones Most Improved can go to.
 */
export function allocatePrizes(rules: ArenaRules, results: CompetitorResult[]): string | null {
  for (const r of results) {
    r.prizePosition = null;
    r.prizeCents = 0;
    r.wonMostImproved = false;
  }
  const ranked = [...results].sort((a, b) => a.rank - b.rank);
  const positions = rules.prizes.positionsCents;
  let next = 0;
  for (const r of ranked) {
    if (next >= positions.length) break;
    if (!r.prizeEligible) continue;
    r.prizePosition = next + 1;
    r.prizeCents = positions[next];
    next += 1;
  }

  if (!rules.mostImproved.enabled) return null;
  const mi = rules.mostImproved;
  const byRank = compareRanking(rules);
  const candidates = ranked
    .filter((r) => r.prizeEligible && r.prizePosition === null && r.mostImproved && r.mostImproved.improvement > mi.minImprovement)
    .sort((a, b) => b.mostImproved!.improvement - a.mostImproved!.improvement || byRank(a, b));
  if (!candidates.length) return null;
  candidates[0].wonMostImproved = true;
  candidates[0].prizeCents = mi.amountCents;
  return candidates[0].competitorId;
}

export interface ComputeInput {
  rules: ArenaRules;
  rulesHash: string;
  weekStart: string;
  competitors: CompetitorMap;
  /** Jobs of the competition week plus the Most Improved baseline weeks. */
  jobs: ArenaJob[];
  exclusions?: JobExclusion[];
  /** Duplicate groups (sorted job ids joined by ",") an admin marked "not a duplicate". */
  dismissedDuplicateGroups?: string[];
  /** Weekly Balance account standing by competitor id, decided by the caller.
   *  A competitor missing here is `unverified`. */
  accounts: Readonly<Record<string, AccountInput>>;
}

export function computeCompetition(input: ComputeInput): CompetitionResult {
  const { rules, weekStart, competitors } = input;
  const qualifying = countsTowardJobMinimum(rules);
  const excludedIds = new Set(
    (input.exclusions ?? []).filter((x) => !x.revokedAt).map((x) => x.jobId),
  );
  const people = new Map(competitors.competitors.map((c) => [c.id, c]));
  // Owner-excluded people (Manage Technicians): their jobs are a decided
  // exclusion — not scored, not ranked, and never "unattributed".
  const notParticipating = new Set(competitors.notParticipating ?? []);
  const excludedJobs = new Map<string, number>();
  const baselineWeeks = rules.mostImproved.enabled ? previousWeekStarts(weekStart, rules.mostImproved.baselineWeeks) : [];

  const current = new Map<string, Tally>();
  const history = new Map<string, Map<string, Tally>>(); // week → competitor → tally
  const unattributed = new Map<string, number>();
  const weekJobs: ArenaJob[] = [];

  const seenJobIds = new Set<string>();
  for (const job of input.jobs) {
    // A production job is counted once, however many times it is delivered.
    if (seenJobIds.has(job.id)) continue;
    seenJobIds.add(job.id);
    const id = competitors.byCrmName.get(job.tech);
    const isCurrent = inWeek(job.date, weekStart);
    if (isCurrent) weekJobs.push(job);
    if (id && !people.has(id) && notParticipating.has(id)) {
      if (isCurrent) excludedJobs.set(id, (excludedJobs.get(id) ?? 0) + 1);
      continue;
    }
    if (!id || !people.has(id)) {
      if (isCurrent) unattributed.set(job.tech, (unattributed.get(job.tech) ?? 0) + 1);
      continue;
    }
    if (isCurrent) {
      addJob(current.get(id) ?? current.set(id, emptyTally()).get(id)!, job, qualifying, excludedIds.has(job.id));
      continue;
    }
    const wk = baselineWeeks.find((w) => inWeek(job.date, w));
    if (!wk) continue;
    const byC = history.get(wk) ?? history.set(wk, new Map()).get(wk)!;
    addJob(byC.get(id) ?? byC.set(id, emptyTally()).get(id)!, job, qualifying, excludedIds.has(job.id));
  }

  const results: CompetitorResult[] = [];
  for (const [id, t] of current) {
    const c = people.get(id)!;
    if (!participates(rules, c)) continue;
    const s = scoreOf(rules, t);
    const g = gates(rules, t);
    const eligible = g.jobs.met && g.avgTicket.met && g.closingRate.met;
    const a = input.accounts?.[id] ?? UNVERIFIED;
    const account: AccountInput = { state: a.state, checkedAt: a.checkedAt, ...(a.lastKnown ? { lastKnown: true } : {}) };
    results.push({
      competitorId: id,
      displayName: rules.participants.displayNames[id] || c.displayName,
      location: c.location,
      assignedJobs: t.assigned,
      closedJobs: t.closed,
      xCloseJobs: t.xClose,
      qualifyingJobs: t.qualifying,
      excludedFromQualifying: t.excluded,
      profitMicro: t.profitMicro,
      ...s,
      gates: g,
      eligible,
      account,
      prizeEligible: eligible && !accountExcludes(account.state),
      rank: 0,
      prizePosition: null,
      prizeCents: 0,
      mostImproved: null,
      wonMostImproved: false,
      jobIds: [...t.jobIds].sort(),
    });
  }

  results.sort(compareRanking(rules));
  results.forEach((r, i) => (r.rank = i + 1));

  // Most Improved baselines: enough valid baseline weeks → pooled baseline score.
  if (rules.mostImproved.enabled) {
    const mi = rules.mostImproved;
    for (const r of results) {
      const valid = baselineWeeks
        .map((w) => history.get(w)?.get(r.competitorId))
        .filter((t): t is Tally => !!t && t.assigned > 0 && t.qualifying >= mi.minQualifyingJobsPerWeek);
      if (valid.length < mi.minValidWeeks) continue;
      const pooled = valid.reduce(
        (a, t) => ({ assigned: a.assigned + t.assigned, closed: a.closed + t.closed, profitMicro: a.profitMicro + t.profitMicro }),
        { assigned: 0, closed: 0, profitMicro: 0 },
      );
      const baselineScore = scoreOf(rules, pooled).score;
      r.mostImproved = { baselineScore, improvement: r.score - baselineScore, validWeeks: valid.length };
    }
  }

  const mostImprovedWinner = allocatePrizes(rules, results);

  const awardedCents = results.reduce((s, r) => s + r.prizeCents, 0);
  if (awardedCents > rules.prizes.budgetCents) {
    // Unreachable with validated rules; refuse rather than publish an over-budget result.
    throw new Error(`awarded ${awardedCents} exceeds budget ${rules.prizes.budgetCents}`);
  }
  const winners = results.filter((r) => r.prizeCents > 0);
  if (winners.some((r) => r.prizePosition !== null && r.wonMostImproved)) throw new Error("overlapping individual prizes");

  return {
    weekStart,
    rulesHash: input.rulesHash,
    results,
    eligibleCount: results.filter((r) => r.eligible).length,
    prizeEligibleCount: results.filter((r) => r.prizeEligible).length,
    accountUnresolved: results.filter((r) => r.eligible && r.account.state === "unverified").map((r) => r.competitorId),
    gateCounts: {
      jobs: results.filter((r) => r.gates.jobs.met).length,
      avgTicket: results.filter((r) => r.gates.avgTicket.met).length,
      closingRate: results.filter((r) => r.gates.closingRate.met).length,
      allThree: results.filter((r) => r.eligible).length,
    },
    awardedCents,
    unallocatedCents: rules.prizes.budgetCents - awardedCents,
    mostImprovedWinner,
    duplicateGroups: findSuspectedDuplicates(weekJobs, competitors, results, excludedIds, new Set(input.dismissedDuplicateGroups ?? [])),
    unattributed: [...unattributed.entries()]
      .map(([crmName, jobs]) => ({ crmName, jobs }))
      .sort((a, b) => b.jobs - a.jobs || (a.crmName < b.crmName ? -1 : 1)),
    ...(input.competitors.nameFormat ? { displayNameFormat: input.competitors.nameFormat } : {}),
    ...(excludedJobs.size
      ? { notParticipating: [...excludedJobs.entries()].map(([competitorId, jobs]) => ({ competitorId, jobs })).sort((a, b) => (a.competitorId < b.competitorId ? -1 : 1)) }
      : {}),
  };
}

/**
 * Suspected duplicates: two or more jobs of the same competitor on the same
 * service date sharing a duplicate key (hashed phone / address / invoice).
 * Flagged only — never removed automatically. A group blocks approval until it
 * is resolved (one job excluded as a duplicate) or dismissed by an admin.
 */
export function findSuspectedDuplicates(
  weekJobs: ArenaJob[],
  competitors: CompetitorMap,
  results: CompetitorResult[],
  excludedIds: ReadonlySet<string>,
  dismissed: ReadonlySet<string> = new Set(),
): DuplicateGroup[] {
  const groups = new Map<string, Set<string>>();
  for (const j of weekJobs) {
    const who = competitors.byCrmName.get(j.tech) ?? `crm:${j.tech}`;
    for (const k of j.dupKeys) {
      const key = `${who}|${j.date}|${k}`;
      (groups.get(key) ?? groups.set(key, new Set()).get(key)!).add(j.id);
    }
  }
  const byResult = new Map(results.map((r) => [r.competitorId, r]));
  const seen = new Set<string>();
  const out: DuplicateGroup[] = [];
  for (const [key, ids] of groups) {
    if (ids.size < 2) continue;
    const jobIds = [...ids].sort();
    const sig = jobIds.join(",");
    if (seen.has(sig)) continue;
    seen.add(sig);
    const competitorId = key.startsWith("crm:") ? null : key.split("|")[0];
    const r = competitorId ? byResult.get(competitorId) : undefined;
    const unresolved = jobIds.filter((id) => !excludedIds.has(id)).length > 1;
    out.push({
      key,
      competitorId,
      jobIds,
      // Conservative: any unresolved group on a participant's record can move
      // that participant's eligibility or rank once the CRM is corrected.
      mayAffectPrizes: !!r && unresolved && !dismissed.has(sig),
    });
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : 1));
}
