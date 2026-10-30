import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCompetition, officialKpis } from "./engine.ts";
import { SEED_STANDARD_WEEK, cloneRules, rulesHash, validateRules } from "./config.ts";
import { buildCompetitorMap } from "./identity.ts";
import type { AccountInput, AccountState, ArenaJob, ArenaRules, JobExclusion } from "./types.ts";

const WEEK = "2026-11-02"; // a Monday
let seq = 0;
function job(tech: string, status: string, profit: number, date = WEEK, dupKeys: string[] = []): ArenaJob {
  seq += 1;
  return { id: `j${String(seq).padStart(6, "0")}`, tech, date, status, location: "Milwaukee", profit, dupKeys };
}
function many(n: number, tech: string, status: string, profit: number, date = WEEK) {
  return Array.from({ length: n }, () => job(tech, status, profit, date));
}
function people(...names: string[]) {
  return buildCompetitorMap({
    mappings: names.map((n) => ({ supabaseUserId: `u_${n}`, supabaseFullName: n, crmTechNames: [n] })),
    technicians: names.map((n) => ({ _id: n, location: "Milwaukee" })),
    crmNamesInUse: names,
  });
}
const CHECKED = "2026-11-08T12:00:00.000Z";
/** Every named person eligible, except the overrides. */
function accountsFor(names: string[], over: Record<string, AccountState> = {}): Record<string, AccountInput> {
  return Object.fromEntries(names.map((n) => [`u_${n}`, { state: over[n] ?? "eligible", checkedAt: CHECKED }]));
}
function run(
  jobs: ArenaJob[],
  names: string[],
  rules: ArenaRules = cloneRules(SEED_STANDARD_WEEK),
  exclusions: JobExclusion[] = [],
  accounts: Record<string, AccountInput> = accountsFor(names),
) {
  return computeCompetition({ rules, rulesHash: rulesHash(rules), weekStart: WEEK, competitors: people(...names), jobs, exclusions, accounts });
}
const row = (r: ReturnType<typeof run>, name: string) => r.results.find((x) => x.competitorId === `u_${name}`)!;

// ── brief QA cases ─────────────────────────────────────────────────────────

test("9 qualifying jobs fails a 10-job minimum", () => {
  const r = run(many(9, "Ann", "Closed", 1000), ["Ann"]);
  assert.equal(row(r, "Ann").gates.jobs.met, false);
  assert.equal(row(r, "Ann").eligible, false);
});

test("AVG $399.99 fails a $400 minimum; exactly $400.00 passes", () => {
  const fail = run([...many(9, "Ann", "Closed", 400), job("Ann", "Closed", 399.9)], ["Ann"]);
  assert.equal(row(fail, "Ann").avgTicket.toFixed(2), "399.99");
  assert.equal(row(fail, "Ann").gates.avgTicket.met, false);
  const pass = run(many(10, "Ann", "Closed", 400), ["Ann"]);
  assert.equal(row(pass, "Ann").gates.avgTicket.met, true);
  assert.equal(row(pass, "Ann").eligible, true);
});

test("Closing Rate 39.99% fails a 40% minimum; exactly 40% passes", () => {
  const fail = run([...many(3999, "Ann", "Closed", 2000), ...many(6001, "Ann", "Estimate", 0)], ["Ann"]);
  assert.equal(row(fail, "Ann").closingRate, 0.3999);
  assert.equal(row(fail, "Ann").gates.closingRate.met, false);
  assert.equal(row(fail, "Ann").eligible, false);
  const pass = run([...many(4, "Bo", "Closed", 2000), ...many(6, "Bo", "Estimate", 0)], ["Bo"]);
  assert.equal(row(pass, "Bo").gates.closingRate.met, true);
  assert.equal(row(pass, "Bo").eligible, true);
});

test("meeting all three thresholds qualifies", () => {
  const r = run([...many(5, "Ann", "Closed", 1000), ...many(5, "Ann", "Estimate", 0)], ["Ann"]);
  const a = row(r, "Ann");
  assert.deepEqual([a.gates.jobs.met, a.gates.avgTicket.met, a.gates.closingRate.met, a.eligible], [true, true, true, true]);
});

test("an ineligible high-scoring technician cannot take a prize position", () => {
  const jobs = [...many(9, "Star", "Closed", 3000), ...many(10, "Steady", "Closed", 450)];
  const r = run(jobs, ["Star", "Steady"]);
  assert.equal(row(r, "Star").rank, 1);
  assert.equal(row(r, "Star").prizePosition, null);
  assert.equal(row(r, "Star").prizeCents, 0);
  assert.equal(row(r, "Steady").prizePosition, 1);
});

