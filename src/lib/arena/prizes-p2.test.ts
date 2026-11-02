// "Balanced Performance · Prizes 2026-11" (owner decision 2026-11-02): a NEW
// versioned template — 3 cash places $550/$400/$300 + Most Improved $250 —
// while the 6-place seed and its approved fingerprint stay byte-identical.
import { test } from "node:test";
import assert from "node:assert/strict";
import { allocatePrizes, computeCompetition } from "./engine.ts";
import {
  ARENA_RULE_SEEDS, SEED_BALANCED_PERFORMANCE, SEED_BALANCED_PERFORMANCE_P2, SEED_SETTINGS_BUDGET_CEILING_CENTS,
  canonicalJson, cloneRules, maxPayoutCents, ruleSeed, rulesHash, validateRules,
} from "./config.ts";
import { buildCompetitorMap } from "./identity.ts";
import { toStanding } from "./lifecycle.ts";
import { leaderboardRows, prizePoolCents, rulesView } from "./tech/views.ts";
import type { AccountInput, AccountState, ArenaJob, ArenaRules, CompetitionResult } from "./types.ts";

const OLD_FP = "c122c43bae974c7aa73fc960b19ca921adf646c82b89d67f9eee3fdb21c7d2b4";
const P2_FP = "6ae3d1278fef64bf9e23bdc21bab865c91abae2a71c22efbd5443f7bc38a0d0c";
const CTX = { knownStatuses: SEED_BALANCED_PERFORMANCE.qualifying.statuses, ceilingCents: SEED_SETTINGS_BUDGET_CEILING_CENTS };

test("P2 seed: the old seed is unchanged; P2 differs ONLY in the prize positions; fingerprints", () => {
  assert.equal(rulesHash(SEED_BALANCED_PERFORMANCE), OLD_FP, "approved 6-place fingerprint unchanged");
  assert.deepEqual(SEED_BALANCED_PERFORMANCE.prizes.positionsCents, [45_000, 30_000, 20_000, 15_000, 10_000, 5_000]);
  assert.equal(rulesHash(SEED_BALANCED_PERFORMANCE_P2), P2_FP);
  assert.deepEqual(SEED_BALANCED_PERFORMANCE_P2.prizes, { positionsCents: [55_000, 40_000, 30_000], budgetCents: 150_000 });
  assert.equal(SEED_BALANCED_PERFORMANCE_P2.mostImproved.amountCents, 25_000);
  const strip = (r: ArenaRules) => { const c = cloneRules(r); c.prizes.positionsCents = []; return canonicalJson(c); };
  assert.equal(strip(SEED_BALANCED_PERFORMANCE_P2), strip(SEED_BALANCED_PERFORMANCE), "everything else identical");
  assert.deepEqual(SEED_BALANCED_PERFORMANCE_P2.eligibility, { minQualifyingJobs: 10, minAvgTicketCents: 40_000, minClosingRateBp: 4_000 });
  assert.equal(SEED_BALANCED_PERFORMANCE_P2.scoring.methodology, "BALANCED_PERFORMANCE_V1");
});

test("P2 seed validates at the $1,500 ceiling and pays exactly $1,500 at most", () => {
  assert.deepEqual(validateRules(SEED_BALANCED_PERFORMANCE_P2, CTX), []);
  assert.equal(maxPayoutCents(SEED_BALANCED_PERFORMANCE_P2), 150_000);
  const over = cloneRules(SEED_BALANCED_PERFORMANCE_P2);
  over.prizes.positionsCents[0] += 1;
  assert.match(validateRules(over, CTX).join(), /exceeds the weekly budget/);
});

test("code seeds: explicit ids, the old one still selectable", () => {
  assert.deepEqual(ARENA_RULE_SEEDS.map((s) => s.id), ["balanced-p2-2026-11", "balanced-v1"]);
  assert.equal(ruleSeed("balanced-p2-2026-11")!.rules, SEED_BALANCED_PERFORMANCE_P2);
  assert.equal(ruleSeed("balanced-p2-2026-11")!.label, "Balanced Performance · Prizes 2026-11");
  assert.equal(ruleSeed("balanced-v1")!.rules, SEED_BALANCED_PERFORMANCE);
  assert.equal(ruleSeed("standard"), null);
});

// ── a synthetic week: A..H all eligible, ranks 1..8 by closing rate ────────
const WEEK = "2026-11-02";
const PREV = ["2026-10-26", "2026-10-19", "2026-10-12", "2026-10-05"];
let seq = 0;
const job = (tech: string, status: string, profit: number, date: string): ArenaJob =>
  ({ id: `p${String(++seq).padStart(6, "0")}`, tech, date, status, location: "Chicago", profit, dupKeys: [] });
