/**
 * Server glue for the Admin Control Center: builds store contexts, runs a
 * preview of rules against real (read-only) CRM weeks, and scans CRM weeks for
 * review cases. API routes stay thin and call these.
 */
import "server-only";
import type { Db } from "mongodb";
import { getMongoClient } from "@/lib/mongo";
import { getDb as getCrmDb, newId } from "@/lib/finance-db";
import { KNOWN_STATUSES } from "@/lib/status-canonical";
import type { ArenaRules } from "./types";
import { currentSettings, type StoreContext } from "./config-store";
import type { ReviewContext } from "./review";
import { reviewDecisions, syncDetected } from "./review";
import { arenaDbName } from "./env";
import { arenaStores, ensureArenaIndexes, lifecycleCollections, loadMappings, loadTechnicians } from "./mongo-store";
import type { LifecycleContext } from "./lifecycle";
import type { RuleVersionDoc } from "./config-store";
import type { CompetitionResult } from "./types";
import { loadJobs } from "./job-source";
import { buildCompetitorMap } from "./identity";
import { computeCompetition } from "./engine";
import { rulesHash } from "./config";
import { addDays, isMonday, previousWeekStarts, weekStartOf } from "./week";
import { detectCases } from "./detect";

export interface ArenaContexts {
  arenaDb: Db;
  crmDb: Db;
  config: StoreContext;
  review: ReviewContext;
  lifecycle: LifecycleContext;
}

/** The local dev stack marker. Never set in a deployed environment. */
export const isDevStack = (env: NodeJS.ProcessEnv = process.env) => env.ARENA_DEV_STACK === "1";

export async function arenaContexts(): Promise<ArenaContexts> {
  const client = await getMongoClient();
  const arenaDb = client.db(arenaDbName());
  await ensureArenaIndexes(arenaDb);
  return buildArenaContexts(arenaDb, await getCrmDb());
}

/** Wire the stores for an Arena database and a (read-only) CRM database. */
export function buildArenaContexts(arenaDb: Db, crmDb: Db, now: () => Date = () => new Date()): ArenaContexts {
  const stores = arenaStores(arenaDb);
  const config: StoreContext = { store: stores.config, knownStatuses: KNOWN_STATUSES, now, newId };
  let verified: Promise<ReadonlySet<string>> | null = null;
  const review: ReviewContext = {
    store: stores.review,
    ownerUserId: async () => (await currentSettings(config)).ownerUserId,
    verifiedCompetitorIds: () =>
      (verified ??= loadMappings(crmDb).then((m) => new Set(m.map((x) => x.supabaseUserId).filter(Boolean)))),
    now,
    newId,
  };
  const partial = { arenaDb, crmDb, config, review } as ArenaContexts;
  partial.lifecycle = {
    config,
    lc: lifecycleCollections(arenaDb),
    compute: (weekStart: string, rv: RuleVersionDoc) => computeWeek(partial, rv.rules, rv.rulesHash, weekStart),
    devStack: isDevStack(),
  };
  return partial;
}

/** Last fully completed Monday-start week (America/New_York). */
export function lastCompletedWeek(now = new Date()): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
  return addDays(weekStartOf(today), -7);
}

export interface PreviewSummary {
  weekStart: string;
  rulesHash: string;
  participants: number;
  eligible: number;
  prizes: { position: number; name: string; location: string; score: number; cents: number }[];
  mostImproved: { name: string; improvement: number; cents: number } | null;
  paidCents: number;
  budgetCents: number;
  unallocatedCents: number;
  blockingDuplicates: number;
  unmappedNamesWithJobs: { crmName: string; jobs: number }[];
  /** Ineligible competitors who out-scored the last prize holder. */
  keptOut: { name: string; score: number; missing: string[] }[];
}

/**
 * Run the real engine with these rules on a past week's real CRM jobs, using
 * every review decision in force. Read-only: nothing is saved.
 */
