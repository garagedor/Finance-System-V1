// Owner rule 2026-11-09 — "the job minimum counts ALL assigned jobs": a NEW
// versioned rule (eligibility.jobCountBasis = "assigned") and a NEW template
// SEED_BALANCED_PERFORMANCE_P3. The minimum counts every job with the
// technician and a date in the week, any status (the CRM's official Closing
// Rate denominator); only separately approved Arena exclusions deduct. Closing
// Rate and AVG TICKET are unchanged. Every older rule version keeps its exact
// behaviour and fingerprint (field absent = "qualifying").
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCompetition, countsTowardJobMinimum, jobCountBasisOf, officialKpis } from "./engine.ts";
import {
  ARENA_RULE_SEEDS, SEED_BALANCED_PERFORMANCE, SEED_BALANCED_PERFORMANCE_P2, SEED_BALANCED_PERFORMANCE_P3,
  SEED_SETTINGS_BUDGET_CEILING_CENTS, SEED_STANDARD_WEEK, canonicalJson, cloneRules, ruleSeed, rulesHash, validateRules,
} from "./config.ts";
import { buildCompetitorMap } from "./identity.ts";
import { toStanding } from "./lifecycle.ts";
import { myStanding, rulesView } from "./tech/views.ts";
import { rulesSummary } from "../../../scripts/arena/lib-shadow.ts";
import { KNOWN_STATUSES } from "../status-canonical.ts";
import type { ArenaJob, ArenaRules, JobExclusion } from "./types.ts";

const OLD_FP = "c122c43bae974c7aa73fc960b19ca921adf646c82b89d67f9eee3fdb21c7d2b4";
const P2_FP = "6ae3d1278fef64bf9e23bdc21bab865c91abae2a71c22efbd5443f7bc38a0d0c";
const P3_FP = "eb7a73cd8fc841c8dc1b28e54ddeb36ae0593dc08c8b96a84da8f9a7e56e5a1f";
const CTX = { knownStatuses: KNOWN_STATUSES, ceilingCents: SEED_SETTINGS_BUDGET_CEILING_CENTS };

const WEEK = "2026-11-09";
const BASELINE = ["2026-11-02", "2026-10-26", "2026-10-19", "2026-10-12"];
let seq = 0;
const job = (tech: string, status: string, profit: number, date = WEEK): ArenaJob =>
  ({ id: `ab${String(++seq).padStart(6, "0")}`, tech, date, status, location: "Chicago", profit, dupKeys: [] });
const many = (n: number, tech: string, status: string, profit: number, date = WEEK) => Array.from({ length: n }, () => job(tech, status, profit, date));
const people = (...names: string[]) =>
  buildCompetitorMap({
    mappings: names.map((n) => ({ supabaseUserId: `u_${n}`, supabaseFullName: n, crmTechNames: [n] })),
    technicians: names.map((n) => ({ _id: n, location: "Chicago" })),
    crmNamesInUse: names,
  });
const run = (jobs: ArenaJob[], names: string[], rules: ArenaRules, exclusions: JobExclusion[] = []) =>
  computeCompetition({
    rules, rulesHash: rulesHash(rules), weekStart: WEEK, competitors: people(...names), jobs, exclusions,
    accounts: Object.fromEntries(names.map((n) => [`u_${n}`, { state: "eligible" as const, checkedAt: "2026-11-16T12:00:00.000Z" }])),
  });
const row = (r: ReturnType<typeof run>, n: string) => r.results.find((x) => x.competitorId === `u_${n}`)!;
const P3 = () => cloneRules(SEED_BALANCED_PERFORMANCE_P3);
const P2 = () => cloneRules(SEED_BALANCED_PERFORMANCE_P2);

/** The owner's example: 15 assigned = 8 Closed + 4 cancellations + 2 X close + 1 Pending. */
const ownerExample = (tech = "Ann") => [
  ...many(8, tech, "Closed", 700),
  job(tech, "Cancel by Office", 0), job(tech, "Cancel by Office", 0),
  job(tech, "Customer Canceled", 0), job(tech, "Customer Canceled", 0),
  ...many(2, tech, "X close", 250),
  job(tech, "Pending", 0),
];

// ── versioning: old seeds and history untouched ────────────────────────────