test("a technician becomes eligible the moment all thresholds are satisfied", () => {
  const nine = many(9, "Ann", "Closed", 1000);
  assert.equal(row(run(nine, ["Ann"]), "Ann").eligible, false);
  assert.equal(row(run([...nine, job("Ann", "Estimate", 0)], ["Ann"]), "Ann").eligible, true);
});

test("a corrected or invalidated job can alter eligibility", () => {
  const jobs = [...many(4, "Ann", "Closed", 1500), ...many(6, "Ann", "Estimate", 0)];
  assert.equal(row(run(jobs, ["Ann"]), "Ann").eligible, true);
  // status corrected Closed → Cancel by Office: CR 3/10, and one fewer qualifying job
  const corrected = jobs.map((j, i) => (i === 0 ? { ...j, status: "Cancel by Office" } : j));
  assert.equal(row(run(corrected, ["Ann"]), "Ann").eligible, false);
  // job deleted in the CRM: 9 qualifying jobs
  assert.equal(row(run(jobs.slice(1), ["Ann"]), "Ann").gates.jobs.met, false);
  // job reassigned to another technician moves with it
  const moved = jobs.map((j, i) => (i === 9 ? { ...j, tech: "Bo" } : j));
  const r = run(moved, ["Ann", "Bo"]);
  assert.equal(row(r, "Ann").assignedJobs, 9);
  assert.equal(row(r, "Bo").assignedJobs, 1);
});

test("duplicate ingestion does not inflate statistics", () => {
  const base = [...many(5, "Ann", "Closed", 1000), ...many(5, "Ann", "Estimate", 0)];
  const once = row(run(base, ["Ann"]), "Ann");
  // the same production job delivered twice is counted once
  const twice = row(run([...base, ...base.slice(0, 3)], ["Ann"]), "Ann");
  assert.deepEqual(
    [twice.assignedJobs, twice.closedJobs, twice.qualifyingJobs, twice.profitMicro],
    [once.assignedJobs, once.closedJobs, once.qualifyingJobs, once.profitMicro],
  );
});

test("suspected duplicates are flagged, never auto-removed; a confirmed duplicate leaves the official KPIs alone", () => {
  const a = job("Ann", "Closed", 800, WEEK, ["phone:x"]);
  const b = job("Ann", "Closed", 800, WEEK, ["phone:x"]);
  const jobs = [a, b, ...many(3, "Ann", "Closed", 800), ...many(6, "Ann", "Estimate", 0)];
  const r = run(jobs, ["Ann"]);
  assert.equal(r.duplicateGroups.length, 1);
  assert.deepEqual(r.duplicateGroups[0].jobIds, [a.id, b.id].sort());
  assert.equal(r.duplicateGroups[0].mayAffectPrizes, true);
  assert.equal(row(r, "Ann").qualifyingJobs, 11);

  const ex: JobExclusion = { jobId: b.id, kind: "duplicate", reason: "same visit", by: "owner", at: "2026-11-09T00:00:00Z" };
  const r2 = run(jobs, ["Ann"], undefined, [ex]);
  const ann = row(r2, "Ann");
  assert.equal(ann.qualifyingJobs, 10);
  assert.equal(ann.excludedFromQualifying, 1);
  assert.equal(ann.closingRate, row(r, "Ann").closingRate); // official KPI unchanged
  assert.equal(ann.avgTicket, row(r, "Ann").avgTicket);
  assert.equal(r2.duplicateGroups[0].mayAffectPrizes, false); // resolved

  const revoked = run(jobs, ["Ann"], undefined, [{ ...ex, revokedAt: "2026-11-09T01:00:00Z" }]);
  assert.equal(row(revoked, "Ann").qualifyingJobs, 11);
});

