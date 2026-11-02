// Weekly shadow reconciliation (scripts/arena/lib-reconcile.ts) and the official-workflow
// additions to scripts/arena/lib-shadow.ts: duplicate keep-both / D2 policy, undecided
// cases (daily STOP), in-memory projection of the decisions file, the Monday-freeze
// clock gate, and the run archive. Pure: no database. The end-to-end two-week dress
// rehearsal is scripts/arena/shadow-rehearsal.e2e.ts (dev only, synthetic data).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { computeCompetition } from "./engine.ts";
import { SEED_BALANCED_PERFORMANCE, cloneRules, rulesHash } from "./config.ts";
import { buildCompetitorMap } from "./identity.ts";
import { previousWeekStarts } from "./week.ts";
import type { ArenaJob, ArenaRules, CompetitionResult } from "./types.ts";
import type { ReviewCaseDoc } from "./review.ts";
import {
  acceptance, compareMethods, independentLateDiff, rulesCheck, v1Scores, type AcceptanceInput, type BaselineWeek,
} from "../../../scripts/arena/lib-reconcile.ts";
import {
  DECISIONS_SCHEMA, approvalClockGate, archiveRun, asCaseDocs, isClosedPlusXClose, isZeroDollar, planDecisions, projectDecisions,
  runStamp, validateDecisions, type ShadowDecisions,
} from "../../../scripts/arena/lib-shadow.ts";

const WEEK = "2026-11-09";
const V1: ArenaRules = cloneRules(SEED_BALANCED_PERFORMANCE);
let seq = 0;
const job = (tech: string, status: string, profit: number, date = WEEK): ArenaJob => ({ id: `j${String(++seq).padStart(5, "0")}`, tech, date, status, location: "Chicago", profit, dupKeys: [] });
const many = (n: number, tech: string, status: string, profit: number, date = WEEK) => Array.from({ length: n }, () => job(tech, status, profit, date));
const people = (names: string[]) => buildCompetitorMap({
  mappings: names.map((n) => ({ supabaseUserId: `u_${n}`, supabaseFullName: `${n} Test`, crmTechNames: [n] })),
  technicians: names.map((n) => ({ _id: n, location: "Chicago" })), crmNamesInUse: names,
});
/** 8 competitors: 7 eligible with distinct scores, 1 ineligible on jobs (high score). */
function week(rules = V1, extra: ArenaJob[] = []) {
  const names = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const jobs: ArenaJob[] = [...extra];
  names.forEach((n, i) => {
    const closed = n === "H" ? 5 : 15 - i, open = n === "H" ? 0 : 5 + i;
    jobs.push(...many(closed, n, "Closed", 1500 - i * 60), ...many(open, n, "Estimate", 0));
  });
  // Most Improved baseline for G: 4 weak weeks with ≥ 5 qualifying jobs each.
  for (const w of previousWeekStarts(WEEK, 4)) jobs.push(...many(3, "G", "Closed", 200, w), ...many(7, "G", "Estimate", 0, w));
  const comp = people(names);
  const result = computeCompetition({ rules, rulesHash: rulesHash(rules), weekStart: WEEK, competitors: comp, jobs, accounts: {} });
  return { result, jobs, comp };
}
const baselineOf = (jobs: ArenaJob[], comp: ReturnType<typeof people>, rules = V1): BaselineWeek[] => {
  const alone = cloneRules(rules); alone.mostImproved.enabled = false;
  return previousWeekStarts(WEEK, rules.mostImproved.baselineWeeks).map((w) => ({ weekStart: w, results: computeCompetition({ rules: alone, rulesHash: rulesHash(alone), weekStart: w, competitors: comp, jobs, accounts: {} }).results }));
};
const clone = (r: CompetitionResult): CompetitionResult => structuredClone(r);
const failing = (lines: ReturnType<typeof rulesCheck>) => lines.filter((l) => !l.ok).map((l) => l.id);

// ── A2 rules check ─────────────────────────────────────────────────────────