test("old seeds are byte-identical: fingerprints unchanged, no jobCountBasis field", () => {
  assert.equal(rulesHash(SEED_BALANCED_PERFORMANCE), OLD_FP);
  assert.equal(rulesHash(SEED_BALANCED_PERFORMANCE_P2), P2_FP);
  for (const r of [SEED_STANDARD_WEEK, SEED_BALANCED_PERFORMANCE, SEED_BALANCED_PERFORMANCE_P2]) {
    assert.equal("jobCountBasis" in r.eligibility, false);
    assert.doesNotMatch(canonicalJson(r), /jobCountBasis/);
    assert.equal(jobCountBasisOf(r), "qualifying", "absent = qualifying");
  }
  assert.deepEqual(SEED_BALANCED_PERFORMANCE_P2.eligibility, { minQualifyingJobs: 10, minAvgTicketCents: 40_000, minClosingRateBp: 4_000 });
});

test("P3 = P2 + jobCountBasis assigned, nothing else; validates; fingerprint differs from P2", () => {
  const strip = (r: ArenaRules) => { const c = cloneRules(r); delete c.eligibility.jobCountBasis; return canonicalJson(c); };
  assert.equal(strip(SEED_BALANCED_PERFORMANCE_P3), canonicalJson(SEED_BALANCED_PERFORMANCE_P2));
  assert.equal(SEED_BALANCED_PERFORMANCE_P3.eligibility.jobCountBasis, "assigned");
  assert.deepEqual(SEED_BALANCED_PERFORMANCE_P3.prizes, { positionsCents: [55_000, 40_000, 30_000], budgetCents: 150_000 });
  assert.equal(SEED_BALANCED_PERFORMANCE_P3.mostImproved.amountCents, 25_000);
  assert.deepEqual(validateRules(SEED_BALANCED_PERFORMANCE_P3, CTX), []);
  assert.notEqual(rulesHash(SEED_BALANCED_PERFORMANCE_P3), P2_FP);
  assert.equal(rulesHash(SEED_BALANCED_PERFORMANCE_P3), P3_FP, "the P3 fingerprint (pinned)");
  const seed = ruleSeed("balanced-p3-2026-11")!;
  assert.equal(seed.rules, SEED_BALANCED_PERFORMANCE_P3);
  assert.equal(seed.label, "Balanced Performance · Assigned jobs · Prizes 2026-11");
  assert.equal(seed.code, "SEED_BALANCED_PERFORMANCE_P3");
  assert.deepEqual(ARENA_RULE_SEEDS.map((s) => s.id), ["balanced-p3-2026-11", "balanced-p2-2026-11", "balanced-v1"]);
});

test("an explicit jobCountBasis 'qualifying' behaves like the absent field; the canonical hash of the absent field is unchanged", () => {
  const explicit = P2();
  explicit.eligibility.jobCountBasis = "qualifying";
  const jobs = ownerExample();
  assert.deepEqual(row(run(jobs, ["Ann"], explicit), "Ann").gates, row(run(jobs, ["Ann"], P2()), "Ann").gates);
  assert.equal(rulesHash(P2()), P2_FP, "a clone without the field hashes exactly like the seed");
});

test("validateRules accepts assigned / qualifying / absent and refuses anything else", () => {
  for (const b of ["assigned", "qualifying", undefined] as const) {
    const r = P2();
    if (b) r.eligibility.jobCountBasis = b; else delete r.eligibility.jobCountBasis;
    assert.deepEqual(validateRules(r, CTX), [], String(b));
  }
  const bad = P2();
  (bad.eligibility as { jobCountBasis?: string }).jobCountBasis = "closed";
  assert.match(validateRules(bad, CTX).join(), /unknown job count basis "closed"/);
  const neg = P3();
  neg.eligibility.minQualifyingJobs = -1;
  assert.match(validateRules(neg, CTX).join(), /minimum assigned jobs must be a whole number/);
});

// ── the owner's example ────────────────────────────────────────────────────

test("owner example (P3): 15 assigned = 8 Closed + 4 cancellations + 2 X close + 1 Pending → job count 15, CR 8/15 = 53.33%, meets the 10-job minimum", () => {
  const jobs = ownerExample();
  const r = row(run(jobs, ["Ann"], P3()), "Ann");
  assert.equal(r.assignedJobs, 15);
  assert.equal(r.qualifyingJobs, 15, "every assigned job counts toward the minimum");
  assert.equal(r.closedJobs, 8);
  assert.ok(Math.abs(r.closingRate - 8 / 15) < 1e-12);
  assert.equal((r.closingRate * 100).toFixed(2), "53.33");
  assert.deepEqual(r.gates.jobs, { met: true, actual: 15, required: 10 });
  assert.equal(r.gates.closingRate.met, true, "53.33% ≥ 40%");
  // AVG TICKET: Σ profit of non-X-close jobs / ALL assigned — the CRM definition, unchanged.
  assert.ok(Math.abs(r.avgTicket - (8 * 700) / 15) < 1e-9);
  const k = officialKpis(jobs);
  assert.ok(Math.abs(k.closingRate - r.closingRate) < 1e-12 && Math.abs(k.avgTicket - r.avgTicket) < 1e-9, "engine = official CRM KPIs");
});