test("no prize combination can exceed the budget (randomised configs)", () => {
  let rnd = 7;
  const rand = (n: number) => ((rnd = (rnd * 1103515245 + 12345) % 2 ** 31), rnd % n);
  for (let k = 0; k < 300; k++) {
    const rules = cloneRules(SEED_STANDARD_WEEK);
    rules.prizes.positionsCents = Array.from({ length: 1 + rand(10) }, () => 100 + rand(60_000));
    rules.mostImproved.amountCents = 100 + rand(60_000);
    rules.prizes.budgetCents = rand(400_000);
    rules.eligibility.minQualifyingJobs = rand(4);
    rules.eligibility.minAvgTicketCents = 0;
    rules.eligibility.minClosingRateBp = 0;
    const valid = validateRules(rules, { knownStatuses: rules.qualifying.statuses, ceilingCents: 10_000_000 }).length === 0;
    const names = Array.from({ length: 15 }, (_, i) => `T${i}`);
    const jobs = names.flatMap((n) => many(1 + rand(6), n, rand(2) ? "Closed" : "Estimate", rand(2000)));
    if (!valid) continue;
    const r = run(jobs, names, rules);
    assert.ok(r.awardedCents <= rules.prizes.budgetCents);
    assert.equal(r.awardedCents + r.unallocatedCents, rules.prizes.budgetCents);
  }
});

test("no individual receives overlapping prizes; Most Improved passes to the next candidate", () => {
  const rules = cloneRules(SEED_STANDARD_WEEK);
  rules.prizes.positionsCents = [45_000];
  const prev = ["2026-10-26", "2026-10-19", "2026-10-12", "2026-10-05"];
  // Top improved hugely (would win MI) but also takes position 1; Mid improved less.
  const jobs = [
    ...prev.flatMap((d) => [...many(5, "Top", "Estimate", 0, d), job("Top", "Closed", 100, d)]),
    ...prev.flatMap((d) => [...many(4, "Mid", "Estimate", 0, d), ...many(2, "Mid", "Closed", 300, d)]),
    ...many(10, "Top", "Closed", 2000),
    ...many(5, "Mid", "Closed", 900),
    ...many(5, "Mid", "Estimate", 0),
  ];
  const r = run(jobs, ["Top", "Mid"], rules);
  assert.equal(row(r, "Top").prizePosition, 1);
  assert.ok(row(r, "Top").mostImproved!.improvement > row(r, "Mid").mostImproved!.improvement);
  assert.equal(row(r, "Top").wonMostImproved, false);
  assert.equal(row(r, "Mid").wonMostImproved, true);
  assert.equal(r.mostImprovedWinner, "u_Mid");
});

test("Most Improved stays unawarded when nobody else is eligible", () => {
  const rules = cloneRules(SEED_STANDARD_WEEK);
  rules.prizes.positionsCents = [45_000];
  const r = run(many(10, "Solo", "Closed", 900), ["Solo"], rules);
  assert.equal(r.mostImprovedWinner, null);
  assert.equal(r.unallocatedCents, rules.prizes.budgetCents - 45_000);
});

test("Most Improved baseline needs enough valid weeks and does not require past eligibility", () => {
  const prev = ["2026-10-26", "2026-10-19", "2026-10-12", "2026-10-05"];
  const struggling = (d: string) => [...many(5, "Ron", "Estimate", 0, d), job("Ron", "Closed", 50, d)]; // never eligible before
  const now = [...many(5, "Ron", "Closed", 900), ...many(5, "Ron", "Estimate", 0)];
  const rules = cloneRules(SEED_STANDARD_WEEK);
  rules.prizes.positionsCents = [];
  rules.prizes.budgetCents = 25_000;
  const three = run([...prev.slice(0, 3).flatMap(struggling), ...now], ["Ron"], rules);
  assert.equal(three.mostImprovedWinner, "u_Ron");
  assert.equal(row(three, "Ron").mostImproved!.validWeeks, 3);
  const two = run([...prev.slice(0, 2).flatMap(struggling), ...now], ["Ron"], rules);
  assert.equal(two.mostImprovedWinner, null);
  // weighted pooling: baseline = pooled totals, not the mean of weekly percentages
  const lopsided = [
    ...many(20, "Ron", "Estimate", 0, prev[0]), ...many(10, "Ron", "Closed", 100, prev[0]),
    ...many(5, "Ron", "Estimate", 0, prev[1]), ...many(5, "Ron", "Closed", 100, prev[1]),
    ...many(5, "Ron", "Estimate", 0, prev[2]), ...many(5, "Ron", "Closed", 100, prev[2]),
  ];
  const pooled = run([...lopsided, ...now], ["Ron"], rules);
  const crPooled = 20 / 50; // 10+5+5 closed over 30+10+10 assigned
  const avgPooled = (20 * 100) / 50;
  const expected = 60 * Math.min(crPooled / 0.5, 1.5) + 40 * Math.min(avgPooled / 500, 1.5);
  assert.ok(Math.abs(row(pooled, "Ron").mostImproved!.baselineScore - expected) < 1e-9);
});

