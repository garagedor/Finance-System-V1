// Regression tests — owner rule 2026-11-03:
// "X CLOSE COUNTS AS AN ASSIGNED JOB BUT NOT AS A SUCCESSFUL CLOSING. IT MUST HURT
//  PERFORMANCE STATISTICS JUST LIKE ESTIMATE." AVG TICKET keeps the official CRM
// definition: Σ profit of non-X-close jobs ÷ ALL assigned jobs (CRM Home Leaderboard
// `sumProfitExclXClose / count`). No extra Arena penalty: score = min(C, A) only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCompetition, officialKpis } from "./engine.ts";
import { SEED_BALANCED_PERFORMANCE_P2, cloneRules, rulesHash } from "./config.ts";
import { buildCompetitorMap } from "./identity.ts";
import type { ArenaJob, ArenaRules } from "./types.ts";

const WEEK = "2026-11-09";
let seq = 0;
const job = (tech: string, status: string, profit: number): ArenaJob => {
  seq += 1;
  return { id: `x${String(seq).padStart(6, "0")}`, tech, date: WEEK, status, location: "Chicago", profit, dupKeys: [] };
};
const many = (n: number, tech: string, status: string, profit: number) => Array.from({ length: n }, () => job(tech, status, profit));
const people = (...names: string[]) =>
  buildCompetitorMap({
    mappings: names.map((n) => ({ supabaseUserId: `u_${n}`, supabaseFullName: n, crmTechNames: [n] })),
    technicians: names.map((n) => ({ _id: n, location: "Chicago" })),
    crmNamesInUse: names,
  });
const run = (jobs: ArenaJob[], names: string[], rules: ArenaRules = cloneRules(SEED_BALANCED_PERFORMANCE_P2)) =>
  computeCompetition({
    rules, rulesHash: rulesHash(rules), weekStart: WEEK, competitors: people(...names), jobs, exclusions: [],
    accounts: Object.fromEntries(names.map((n) => [`u_${n}`, { state: "eligible" as const, checkedAt: "2026-11-16T12:00:00.000Z" }])),
  });
const row = (r: ReturnType<typeof run>, n: string) => r.results.find((x) => x.competitorId === `u_${n}`)!;

test("owner example: 15 assigned = 11 Closed + 4 X close → assigned 15, CR 73.33%, X close stays in both denominators", () => {
  const jobs = [...many(11, "Ann", "Closed", 900), ...many(4, "Ann", "X close", 250)];
  const r = row(run(jobs, ["Ann"]), "Ann");
  assert.equal(r.assignedJobs, 15);
  assert.equal(r.closedJobs, 11);
  assert.equal(r.xCloseJobs, 4);
  assert.equal(r.qualifyingJobs, 15, "X close counts toward the job minimum");
  assert.ok(Math.abs(r.closingRate - 11 / 15) < 1e-12, "11 / 15 = 73.33%, never 11 / 11");
  assert.ok(Math.abs(r.avgTicket - (11 * 900) / 15) < 1e-9, "X close amount not credited as profit; all 15 jobs in the denominator");
  const k = officialKpis(jobs);
  assert.equal(k.assigned, 15);
  assert.ok(Math.abs(k.closingRate - r.closingRate) < 1e-12 && Math.abs(k.avgTicket - r.avgTicket) < 1e-9, "engine = official CRM KPIs");
});

test("X close hurts exactly like Estimate (same CR, same AVG when the X close amount is the CRM-excluded penalty base)", () => {
  const withX = row(run([...many(11, "Ann", "Closed", 900), ...many(4, "Ann", "X close", 250)], ["Ann"]), "Ann");
  const withEst = row(run([...many(11, "Bob", "Closed", 900), ...many(4, "Bob", "Estimate", 0)], ["Bob"]), "Bob");
  for (const k of ["assignedJobs", "closedJobs", "qualifyingJobs"] as const) assert.equal(withX[k], withEst[k], k);
  assert.ok(Math.abs(withX.closingRate - withEst.closingRate) < 1e-12);
  assert.ok(Math.abs(withX.avgTicket - withEst.avgTicket) < 1e-9);
  assert.ok(Math.abs(withX.score - withEst.score) < 1e-9);
});

test("removing the X close jobs would inflate the closing rate — the engine never does that", () => {
  const r = row(run([...many(10, "Cy", "Closed", 600), ...many(5, "Cy", "X close", 300)], ["Cy"]), "Cy");
  assert.notEqual(r.closingRate, 1);
  assert.ok(Math.abs(r.closingRate - 10 / 15) < 1e-12);
});

test("no double penalty: score = min(C, A) of the official KPIs, nothing else subtracted for X close", () => {
  const r = row(run([...many(11, "Ann", "Closed", 900), ...many(4, "Ann", "X close", 250)], ["Ann"]), "Ann");
  const C = 100 * Math.min(r.closingRate / 0.5, 1.5);
  const A = 100 * Math.min(r.avgTicket / 500, 1.5);
  assert.ok(Math.abs(r.score - Math.min(C, A)) < 1e-9);
});

test("X close and Estimate count toward the 10-job minimum: 6 Closed + 2 Estimate + 2 X close = 10 → meets the job gate", () => {
  const r = row(run([...many(6, "Dee", "Closed", 1000), ...many(2, "Dee", "Estimate", 0), ...many(2, "Dee", "X close", 200)], ["Dee"]), "Dee");
  assert.equal(r.qualifyingJobs, 10);
  assert.equal(r.gates.jobs.met, true);
  assert.equal(r.closingRate, 0.6);
});

test("Closed + X close pair (two separate records): both assigned, only the Closed one is a success", () => {
  const jobs = [job("Eve", "Closed", 49.4), job("Eve", "X close", 250), ...many(8, "Eve", "Closed", 700)];
  const r = row(run(jobs, ["Eve"]), "Eve");
  assert.equal(r.assignedJobs, 10);
  assert.equal(r.closedJobs, 9);
  assert.ok(Math.abs(r.avgTicket - (49.4 + 8 * 700) / 10) < 1e-9);
});
