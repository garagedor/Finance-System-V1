// Technician views under BALANCED_PERFORMANCE_V1: methodology + caps in the
// rules view, weights hidden, per-metric scores + limiting metric, and the
// "raise X to …" next steps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCompetition } from "../engine.ts";
import { buildCompetitorMap } from "../identity.ts";
import { toStanding } from "../lifecycle.ts";
import { SEED_BALANCED_PERFORMANCE, SEED_STANDARD_WEEK, cloneRules, rulesHash } from "../config.ts";
import { leaderboardRows, myStanding, rulesView } from "./views.ts";
import type { ArenaJob, ArenaRules } from "../types.ts";

const WEEK = "2026-11-02";
let n = 0;
const many = (k: number, tech: string, status: string, profit: number): ArenaJob[] =>
  Array.from({ length: k }, () => ({ id: `j${++n}`, tech, date: WEEK, status, location: "X", profit, dupKeys: [] }));
const person = (name: string, total: number, closed: number, profit: number) => [...many(closed, name, "Closed", profit), ...many(total - closed, name, "Estimate", 0)];

function standings(rules: ArenaRules, jobs: ArenaJob[], names: string[]) {
  const competitors = buildCompetitorMap({
    mappings: names.map((x) => ({ supabaseUserId: `u_${x}`, supabaseFullName: x, crmTechNames: [x] })),
    technicians: names.map((x) => ({ _id: x, location: "X" })), crmNamesInUse: names,
  });
  const accounts = Object.fromEntries(names.map((x) => [`u_${x}`, { state: "eligible" as const, checkedAt: "t" }]));
  return computeCompetition({ rules, rulesHash: rulesHash(rules), weekStart: WEEK, competitors, jobs, accounts }).results.map(toStanding);
}
const V1 = () => {
  const r = cloneRules(SEED_BALANCED_PERFORMANCE);
  r.eligibility = { minQualifyingJobs: 0, minAvgTicketCents: 0, minClosingRateBp: 0 };
  return r;
};

test("rules view: methodology, both caps, weights hidden (null) under V1; V0 unchanged", () => {
  const v = rulesView(V1());
  assert.equal(v.methodology, "BALANCED_PERFORMANCE_V1");
  assert.equal(v.closingRateWeight, null);
  assert.equal(v.avgTicketWeight, null);
  assert.deepEqual([v.capC, v.capA], [1.5, 1.5]);
  const v0 = rulesView(cloneRules(SEED_STANDARD_WEEK));
  assert.equal(v0.methodology, "WEIGHTED_V0");
  assert.deepEqual([v0.closingRateWeight, v0.avgTicketWeight], [0.6, 0.4]);
});

test("leaderboard rows: C, A and the limiting metric; final = min(C, A)", () => {
  const s = standings(V1(), [...person("Ann", 20, 9, 15000 / 9), ...person("Bo", 10, 5, 1000)], ["Ann", "Bo"]);
  const rows = leaderboardRows(s, V1(), "live", "u_Bo", "national");
  const ann = rows.find((r) => r.competitorId === "u_Ann")!;
  assert.deepEqual([ann.closingScore, ann.avgScore, ann.score, ann.limitingMetric], [90, 150, 90, "closingRate"]);
  const bo = rows.find((r) => r.competitorId === "u_Bo")!;
  assert.equal(bo.limitingMetric, "both");
  assert.equal(bo.rank, 1);
});

test("hidden metrics hide the metric scores too", () => {
  const r = V1();
  r.eligibility.minQualifyingJobs = 50;
  r.display.showIneligibleMetrics = false;
  const rows = leaderboardRows(standings(r, person("Ann", 10, 5, 1000), ["Ann"]), r, "live", "u_x", "national");
  assert.deepEqual([rows[0].closingScore, rows[0].avgScore, rows[0].limitingMetric], [null, null, null]);
});

test("next steps: raise the LIMITING metric to pass the next rank (live)", () => {
  const rules = V1();
  // Bo: C 90 (CR 45%), A 150 → final 90; Ann: final 100 (both at target)
  const s = standings(rules, [...person("Ann", 10, 5, 1000), ...person("Bo", 20, 9, 15000 / 9)], ["Ann", "Bo"]);
  const me = s.find((x) => x.competitorId === "u_Bo")!;
  const m = myStanding(me, s, rules, "live");
  assert.equal(m.limitingMetric, "closingRate");
  assert.deepEqual([m.closingScore, m.avgScore, m.score], [90, 150, 90]);
  const steps = m.nextSteps.filter((x) => x.kind === "raise_score");
  assert.equal(steps.length, 1, "only the limiting metric needs to move");
  assert.match(steps[0].text, /^Raise your closing rate to 50% \(now 45%\) to pass #1$/);
  assert.equal(steps[0].amount, 500); // basis points
});

test("next steps: rank 1 below target → reach the 100-point target; both metrics listed when both are short", () => {
  const rules = V1();
  const s = standings(rules, person("Ann", 10, 4, 1000), ["Ann"]); // CR 40% → C 80; AVG 400 → A 80
  const m = myStanding(s[0], s, rules, "live");
  const texts = m.nextSteps.filter((x) => x.kind === "raise_score").map((x) => x.text);
  assert.deepEqual(texts, ["Raise your closing rate to 50% (now 40%) to reach the 100-point target", "Raise your AVG TICKET to $500 (now $400) to reach the 100-point target"]);
});

test("WEIGHTED_V0: no raise_score steps and no limiting metric", () => {
  const rules = cloneRules(SEED_STANDARD_WEEK);
  rules.eligibility = { minQualifyingJobs: 0, minAvgTicketCents: 0, minClosingRateBp: 0 };
  const s = standings(rules, person("Ann", 10, 4, 1000), ["Ann"]);
  const m = myStanding(s[0], s, rules, "live");
  assert.equal(m.limitingMetric, null);
  assert.ok(!m.nextSteps.some((x) => x.kind === "raise_score"));
});