test("ties: unrounded score first, then closing rate, AVG TICKET, qualifying jobs, then a stable id", () => {
  // both capped at 150: CR 100%, AVG ≥ $750
  const r = run([...many(10, "Zed", "Closed", 900), ...many(12, "Amy", "Closed", 800)], ["Zed", "Amy"]);
  assert.equal(row(r, "Zed").score, row(r, "Amy").score);
  assert.equal(row(r, "Zed").closingRate, row(r, "Amy").closingRate);
  assert.equal(row(r, "Zed").rank, 1); // higher AVG TICKET wins
  const same = run([...many(10, "Zed", "Closed", 900), ...many(10, "Amy", "Closed", 900)], ["Zed", "Amy"]);
  assert.equal(row(same, "Amy").rank, 1); // full tie → stable id order (u_Amy < u_Zed)
  assert.deepEqual(
    run([...many(10, "Zed", "Closed", 900), ...many(10, "Amy", "Closed", 900)], ["Zed", "Amy"]).results.map((x) => x.competitorId),
    same.results.map((x) => x.competitorId),
  );
});

test("official KPIs equal the CRM definitions: X close counts in the denominator, not in profit", () => {
  const jobs = [job("Ann", "Closed", 500), job("Ann", "X close", 900), job("Ann", "Cancel by Office", 0), job("Ann", "", 0)];
  const k = officialKpis(jobs);
  assert.equal(k.assigned, 4);
  assert.equal(k.closingRate, 1 / 4);
  assert.equal(k.avgTicket, 500 / 4);
});

// ── configuration drives everything (Addendum B.7) ─────────────────────────

const field = () => [
  ...many(6, "Ann", "Closed", 1000), ...many(3, "Ann", "Estimate", 0),
  ...many(4, "Bo", "Closed", 600), ...many(6, "Bo", "Estimate", 0),
  ...many(9, "Cy", "Closed", 450), ...many(1, "Cy", "Price Issue", 0), ...many(2, "Cy", "No answer", 0),
];
const NAMES = ["Ann", "Bo", "Cy"];

test("config: lowering the job minimum from 10 to 9 makes a technician eligible", () => {
  assert.equal(row(run(field(), NAMES), "Ann").eligible, false);
  const rules = cloneRules(SEED_STANDARD_WEEK);
  rules.eligibility.minQualifyingJobs = 9;
  assert.equal(row(run(field(), NAMES, rules), "Ann").eligible, true);
});

test("config: weights 60/40 → 90/10 reorder the ranking", () => {
  const a = run(field(), NAMES);
  assert.deepEqual(a.results.map((x) => x.competitorId), ["u_Ann", "u_Cy", "u_Bo"]);
  const rules = cloneRules(SEED_STANDARD_WEEK);
  rules.scoring.closingRate.weight = 90;
  rules.scoring.avgTicket.weight = 10;
  const b = run(field(), NAMES, rules);
  assert.deepEqual(b.results.map((x) => x.competitorId), ["u_Cy", "u_Ann", "u_Bo"]);
});

test("config: targets and caps change scores", () => {
  const rules = cloneRules(SEED_STANDARD_WEEK);
  rules.scoring.closingRate.cap = 1;
  rules.scoring.avgTicket.targetCents = 100_000;
  const a = row(run(field(), NAMES), "Cy");
  const b = row(run(field(), NAMES, rules), "Cy");
  assert.ok(b.closingIndex <= 1 && b.avgIndex < a.avgIndex && b.score < a.score);
});

test("config: number of prize positions and amounts", () => {
  const names = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const jobs = names.flatMap((n, i) => many(10 + i, n, "Closed", 500 + i));
  const six = run(jobs, names);
  assert.deepEqual(six.results.filter((x) => x.prizePosition).map((x) => x.prizeCents), [45_000, 30_000, 20_000, 15_000, 10_000, 5_000]);
  const rules = cloneRules(SEED_STANDARD_WEEK);
  rules.prizes.positionsCents = [70_000, 30_000];
  const two = run(jobs, names, rules);
  assert.deepEqual(two.results.filter((x) => x.prizePosition).map((x) => x.prizeCents), [70_000, 30_000]);
});