async function runEngine(ctx: ArenaContexts, rules: ArenaRules, hash: string, weekStart: string) {
  const weeks = rules.mostImproved.enabled ? previousWeekStarts(weekStart, rules.mostImproved.baselineWeeks) : [];
  const from = weeks.length ? weeks[weeks.length - 1] : weekStart;
  const [jobs, mappings, technicians, decisions] = await Promise.all([
    loadJobs(ctx.crmDb, [from, weekStart].sort()[0], addDays(weekStart, 7)),
    loadMappings(ctx.crmDb),
    loadTechnicians(ctx.crmDb),
    reviewDecisions(ctx.review),
  ]);
  const competitors = buildCompetitorMap({
    mappings,
    technicians,
    crmNamesInUse: [...new Set(jobs.map((j) => j.tech))],
    overrides: decisions.overrides,
    displayNames: decisions.displayNames,
  });
  const r = computeCompetition({
    rules,
    rulesHash: hash,
    weekStart,
    competitors,
    jobs,
    exclusions: decisions.exclusions,
    dismissedDuplicateGroups: decisions.dismissedDuplicateGroups,
  });
  return { r, competitors, jobs };
}

/** The official result of one week under one rule version (CRM read-only). */
export async function computeWeek(ctx: ArenaContexts, rules: ArenaRules, hash: string, weekStart: string): Promise<CompetitionResult> {
  return (await runEngine(ctx, rules, hash, weekStart)).r;
}

export async function previewRules(ctx: ArenaContexts, rules: ArenaRules, weekStart: string): Promise<PreviewSummary> {
  if (!isMonday(weekStart)) throw new Error("preview week must start on a Monday");
  const { r, competitors, jobs } = await runEngine(ctx, rules, rulesHash(rules), weekStart);
  const winners = r.results.filter((x) => x.prizePosition !== null).sort((a, b) => a.prizePosition! - b.prizePosition!);
  const lastScore = winners.length ? winners[winners.length - 1].score : Infinity;
  const mi = r.results.find((x) => x.wonMostImproved);
  const weekJobs = jobs.filter((j) => j.date >= weekStart && j.date < addDays(weekStart, 7));
  return {
    weekStart,
    rulesHash: r.rulesHash,
    participants: r.results.length,
    eligible: r.eligibleCount,
    prizes: winners.map((x) => ({ position: x.prizePosition!, name: x.displayName, location: x.location, score: x.score, cents: x.prizeCents })),
    mostImproved: mi ? { name: mi.displayName, improvement: mi.mostImproved?.improvement ?? 0, cents: rules.mostImproved.amountCents } : null,
    paidCents: r.awardedCents,
    budgetCents: rules.prizes.budgetCents,
    unallocatedCents: r.unallocatedCents,
    blockingDuplicates: r.duplicateGroups.filter((g) => g.mayAffectPrizes).length,
    unmappedNamesWithJobs: competitors.issues
      .filter((i) => i.blocking)
      .map((i) => ({ crmName: i.crmName, jobs: weekJobs.filter((j) => j.tech === i.crmName).length }))
      .filter((x) => x.jobs > 0),
    keptOut: r.results
      .filter((x) => !x.eligible && x.score > lastScore)
      .map((x) => ({
        name: x.displayName,
        score: x.score,
        missing: [!x.gates.jobs.met && "jobs", !x.gates.avgTicket.met && "AVG ticket", !x.gates.closingRate.met && "closing rate"].filter(
          (m): m is string => !!m,
        ),
      })),
  };
}

/**
 * Scan CRM weeks for review cases (read-only on the CRM side; writes only the
 * Arena review collections). Decisions already in force are respected.
 */
export async function scanForReview(
  ctx: ArenaContexts,
  rules: ArenaRules,
  firstWeek: string,
  weeksCount: number,
  by: string,
): Promise<{ added: number; refreshed: number; weeks: string[] }> {
  if (!isMonday(firstWeek)) throw new Error("the scan must start on a Monday");
  const n = Math.max(1, Math.min(26, Math.floor(weeksCount)));
  const end = addDays(firstWeek, 7 * n);
  const [jobs, mappings, technicians, decisions] = await Promise.all([
    loadJobs(ctx.crmDb, firstWeek, end),
    loadMappings(ctx.crmDb),
    loadTechnicians(ctx.crmDb),
    reviewDecisions(ctx.review),
  ]);
  const weeks = Array.from({ length: n }, (_, i) => addDays(firstWeek, 7 * i));
  const found = detectCases({
    weeks: weeks.map((w) => ({ weekStart: w, jobs: jobs.filter((j) => j.date >= w && j.date < addDays(w, 7)) })),
    mappings,
    technicians,
    rules,
    overrides: decisions.overrides,
    displayNames: decisions.displayNames,
    exclusions: decisions.exclusions,
  });
  const res = await syncDetected(ctx.review, found, by);
  return { ...res, weeks };
}