test("same week under P2 (qualifying basis): only Closed + X close qualify → 10 jobs; KPIs identical; the basis changes the job count ONLY", () => {
  const jobs = ownerExample();
  const p2 = row(run(jobs, ["Ann"], P2()), "Ann");
  const p3 = row(run(jobs, ["Ann"], P3()), "Ann");
  assert.equal(p2.qualifyingJobs, 10);
  assert.equal(p3.qualifyingJobs, 15);
  for (const k of ["assignedJobs", "closedJobs", "xCloseJobs", "profitMicro", "closingRate", "avgTicket", "score", "closingScore", "avgScore"] as const)
    assert.equal(p3[k], p2[k], k);
});

test("a 12-job week with only 6 Closed + X close fails P2's minimum and passes P3's", () => {
  const jobs = [...many(5, "Bo", "Closed", 900), job("Bo", "X close", 0), ...many(3, "Bo", "Customer Canceled", 0), job("Bo", "No answer", 0), job("Bo", "OOA", 0), job("Bo", "", 0)];
  assert.equal(row(run(jobs, ["Bo"], P2()), "Bo").gates.jobs.met, false);
  const r = row(run(jobs, ["Bo"], P3()), "Bo");
  assert.deepEqual(r.gates.jobs, { met: true, actual: 12, required: 10 });
});

test("every CRM status — and a blank one — counts toward the assigned minimum", () => {
  const pred = countsTowardJobMinimum(P3());
  for (const s of [...KNOWN_STATUSES, "", "Something new"]) assert.equal(pred(s), true, JSON.stringify(s));
  const q = countsTowardJobMinimum(P2());
  assert.equal(q("Pending"), false);
  assert.equal(q("Closed"), true);
});

test("X close and cancellations both count toward the minimum and are never successes", () => {
  const jobs = [...many(4, "Cy", "X close", 300), ...many(3, "Cy", "Cancel by Office", 0), ...many(3, "Cy", "Customer Canceled", 0)];
  const r = row(run(jobs, ["Cy"], P3()), "Cy");
  assert.equal(r.qualifyingJobs, 10);
  assert.equal(r.gates.jobs.met, true);
  assert.equal(r.closedJobs, 0);
  assert.equal(r.closingRate, 0);
  assert.equal(r.gates.closingRate.met, false);
  assert.equal(r.avgTicket, 0, "X close profit is never credited");
  assert.equal(r.eligible, false);
});

test("confirmed duplicate / admin exclusions deduct from the job count ONLY (CR and AVG unchanged)", () => {
  const jobs = ownerExample("Dee");
  const base = row(run(jobs, ["Dee"], P3()), "Dee");
  const pending = jobs.find((j) => j.status === "Pending")!;
  const cancel = jobs.find((j) => j.status === "Cancel by Office")!;
  const ex: JobExclusion[] = [
    { jobId: pending.id, kind: "duplicate", reason: "confirmed duplicate", by: "owner", at: "2026-11-16T00:00:00Z" },
    { jobId: cancel.id, kind: "erroneous_assignment", reason: "wrong tech", by: "owner", at: "2026-11-16T00:00:00Z" },
  ];
  const r = row(run(jobs, ["Dee"], P3(), ex), "Dee");
  assert.equal(r.qualifyingJobs, 13);
  assert.equal(r.excludedFromQualifying, 2);
  assert.equal(r.assignedJobs, 15, "still in the official denominator");
  for (const k of ["closedJobs", "profitMicro", "closingRate", "avgTicket", "score"] as const) assert.equal(r[k], base[k], k);
  // Under P2 the Pending / Cancel jobs never counted, so the same exclusions change nothing there.
  const p2 = row(run(jobs, ["Dee"], P2(), ex), "Dee");
  assert.equal(p2.qualifyingJobs, 10);
  assert.equal(p2.excludedFromQualifying, 0);
  // A revoked exclusion deducts nothing.
  const revoked = row(run(jobs, ["Dee"], P3(), [{ ...ex[0], revokedAt: "2026-11-17T00:00:00Z" }]), "Dee");
  assert.equal(revoked.qualifyingJobs, 15);
});