test("A2: an engine result passes every rules check, incl. the independently recomputed Most Improved baseline", () => {
  const { result, jobs, comp } = week();
  assert.equal(result.results.filter((r) => r.prizePosition).length, 6);
  assert.ok(result.mostImprovedWinner, "the fixture has a Most Improved winner");
  const lines = rulesCheck(result, V1, baselineOf(jobs, comp));
  assert.deepEqual(failing(lines), [], JSON.stringify(lines, null, 1));
  assert.equal(lines.length, 7);
  assert.ok(lines.find((l) => l.id === "A2.7")!.detail.includes("recomputed independently"));
});

test("A2: the approved minimums stay 10 / $400 / 40% and the fingerprint is unchanged", () => {
  assert.equal(V1.eligibility.minQualifyingJobs, 10);
  assert.equal(V1.eligibility.minAvgTicketCents, 40_000);
  assert.equal(V1.eligibility.minClosingRateBp, 4_000);
  assert.equal(V1.scoring.methodology, "BALANCED_PERFORMANCE_V1");
  assert.equal(rulesHash(V1), "c122c43bae974c7aa73fc960b19ca921adf646c82b89d67f9eee3fdb21c7d2b4");
});

test("A2: each kind of violation is caught", () => {
  const { result } = week();
  const top = (r: CompetitionResult) => r.results.find((x) => x.prizePosition === 1)!;
  // a prize holder below a minimum (numbers edited, gate flags left as they were)
  let r = clone(result); top(r).qualifyingJobs = 9;
  assert.deepEqual(failing(rulesCheck(r, V1)), ["A2.1"]);
  // an ineligible competitor holds a prize
  r = clone(result); const h = r.results.find((x) => !x.eligible)!; h.prizeCents = 5_000;
  assert.ok(failing(rulesCheck(r, V1)).includes("A2.2"));
  // the score is not min(C, A)
  r = clone(result); top(r).score += 1;
  assert.ok(failing(rulesCheck(r, V1)).includes("A2.3"));
  // order broken: swap the ranks of #1 and #2
  r = clone(result); const [a, b] = [...r.results].sort((x, y) => x.rank - y.rank); [a.rank, b.rank] = [b.rank, a.rank];
  assert.ok(failing(rulesCheck(r, V1)).includes("A2.4"));
  // wrong amount
  r = clone(result); top(r).prizeCents = 50_000; r.awardedCents += 5_000;
  assert.ok(failing(rulesCheck(r, V1)).includes("A2.5"));
  // budget exceeded
  r = clone(result); r.awardedCents = 999_999;
  assert.ok(failing(rulesCheck(r, V1)).includes("A2.6"));
  // Most Improved given to a Top-6 winner
  r = clone(result); const w = r.results.find((x) => x.wonMostImproved)!; w.wonMostImproved = false; top(r).wonMostImproved = true;
  assert.ok(failing(rulesCheck(r, V1)).includes("A2.7"));
});

test("A2: a Most Improved winner whose baseline week has < 5 qualifying jobs is caught by the independent baseline", () => {
  const { result, jobs, comp } = week();
  const winner = result.results.find((x) => x.wonMostImproved)!;
  const base = baselineOf(jobs, comp);
  base[0].results.find((x) => x.competitorId === winner.competitorId)!.qualifyingJobs = 4;
  assert.ok(failing(rulesCheck(result, V1, base)).includes("A2.7"));
});

test("A2: V1 scores from raw KPIs — 100 × min(CR/50%, 1.5) and 100 × min(AVG/$500, 1.5), the lower one", () => {
  assert.deepEqual(v1Scores(V1, 0.5, 500), { closingScore: 100, avgScore: 100, score: 100 });
  assert.deepEqual(v1Scores(V1, 0.9, 400), { closingScore: 150, avgScore: 80, score: 80 });
});