test("config: removing Estimate from qualifying statuses drops a technician below the job minimum", () => {
  assert.equal(row(run(field(), NAMES), "Bo").gates.jobs.met, true);
  const rules = cloneRules(SEED_STANDARD_WEEK);
  rules.qualifying.statuses = rules.qualifying.statuses.filter((s) => s !== "Estimate");
  assert.equal(row(run(field(), NAMES, rules), "Bo").gates.jobs.met, false);
  // and adding "No answer" lets it count
  const withNoAnswer = cloneRules(SEED_STANDARD_WEEK);
  withNoAnswer.qualifying.statuses.push("No answer");
  assert.equal(row(run(field(), NAMES, withNoAnswer), "Cy").qualifyingJobs, 12);
});

test("config: tie-break order decides who wins a tie", () => {
  const jobs = [...many(10, "Zed", "Closed", 900), ...many(12, "Amy", "Closed", 800)];
  assert.equal(row(run(jobs, ["Zed", "Amy"]), "Zed").rank, 1);
  const rules = cloneRules(SEED_STANDARD_WEEK);
  rules.tieBreak = ["qualifyingJobs", "avgTicket"];
  assert.equal(row(run(jobs, ["Zed", "Amy"], rules), "Amy").rank, 1);
});

test("config: Most Improved disabled → never awarded", () => {
  const prev = ["2026-10-26", "2026-10-19", "2026-10-12"];
  const jobs = [...prev.flatMap((d) => [...many(5, "Ron", "Estimate", 0, d), job("Ron", "Closed", 50, d)]),
    ...many(5, "Ron", "Closed", 900), ...many(5, "Ron", "Estimate", 0)];
  const rules = cloneRules(SEED_STANDARD_WEEK);
  rules.prizes.positionsCents = [];
  assert.equal(run(jobs, ["Ron"], rules).mostImprovedWinner, "u_Ron");
  rules.mostImproved.enabled = false;
  assert.equal(run(jobs, ["Ron"], rules).mostImprovedWinner, null);
});

test("config: participants can exclude a technician or a whole location", () => {
  const rules = cloneRules(SEED_STANDARD_WEEK);
  rules.participants.excludeCompetitorIds = ["u_Ann"];
  assert.equal(run(field(), NAMES, rules).results.some((x) => x.competitorId === "u_Ann"), false);
  const loc = cloneRules(SEED_STANDARD_WEEK);
  loc.participants.excludeLocations = ["Milwaukee"];
  assert.equal(run(field(), NAMES, loc).results.length, 0);
  const only = cloneRules(SEED_STANDARD_WEEK);
  only.participants.onlyCompetitorIds = ["u_Bo"];
  assert.deepEqual(run(field(), NAMES, only).results.map((x) => x.competitorId), ["u_Bo"]);
});

// ── account eligibility (Weekly Balance account, passed in as input) ───────

/** Four performance-eligible people ranked Ann > Bo > Cy > Di, plus Ed (not eligible, top score). */
function accountWeek() {
  return [
    ...many(10, "Ann", "Closed", 1000), ...many(10, "Bo", "Closed", 900), ...many(10, "Cy", "Closed", 800),
    ...many(10, "Di", "Closed", 700), ...many(5, "Ed", "Closed", 5000),
  ];
}
const ACCT = ["Ann", "Bo", "Cy", "Di", "Ed"];
const prizes = (r: ReturnType<typeof run>) =>
  r.results.filter((x) => x.prizePosition !== null).sort((a, b) => a.prizePosition! - b.prizePosition!).map((x) => x.displayName);

for (const state of ["pending", "inactive", "unmapped", "not_competing_role"] as const) {
  test(`account ${state} in a would-be prize spot: skipped, never displaces; rank/KPIs untouched`, () => {
    const rules = cloneRules(SEED_STANDARD_WEEK);
    rules.prizes.positionsCents = [30_000, 20_000, 10_000];
    rules.prizes.budgetCents = 85_000;
    const base = run(accountWeek(), ACCT, rules);
    assert.deepEqual(prizes(base), ["Ann", "Bo", "Cy"]);
    const r = run(accountWeek(), ACCT, rules, [], accountsFor(ACCT, { Bo: state }));
    const bo = row(r, "Bo");
    assert.deepEqual(prizes(r), ["Ann", "Cy", "Di"], "prizes go down the ranking of fully eligible competitors");
    assert.equal(bo.prizePosition, null);
    assert.equal(bo.prizeCents, 0);
    assert.equal(bo.eligible, true, "performance gates are unchanged");
    assert.equal(bo.prizeEligible, false);
    assert.equal(bo.account.state, state);
    // ranks, scores and official KPIs identical to the all-eligible run
    for (const n of ACCT) {
      const a = row(base, n), b = row(r, n);
      assert.deepEqual([b.rank, b.score, b.closingRate, b.avgTicket, b.qualifyingJobs, b.assignedJobs, b.profitMicro],
        [a.rank, a.score, a.closingRate, a.avgTicket, a.qualifyingJobs, a.assignedJobs, a.profitMicro]);
    }
    assert.equal(r.eligibleCount, base.eligibleCount, "gate counts are performance-only");
    assert.equal(r.prizeEligibleCount, base.prizeEligibleCount - 1);
    assert.deepEqual(r.accountUnresolved, []);
  });
}