const block = (tech: string, closed: number, est: number, date: string) => [
  ...Array.from({ length: closed }, () => job(tech, "Closed", 2_000, date)),
  ...Array.from({ length: est }, () => job(tech, "Estimate", 0, date)),
];
const NAMES = ["A", "B", "C", "D", "E", "F", "G", "H"];
const EST = { A: 4, B: 5, C: 6, D: 7, E: 8, F: 9, G: 10, H: 11 } as Record<string, number>; // 10 closed each
/** Baseline per week: A much weaker (+76), D (+40), G (+30), F (+20); the others = their current level (+0). */
const BASE: Record<string, [number, number]> = { A: [2, 4], D: [7, 11], F: [6, 8], G: [7, 13] };
const JOBS = [
  ...NAMES.flatMap((n) => block(n, 10, EST[n], WEEK)),
  ...PREV.flatMap((d) => NAMES.flatMap((n) => block(n, ...(BASE[n] ?? [10, EST[n]]), d))),
];
const map = () => buildCompetitorMap({
  mappings: NAMES.map((n) => ({ supabaseUserId: `u_${n}`, supabaseFullName: n, crmTechNames: [n] })),
  technicians: NAMES.map((n) => ({ _id: n, location: "Chicago" })),
  crmNamesInUse: NAMES,
});
const accounts = (over: Record<string, AccountState> = {}): Record<string, AccountInput> =>
  Object.fromEntries(NAMES.map((n) => [`u_${n}`, { state: over[n] ?? "eligible", checkedAt: "2026-11-09T12:00:00.000Z" }]));
const run = (rules: ArenaRules, over: Record<string, AccountState> = {}) =>
  computeCompetition({ rules, rulesHash: rulesHash(rules), weekStart: WEEK, competitors: map(), jobs: JOBS, accounts: accounts(over) });
const paid = (r: CompetitionResult) => r.results.map((x) => `${x.rank}:${x.displayName}:${x.prizePosition ?? "-"}:${x.prizeCents}${x.wonMostImproved ? ":MI" : ""}`);

test("P2: #1–#3 paid $550/$400/$300; #4–#6 ranked with no cash; Most Improved moves up to the #4–#6 band", () => {
  const p2 = run(cloneRules(SEED_BALANCED_PERFORMANCE_P2));
  assert.deepEqual(p2.results.map((x) => x.displayName), NAMES, "ranking unchanged by prizes");
  assert.deepEqual(p2.results.slice(0, 6).map((x) => x.prizeCents), [55_000, 40_000, 30_000, 25_000, 0, 0]);
  assert.deepEqual(p2.results.slice(3).map((x) => x.prizePosition), [null, null, null, null, null], "no position from #4 down");
  // A (#1) improved most but holds a position → excluded; D (#4) is now MI-eligible and improved most among the rest.
  assert.equal(p2.mostImprovedWinner, "u_D");
  assert.ok(p2.results[0].mostImproved!.improvement > p2.results[3].mostImproved!.improvement);
  assert.equal(p2.awardedCents, 150_000);
  assert.equal(p2.unallocatedCents, 0);
  // Under the 6-place seed, D and F hold positions, so Most Improved goes to G (#7).
  const old = run(cloneRules(SEED_BALANCED_PERFORMANCE));
  assert.equal(old.mostImprovedWinner, "u_G");
  assert.deepEqual(old.results.map((x) => x.prizeCents), [45_000, 30_000, 20_000, 15_000, 10_000, 5_000, 25_000, 0]);
});

test("P2: an account-excluded competitor in the top 3 keeps the rank; the places pass down; they cannot win Most Improved", () => {
  const r = run(cloneRules(SEED_BALANCED_PERFORMANCE_P2), { B: "pending" });
  assert.deepEqual(paid(r).slice(0, 5), ["1:A:1:55000", "2:B:-:0", "3:C:2:40000", "4:D:3:30000", "5:E:-:0"]);
  assert.equal(r.mostImprovedWinner, "u_G", "D now holds #3 → G (+30) beats F (+20)");
});

test("allocatePrizes re-allocates stored results exactly like computeCompetition (both directions)", () => {
  for (const [from, to] of [[SEED_BALANCED_PERFORMANCE, SEED_BALANCED_PERFORMANCE_P2], [SEED_BALANCED_PERFORMANCE_P2, SEED_BALANCED_PERFORMANCE]]) {
    const stored = run(cloneRules(from), { C: "inactive" });
    const direct = run(cloneRules(to), { C: "inactive" });
    const re = structuredClone(stored.results).reverse(); // order of the input must not matter
    const winner = allocatePrizes(cloneRules(to), re);
    re.sort((a, b) => a.rank - b.rank);
    assert.equal(winner, direct.mostImprovedWinner);
    assert.deepEqual(re, direct.results);
  }
  // Same rules → the stored result is reproduced byte for byte.
  const stored = run(cloneRules(SEED_BALANCED_PERFORMANCE));
  const again = structuredClone(stored.results);
  allocatePrizes(cloneRules(SEED_BALANCED_PERFORMANCE), again);
  assert.equal(JSON.stringify(again), JSON.stringify(stored.results));
});