test("exclusions can take a P3 technician below the minimum (11 assigned − 2 duplicates = 9)", () => {
  const jobs = [...many(6, "Eve", "Closed", 800), ...many(5, "Eve", "Reschedule", 0)];
  const ex: JobExclusion[] = jobs.filter((j) => j.status === "Reschedule").slice(0, 2)
    .map((j) => ({ jobId: j.id, kind: "duplicate" as const, reason: "dup", by: "o", at: "2026-11-16T00:00:00Z" }));
  assert.equal(row(run(jobs, ["Eve"], P3()), "Eve").gates.jobs.met, true);
  const r = row(run(jobs, ["Eve"], P3(), ex), "Eve");
  assert.deepEqual(r.gates.jobs, { met: false, actual: 9, required: 10 });
});

// ── Most Improved baseline on the assigned basis ───────────────────────────

test("Most Improved: a baseline week is valid on the ASSIGNED count under P3 (≥ 5 assigned), on qualifying under P2", () => {
  // Baseline weeks: 2 Closed + 3 Customer Canceled = 5 assigned, but only 2 qualifying.
  const baseline = BASELINE.flatMap((w) => [...many(2, "Fay", "Closed", 500, w), ...many(3, "Fay", "Customer Canceled", 0, w)]);
  const current = [...many(9, "Fay", "Closed", 900), job("Fay", "Estimate", 0)];
  const p3 = row(run([...baseline, ...current], ["Fay"], P3()), "Fay");
  assert.ok(p3.mostImproved, "baseline valid on assigned jobs");
  assert.equal(p3.mostImproved!.validWeeks, 4);
  const pooled = officialKpis(baseline);
  assert.ok(Math.abs(pooled.closingRate - 0.4) < 1e-12, "the baseline score uses the official KPIs (2 / 5 per week)");
  const p2 = row(run([...baseline, ...current], ["Fay"], P2()), "Fay");
  assert.equal(p2.mostImproved, null, "only 2 qualifying jobs per baseline week under P2");
});

test("Most Improved (P3): a baseline week with 4 assigned jobs is not valid", () => {
  const baseline = BASELINE.flatMap((w) => [...many(2, "Gus", "Closed", 500, w), ...many(2, "Gus", "Pending", 0, w)]);
  const r = row(run([...baseline, ...many(10, "Gus", "Closed", 900)], ["Gus"], P3()), "Gus");
  assert.equal(r.mostImproved, null);
});

// ── technician views and tooling text ──────────────────────────────────────

test("tech views: rulesView carries jobCountBasis; next steps say 'assigned jobs' under P3, 'qualifying jobs' under P2", () => {
  assert.equal(rulesView(P3()).jobCountBasis, "assigned");
  assert.equal(rulesView(P2()).jobCountBasis, "qualifying");
  const jobs = [...many(5, "Hal", "Closed", 900), ...many(2, "Hal", "Pending", 0)];
  for (const [rules, word, need] of [[P3(), "assigned", 3], [P2(), "qualifying", 5]] as const) {
    const res = run(jobs, ["Hal"], rules);
    const s = myStanding(toStanding(row(res, "Hal")), res.results.map(toStanding), rules, "live");
    const step = s.nextSteps.find((x) => x.kind === "jobs")!;
    assert.equal(step.amount, need);
    assert.equal(step.text, `${need} more ${word} jobs to meet the 10-job minimum`);
    assert.equal(s.gates.jobs.actual, 10 - need);
  }
});

test("shadow rules summary names the basis for P3 and is unchanged for P2", () => {
  const p3 = rulesSummary(P3()).join("\n");
  assert.match(p3, /minimums: 10 assigned jobs \(every status; jobCountBasis assigned\)/);
  assert.match(p3, /≥ 5 assigned jobs per baseline week/);
  const p2 = rulesSummary(P2()).join("\n");
  assert.match(p2, /minimums: 10 qualifying jobs · AVG/);
  assert.doesNotMatch(p2, /\d assigned jobs/);
});

test("parity: officialKpis is unchanged — CR = Closed / all assigned, AVG = Σ non-X-close profit / all assigned", () => {
  const jobs = [...ownerExample("Ivy"), job("Ivy", "", 120), job("Ivy", "Client Fixed It", 0)];
  const k = officialKpis(jobs);
  assert.equal(k.assigned, 17);
  assert.equal(k.closed, 8);
  assert.ok(Math.abs(k.closingRate - 8 / 17) < 1e-12);
  assert.ok(Math.abs(k.avgTicket - (8 * 700 + 120) / 17) < 1e-9);
  for (const rules of [P2(), P3(), cloneRules(SEED_STANDARD_WEEK)]) {
    const r = row(run(jobs, ["Ivy"], rules), "Ivy");
    assert.ok(Math.abs(r.closingRate - k.closingRate) < 1e-12 && Math.abs(r.avgTicket - k.avgTicket) < 1e-9);
  }
});