test("account unverified (verifier down): keeps the place, nothing is redistributed, eligibility unresolved", () => {
  const rules = cloneRules(SEED_STANDARD_WEEK);
  const base = run(accountWeek(), ACCT, rules);
  const r = run(accountWeek(), ACCT, rules, [], accountsFor(ACCT, { Ann: "unverified", Bo: "unverified" }));
  assert.deepEqual(prizes(r), prizes(base));
  assert.deepEqual(r.results.map((x) => [x.competitorId, x.prizeCents]), base.results.map((x) => [x.competitorId, x.prizeCents]));
  assert.deepEqual(r.accountUnresolved.sort(), ["u_Ann", "u_Bo"]);
  assert.equal(row(r, "Ann").prizeEligible, true);
});

test("account unverified for someone NOT performance-eligible is not in contention", () => {
  const r = run(accountWeek(), ACCT, cloneRules(SEED_STANDARD_WEEK), [], accountsFor(ACCT, { Ed: "unverified" }));
  assert.equal(row(r, "Ed").eligible, false);
  assert.deepEqual(r.accountUnresolved, []);
});

test("a competitor missing from the accounts input is unverified (never silently eligible)", () => {
  const r = run(accountWeek(), ACCT, cloneRules(SEED_STANDARD_WEEK), [], {});
  assert.ok(r.results.every((x) => x.account.state === "unverified" && x.account.checkedAt === null));
});

test("Most Improved winner account-ineligible → the award goes to the next fully eligible candidate", () => {
  const rules = cloneRules(SEED_STANDARD_WEEK);
  rules.prizes.positionsCents = [30_000];
  rules.prizes.budgetCents = 60_000;
  rules.mostImproved = { ...rules.mostImproved, enabled: true, baselineWeeks: 1, minValidWeeks: 1, minQualifyingJobsPerWeek: 1, minImprovement: 0 };
  const prev = "2026-10-26";
  const hist = [...many(10, "Bo", "Estimate", 0, prev), ...many(1, "Bo", "Closed", 10, prev), ...many(10, "Cy", "Estimate", 0, prev), ...many(2, "Cy", "Closed", 300, prev)];
  const names = ["Ann", "Bo", "Cy"];
  const week = [...many(10, "Ann", "Closed", 1000), ...many(10, "Bo", "Closed", 900), ...many(10, "Cy", "Closed", 800)];
  const base = run([...week, ...hist], names, rules);
  assert.equal(base.mostImprovedWinner, "u_Bo");
  const r = run([...week, ...hist], names, rules, [], accountsFor(names, { Bo: "inactive" }));
  assert.equal(r.mostImprovedWinner, "u_Cy");
  assert.equal(row(r, "Bo").wonMostImproved, false);
  assert.equal(row(r, "Bo").prizeCents, 0);
  // and when the position winner is excluded, position + MI both move down the eligible ranking
  const r2 = run([...week, ...hist], names, rules, [], accountsFor(names, { Ann: "pending" }));
  assert.equal(row(r2, "Bo").prizePosition, 1);
  assert.equal(r2.mostImprovedWinner, "u_Cy");
});

test("account eligibility is input only: the engine is a pure function of it", () => {
  const a = accountsFor(ACCT, { Cy: "inactive" });
  const r1 = run(accountWeek(), ACCT, cloneRules(SEED_STANDARD_WEEK), [], a);
  const r2 = run(accountWeek(), ACCT, cloneRules(SEED_STANDARD_WEEK), [], structuredClone(a));
  assert.deepEqual(
    r1.results.map((x) => [x.competitorId, x.prizeCents, x.account]),
    r2.results.map((x) => [x.competitorId, x.prizeCents, x.account]),
  );
});