test("technician views follow the rules: 3 places + MI, pool $1,500, #4–#6 shown with no prize", () => {
  const rules = cloneRules(SEED_BALANCED_PERFORMANCE_P2);
  const v = rulesView(rules);
  assert.deepEqual(v.prizesCents, [55_000, 40_000, 30_000]);
  assert.equal(v.mostImprovedCents, 25_000);
  assert.equal(prizePoolCents(rules), 150_000);
  const r = run(rules);
  const rows = leaderboardRows(r.results.map(toStanding), rules, "approved", "u_E", "national");
  assert.deepEqual(rows.map((x) => [x.rank, x.prizeCents]), [[1, 55_000], [2, 40_000], [3, 30_000], [4, 25_000], [5, 0], [6, 0], [7, 0], [8, 0]]);
  assert.ok(rows.slice(4, 6).every((x) => x.eligible && x.score > 0), "#5–#6 stay visible and eligible, just unpaid");
});

// ── official shadow tooling: rules are always named explicitly ─────────────
test("shadow tooling: --template is required; code seeds resolve; an ambiguous local template is refused", async () => {
  const { resolveShadowRules, rulesSummary } = await import("../../../scripts/arena/lib-shadow.ts");
  await assert.rejects(resolveShadowRules(null, async () => null, "arena_x"), /--template <id> is required: "balanced-p2-2026-11"/);
  const p2 = await resolveShadowRules("balanced-p2-2026-11", async () => null, "arena_x");
  assert.equal(rulesHash(p2.rules), P2_FP);
  assert.equal(p2.source, "seed");
  assert.match(p2.label, /Balanced Performance · Prizes 2026-11/);
  assert.notEqual(p2.rules, SEED_BALANCED_PERFORMANCE_P2, "a copy, never the seed object");
  assert.equal(rulesHash((await resolveShadowRules("balanced-v1", null, "arena_x")).rules), OLD_FP, "the old seed stays selectable (no local db needed)");
  // a local template with the same id and the same rules is fine; different rules → refused
  assert.equal((await resolveShadowRules("balanced-p2-2026-11", async () => ({ name: "x", version: 1, rules: SEED_BALANCED_PERFORMANCE_P2 }), "arena_x")).source, "seed");
  await assert.rejects(resolveShadowRules("balanced-p2-2026-11", async () => ({ name: "x", version: 1, rules: SEED_BALANCED_PERFORMANCE }), "arena_x"), /ambiguous/);
  const local = await resolveShadowRules("balanced", async () => ({ name: "Balanced Performance", version: 3, rules: SEED_BALANCED_PERFORMANCE }), "arena_x");
  assert.equal(local.source, "local");
  assert.equal(local.label, "Balanced Performance v3 (local arena_x)");
  await assert.rejects(resolveShadowRules("nope", async () => null, "arena_x"), /not found/);
  assert.ok(rulesSummary(p2.rules).includes("prizes: #1 $550 · #2 $400 · #3 $300 · budget $1,500"));
  assert.ok(rulesSummary(p2.rules).some((l) => l.startsWith("Most Improved: $250;")));
});

test("lib-reallocate: stored result re-allocated = engine run under the new prizes; refuses different scoring rules", async () => {
  const { reallocateStored } = await import("../../../scripts/arena/lib-reallocate.ts");
  const stored = run(cloneRules(SEED_BALANCED_PERFORMANCE), { B: "pending" });
  const direct = run(cloneRules(SEED_BALANCED_PERFORMANCE_P2), { B: "pending" });
  const re = reallocateStored(stored, cloneRules(SEED_BALANCED_PERFORMANCE_P2), SEED_BALANCED_PERFORMANCE);
  assert.deepEqual(re.results, direct.results);
  assert.deepEqual([re.awardedCents, re.unallocatedCents, re.mostImprovedWinner, re.rulesHash], [direct.awardedCents, direct.unallocatedCents, direct.mostImprovedWinner, P2_FP]);
  const same = reallocateStored(stored, cloneRules(SEED_BALANCED_PERFORMANCE), SEED_BALANCED_PERFORMANCE);
  assert.equal(JSON.stringify(same), JSON.stringify(stored), "same rules → byte-identical");
  assert.notEqual(stored.results[0].prizeCents, re.results[0].prizeCents, "the input is not modified");
  assert.equal(stored.results[0].prizeCents, 45_000);
  const other = cloneRules(SEED_BALANCED_PERFORMANCE_P2);
  other.eligibility.minQualifyingJobs = 9;
  assert.throws(() => reallocateStored(stored, other, SEED_BALANCED_PERFORMANCE), /same scoring/);
});