test("V1 vs old method: same input, rows say who moved", () => {
  const { jobs, comp } = week();
  const v0 = cloneRules(V1); delete (v0.scoring as { methodology?: string }).methodology;
  const r1 = computeCompetition({ rules: V1, rulesHash: rulesHash(V1), weekStart: WEEK, competitors: comp, jobs, accounts: {} });
  const r0 = computeCompetition({ rules: v0, rulesHash: rulesHash(v0), weekStart: WEEK, competitors: comp, jobs, accounts: {} });
  const rows = compareMethods(r1, r0);
  assert.equal(rows.length, r1.results.length);
  assert.deepEqual(rows.map((x) => x.v1.rank), rows.map((_, i) => i + 1));
  assert.ok(rows.every((x) => x.v0 !== null));
});

// ── A7 independent late diff ───────────────────────────────────────────────

test("A7: the independent re-diff finds a deletion, a re-date out of the week, a re-assignment and ignores baseline-only jobs", () => {
  const f = [job("A", "Closed", 100), job("A", "Estimate", 0), job("B", "Closed", 50), job("C", "Closed", 10, "2026-10-12")];
  const read = [{ ...f[1], date: "2026-11-16" }, { ...f[2], tech: "C" }, { ...f[3], profit: 11 }];
  const d = independentLateDiff(f, read, WEEK, "2026-11-16");
  assert.deepEqual(d.map((x) => x.jobId), [f[0].id, f[1].id, f[2].id]);
  assert.match(d[0].what, /gone/);
  assert.match(d[1].what, /date 2026-11-09 → 2026-11-16/);
  assert.match(d[2].what, /tech B → C/);
});

// ── A1–A8 ──────────────────────────────────────────────────────────────────

const days = [...Array.from({ length: 8 }, (_, i) => `2026-11-${String(9 + i).padStart(2, "0")}`)];
const run = (day: string, over: Partial<AcceptanceInput["daily"][number]> = {}): AcceptanceInput["daily"][number] => ({
  generatedAt: `${day}T15:00:00.000Z`, day, weekEnded: day === "2026-11-16", guardOk: true, crmUsers: ["arena_shadow_ro@admin"], blockedWrites: ["finance_meta.updateOne"],
  parityComparisons: 120, parityMismatches: 0, stops: [], inputHash: `in-${day}`, resultHash: `out-${day}`, ...over,
});
const good = (): AcceptanceInput => ({
  weekStart: WEEK, expectedDays: days, daily: days.map((d) => run(d)),
  approvals: [{ generatedAt: "2026-11-19T17:00:00Z", outcome: "approved", simulatedClock: false, safetyOk: true, crmWriteAttemptsBlocked: 0, financeCollectionsOpened: [], nonArenaLocalWrites: [], integrityIdentical: 3, integrityMismatched: 0, undecided: { names: [], duplicates: [], displayNames: [] } }],
  rules: [{ id: "A2.1", ok: true, detail: "" }], openCases: [], pendingNames: ["John (18 jobs)"],
  late: { detected: ["x1"], independent: [{ jobId: "x1", what: "gone" }], material: true, decided: "keep_freeze", postApproval: 0 },
  reproducible: true, techAccessEnv: [], preflightPassed: true, ownerSignOff: null,
});
const verdicts = (x: AcceptanceInput) => Object.fromEntries(acceptance(x).map((l) => [l.id, l.verdict]));

test("acceptance: a clean week passes A1–A7; A8 waits for the owner", () => {
  assert.deepEqual(verdicts(good()), { A1: "PASS", A2: "PASS", A3: "PASS", A4: "PASS", A5: "PASS", A6: "PASS", A7: "PASS", A8: "PENDING" });
  assert.equal(verdicts({ ...good(), ownerSignOff: "Owner, 2026-11-20: winners look right" }).A8, "PASS");
});

