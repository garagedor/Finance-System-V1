/**
 * Re-allocate STORED weekly results under different prize amounts, with the
 * engine's own allocation (engine.ts allocatePrizes — the same function
 * computeCompetition calls). Local analysis / presentation only: nothing here
 * reads a database or writes an approved record.
 *
 * Why this is exact: ranks, scores, eligibility (gates + account) and the Most
 * Improved baselines (`mostImproved.baselineScore / validWeeks / improvement`)
 * depend only on the jobs and the scoring/eligibility rules — never on the
 * prize amounts. Re-allocating keeps all of them and redoes only
 * prizePosition / prizeCents / wonMostImproved / awardedCents /
 * unallocatedCents / mostImprovedWinner. The caller must pass rules whose
 * scoring, eligibility and Most Improved settings (other than the amount)
 * equal the ones the result was computed with: checked here.
 */
import { allocatePrizes, computeCompetition } from "../../src/lib/arena/engine.ts";
import { canonicalJson, cloneRules, rulesHash } from "../../src/lib/arena/config.ts";
import type { ArenaJob, ArenaRules, CompetitionResult, CompetitorMap, CompetitorResult, JobExclusion } from "../../src/lib/arena/types.ts";

/** Everything except the prize amounts (positions, budget, Most Improved amount). */
export function nonPrizeRules(r: ArenaRules): string {
  const c = cloneRules(r);
  c.prizes = { positionsCents: [], budgetCents: 0 };
  c.mostImproved.amountCents = 0;
  return canonicalJson(c);
}

export function reallocateStored(result: CompetitionResult, rules: ArenaRules, computedWith?: ArenaRules): CompetitionResult {
  if (computedWith && nonPrizeRules(computedWith) !== nonPrizeRules(rules))
    throw new Error("re-allocation needs the same scoring / eligibility / Most Improved rules; only prize amounts may differ");
  const results: CompetitorResult[] = structuredClone(result.results).sort((a, b) => a.rank - b.rank);
  const mostImprovedWinner = allocatePrizes(rules, results);
  const awardedCents = results.reduce((s, r) => s + r.prizeCents, 0);
  if (awardedCents > rules.prizes.budgetCents) throw new Error(`awarded ${awardedCents} exceeds budget ${rules.prizes.budgetCents}`);
  return { ...structuredClone(result), rulesHash: rulesHash(rules), results, awardedCents, unallocatedCents: rules.prizes.budgetCents - awardedCents, mostImprovedWinner };
}

// ── what-ifs on the extracted week (jobs.json + stored results) ────────────

export interface ExtractedJob { id: string; tech: string; date: string; status: string; profit: number; location: string }

/** Competitor map rebuilt from the stored results: each competitor's CRM names are the tech names of their stored jobIds. */
export function competitorsFromStored(result: CompetitionResult, jobs: ExtractedJob[]): CompetitorMap {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const byCrmName = new Map<string, string>();
  const competitors = result.results.map((r) => {
    const names = [...new Set(r.jobIds.map((id) => byId.get(id)?.tech).filter((t): t is string => !!t))].sort();
    for (const n of names) {
      const prev = byCrmName.get(n);
      if (prev && prev !== r.competitorId) throw new Error(`CRM name ${n} belongs to two competitors`);
      byCrmName.set(n, r.competitorId);
    }
    return { id: r.competitorId, displayName: r.displayName, crmNames: names, location: r.location };
  });
  return { competitors, byCrmName, issues: [] };
}

export const toArenaJobs = (jobs: ExtractedJob[]): ArenaJob[] =>
  jobs.map((j) => ({ id: j.id, tech: j.tech, date: j.date, status: j.status, location: j.location, profit: j.profit, dupKeys: [] }));

/**
 * Score the extracted week with the ENGINE (computeCompetition) under `rules`,
 * then carry each competitor's STORED Most Improved baseline over (the extract
 * has no baseline-week jobs), recompute improvement = score − baselineScore,
 * and allocate with the engine's allocatePrizes. Account standings are taken
 * from the stored result.
 */
export function scoreWeek(opts: {
  rules: ArenaRules; weekStart: string; stored: CompetitionResult; competitors: CompetitorMap; jobs: ArenaJob[];
  exclusions?: JobExclusion[]; baselines?: Map<string, { baselineScore: number; validWeeks: number }>;
}): CompetitionResult {
  const { rules, stored } = opts;
  const scoringOnly = cloneRules(rules);
  scoringOnly.mostImproved.enabled = false; // baselines come from the stored result, not from the (absent) baseline jobs
  const accounts = Object.fromEntries(stored.results.map((r) => [r.competitorId, r.account]));
  const r = computeCompetition({ rules: scoringOnly, rulesHash: rulesHash(rules), weekStart: opts.weekStart, competitors: opts.competitors, jobs: opts.jobs, exclusions: opts.exclusions ?? [], accounts });
  const base = opts.baselines ?? new Map(stored.results.filter((x) => x.mostImproved).map((x) => [x.competitorId, { baselineScore: x.mostImproved!.baselineScore, validWeeks: x.mostImproved!.validWeeks }]));
  for (const x of r.results) {
    const b = rules.mostImproved.enabled ? base.get(x.competitorId) : undefined;
    x.mostImproved = b ? { baselineScore: b.baselineScore, improvement: x.score - b.baselineScore, validWeeks: b.validWeeks } : null;
  }
  const mostImprovedWinner = allocatePrizes(rules, r.results);
  const awardedCents = r.results.reduce((s, x) => s + x.prizeCents, 0);
  return { ...r, rulesHash: rulesHash(rules), awardedCents, unallocatedCents: rules.prizes.budgetCents - awardedCents, mostImprovedWinner };
}

/** Who gets cash: competitorId → [label, cents]. */
export function payouts(r: CompetitionResult): Map<string, { label: string; cents: number }> {
  return new Map(r.results.filter((x) => x.prizeCents > 0).map((x) => [x.competitorId, { label: x.wonMostImproved ? "Most Improved" : `#${x.prizePosition}`, cents: x.prizeCents }]));
}
export const sameCash = (a: CompetitionResult, b: CompetitionResult): boolean => {
  const pa = payouts(a), pb = payouts(b);
  if (pa.size !== pb.size) return false;
  for (const [id, p] of pa) { const q = pb.get(id); if (!q || q.cents !== p.cents || q.label !== p.label) return false; }
  return true;
};