test("acceptance: each failure is attributed to its criterion", () => {
  const g = good;
  assert.equal(verdicts({ ...g(), daily: g().daily.map((d) => (d.weekEnded ? { ...d, parityMismatches: 1 } : d)) }).A1, "FAIL");
  assert.equal(verdicts({ ...g(), daily: g().daily.filter((d) => !d.weekEnded) }).A1, "NOT RUN");
  assert.equal(verdicts({ ...g(), rules: [{ id: "A2.5", ok: false, detail: "x" }] }).A2, "FAIL");
  assert.equal(verdicts({ ...g(), openCases: ["duplicate group a,b (open)"] }).A3, "FAIL");
  assert.equal(verdicts({ ...g(), daily: g().daily.filter((d) => d.day !== "2026-11-12") }).A4, "FAIL", "a missed day");
  assert.equal(verdicts({ ...g(), daily: [...g().daily, run("2026-11-16", { resultHash: "different" })] }).A4, "FAIL", "same input, different result");
  assert.equal(verdicts({ ...g(), daily: [...g().daily, run("2026-11-16")] }).A4, "PASS", "a rerun with the same input and result");
  assert.equal(verdicts({ ...g(), daily: [run("2026-11-09", { crmUsers: ["lbs_ops@admin"] }), ...g().daily.slice(1)] }).A5, "FAIL");
  assert.equal(verdicts({ ...g(), daily: [run("2026-11-09", { blockedWrites: ["Job.updateOne"] }), ...g().daily.slice(1)] }).A5, "FAIL");
  assert.equal(verdicts({ ...g(), techAccessEnv: ["ARENA_TECH_ENABLED"] }).A5, "FAIL");
  assert.equal(verdicts({ ...g(), preflightPassed: null }).A5, "PENDING");
  assert.equal(verdicts({ ...g(), approvals: [{ ...g().approvals[0], integrityMismatched: 1 }] }).A6, "FAIL");
  assert.equal(verdicts({ ...g(), late: { ...g().late!, detected: [] } }).A7, "FAIL", "a change the Arena did not list");
  assert.equal(verdicts({ ...g(), late: { ...g().late!, decided: null } }).A7, "FAIL", "approved over a material change without a decision");
  assert.equal(verdicts({ ...g(), late: null }).A7, "NOT RUN");
});

// ── decisions file: keep both, D2 policy, undecided, projection ───────────

const kase = (kind: ReviewCaseDoc["kind"], key: string, data: unknown, status: ReviewCaseDoc["status"] = "open"): ReviewCaseDoc => ({
  _id: `${kind}:${key}`, kind, key, status, data: data as never, weeks: [WEEK], firstSeenAt: "", lastSeenAt: "",
  resolution: null, reason: null, decidedBy: null, decidedAt: null, confirmedBy: null, confirmedAt: null, version: 1,
});
const idCase = (crmName: string, jobs = 3) => kase("identity_name", crmName, { issue: "unmapped_name", crmName, candidates: [], jobs, locations: ["Chicago"], suggestedCategory: null });
const dup = (who: string, date: string, jobs: { id: string; status: string; profit: number }[]) =>
  kase("duplicate_group", jobs.map((j) => j.id).join(","), { weekStart: WEEK, date, competitorId: `u_${who}`, competitorName: who, likely: false, mayAffectPrizes: true, jobs: jobs.map((j) => ({ ...j, tech: who })) });
const base = (over: Partial<ShadowDecisions> = {}): ShadowDecisions => ({
  schema: DECISIONS_SCHEMA, exclusions: [{ crmName: "CHICAGO", category: "location_pool", reason: "pool" }],
  mappings: [{ crmName: "John", status: "pending_identification", competitorId: null, reason: "office to identify" }],
  countOnceDuplicateGroups: [], displayNameOverrides: [], ...over,
});

test("decisions: keep_both and duplicatePolicy validate; bad values are reported", () => {
  assert.deepEqual(validateDecisions(base({ duplicatePolicy: { closedPlusXClose: "keep_both", zeroDollar: "review" } })).problems, []);
  const p = validateDecisions(base({
    duplicatePolicy: { closedPlusXClose: "maybe", other: "keep_both" } as never,
    countOnceDuplicateGroups: [
      { technician: "A", date: WEEK, profit: null, status: "keep_both", excludeJobIds: ["x"], reason: "r" },
      { technician: "A", date: WEEK, profit: null, status: "confirmed", excludeJobIds: ["a", "b"], jobIds: ["a", "b"], reason: "r" },
      { technician: "A", date: WEEK, profit: null, status: "pending_office_confirmation", excludeJobIds: ["z"], jobIds: ["a", "b"], reason: "r" },
    ],
  })).problems.join(" | ");
  assert.match(p, /closedPlusXClose must be/);
  assert.match(p, /duplicatePolicy.other: unknown/);
  assert.match(p, /keep_both leaves nothing out/);
  assert.match(p, /at least one job of the group must stay counted/);
  assert.match(p, /every excludeJobIds entry must be one of jobIds/);
});

test("plan: D2 policy dismisses Closed + X close and $0 pairs, never an exact Closed + Closed pair; keep_both by job ids", () => {
  const twoPart = dup("A", WEEK, [{ id: "a1", status: "Closed", profit: 49.4 }, { id: "a2", status: "X close", profit: 250 }]);
  const zero = dup("B", WEEK, [{ id: "b1", status: "Estimate", profit: 0 }, { id: "b2", status: "OOA", profit: 0 }]);
  const exact = dup("C", WEEK, [{ id: "c1", status: "Closed", profit: 333.45 }, { id: "c2", status: "Closed", profit: 333.45 }]);
  const other = dup("D", WEEK, [{ id: "d1", status: "Closed", profit: 10 }, { id: "d2", status: "Closed", profit: 20 }]);
  assert.ok(isClosedPlusXClose(twoPart.data as never) && !isClosedPlusXClose(exact.data as never));
  assert.ok(isZeroDollar(zero.data as never) && !isZeroDollar(exact.data as never));
  const plan = planDecisions([twoPart, zero, exact, other], base({
    duplicatePolicy: { closedPlusXClose: "keep_both", zeroDollar: "keep_both" },
    countOnceDuplicateGroups: [{ technician: "D", date: WEEK, profit: null, status: "keep_both", excludeJobIds: [], jobIds: ["d2", "d1"], reason: "two invoices" }],
  }));
  const by = Object.fromEntries(plan.apply.map((a) => [a.caseId, a.resolution.kind]));
  assert.equal(by["duplicate_group:a1,a2"], "duplicate_dismissed");
  assert.equal(by["duplicate_group:b1,b2"], "duplicate_dismissed");
  assert.equal(by["duplicate_group:d1,d2"], "duplicate_dismissed");
  assert.equal(by["duplicate_group:c1,c2"], undefined, "an exact pair is never dismissed by policy");
  assert.equal(plan.undecided.duplicates.length, 1);
  assert.match(plan.undecided.duplicates[0], /C .*c1, c2/);
});

test("plan: undecided names (daily STOP) vs excluded / pending ones", () => {
  const plan = planDecisions([idCase("CHICAGO", 9), idCase("John", 18), idCase("Newbie", 4)], base());
  assert.deepEqual(plan.undecided.names, ["Newbie (4 job(s) at Chicago)"]);
  assert.deepEqual(plan.pending.names, ["John (18 job(s))"]);
  assert.equal(plan.apply.length, 1);
});

test("plan: a pending duplicate with prefilled job ids stays pending (blocks approval), confirmed applies the exclusion", () => {
  const exact = dup("C", WEEK, [{ id: "c1", status: "Closed", profit: 333.45 }, { id: "c2", status: "Closed", profit: 333.45 }]);
  const entry = { technician: "C", date: WEEK, profit: 333.45, excludeJobIds: ["c2"], jobIds: ["c1", "c2"], reason: "same phone, 14 min apart" };
  const pending = planDecisions([exact], base({ countOnceDuplicateGroups: [{ ...entry, status: "pending_office_confirmation" }] }));
  assert.equal(pending.apply.length, 0);
  assert.equal(pending.pending.duplicates.length, 1);
  assert.equal(pending.undecided.duplicates.length, 0);
  const confirmed = planDecisions([exact], base({ countOnceDuplicateGroups: [{ ...entry, status: "confirmed" }] }));
  assert.deepEqual(confirmed.apply[0].resolution, { kind: "duplicate_confirmed", excludeJobIds: ["c2"] });
});

test("projection: the decisions file applied in memory = the engine inputs review.ts would derive", () => {
  const cases = asCaseDocs([
    { kind: "identity_name", key: "CHICAGO", data: idCase("CHICAGO").data, weeks: [WEEK] },
    { kind: "identity_name", key: "Jon", data: idCase("Jon").data, weeks: [WEEK] },
    { kind: "duplicate_group", key: "c1,c2", data: dup("C", WEEK, [{ id: "c1", status: "Closed", profit: 1 }, { id: "c2", status: "Closed", profit: 1 }]).data, weeks: [WEEK] },
  ]);
  const plan = planDecisions(cases, base({
    mappings: [{ crmName: "Jon", status: "attach", competitorId: "u_A", reason: "second CRM name of A" }],
    countOnceDuplicateGroups: [{ technician: "C", date: WEEK, profit: 1, status: "confirmed", excludeJobIds: ["c2"], reason: "one invoice" }],
  }));
  const d = projectDecisions({ exclusions: [], dismissedDuplicateGroups: [], overrides: [], displayNames: {} }, cases, plan);
  assert.deepEqual(d.overrides.map((o) => [o.crmName, o.competitorId]), [["CHICAGO", null], ["Jon", "u_A"]]);
  assert.deepEqual(d.exclusions.map((x) => x.jobId), ["c2"]);
  // a recorded (resolved) case keeps its local status
  const rec = asCaseDocs([{ kind: "identity_name", key: "CHICAGO", data: idCase("CHICAGO").data, weeks: [WEEK] }], [{ ...idCase("CHICAGO"), status: "resolved", resolution: { kind: "identity_not_competitor", category: "location_pool" } }]);
  assert.equal(rec[0].status, "resolved");
  assert.equal(planDecisions(rec, base()).alreadyInForce.length, 1);
});

// ── Monday freeze clock gate, run archive ─────────────────────────────────

test("clock gate: nothing before Sunday ends; the freeze on Monday; review/approval from Tuesday 12:00", () => {
  const closesAt = new Date("2026-11-16T05:00:00Z"), approvalOpensAt = new Date("2026-11-17T17:00:00Z");
  const at = (iso: string, stopAfter: "freeze" | "review" | null) => approvalClockGate({ now: new Date(iso), closesAt, approvalOpensAt, stopAfter }).early;
  assert.equal(at("2026-11-16T04:59:59Z", "freeze"), true, "Sunday 23:59:59 ET: still running");
  assert.equal(at("2026-11-16T14:00:00Z", "freeze"), false, "Monday morning: the freeze may run");
  assert.equal(at("2026-11-16T14:00:00Z", "review"), true, "Monday: no review yet");
  assert.equal(at("2026-11-16T14:00:00Z", null), true, "Monday: no approval yet");
  assert.equal(at("2026-11-17T16:59:59Z", null), true, "Tuesday 11:59:59 ET");
  assert.equal(at("2026-11-17T17:00:00Z", null), false, "Tuesday 12:00 ET");
  assert.equal(at("2026-11-19T15:00:00Z", "review"), false, "Thursday");
});

test("run archive: every run kept under runs/<stamp>, private modes", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "arena-archive-")); fs.chmodSync(d, 0o700);
  const stamp = runStamp("2026-11-16T14:05:00.000Z");
  assert.equal(stamp, "2026-11-16T14-05-00.000Z");
  const a = archiveRun(d, stamp, { "report.md": "x", "data.json": "{}" });
  const b = archiveRun(d, runStamp("2026-11-17T17:00:01.000Z"), { "report.md": "y" }, "approved");
  assert.deepEqual(fs.readdirSync(path.join(d, "runs")).sort(), ["2026-11-16T14-05-00.000Z", "2026-11-17T17-00-01.000Z-approved"]);
  assert.equal(fs.statSync(a).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(b, "report.md")).mode & 0o777, 0o600);
});
