// Late CRM edits after a week is frozen: reproducible source snapshots, per-job
// change lists, the owner's explicit choice when prizes are affected, and
// post-approval corrections that never touch the approved result.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  approveResults, checkLateCorrections, decideLateChanges, freezeCompetition, openReview, reconcileCompetition,
  reviewSnapshot, snapshotBlockers, verifySnapshotSource, type SnapshotDoc,
} from "./lifecycle.ts";
import { ArenaAuthorizationError, ArenaStateError, saveTemplate } from "./config-store.ts";
import { SEED_BALANCED_PERFORMANCE, SEED_STANDARD_WEEK } from "./config.ts";
import { computeCompetition } from "./engine.ts";
import { buildCompetitorMap } from "./identity.ts";
import {
  buildSource, changeSetHash, computeFromSource, deserializeCompetitorMap, diffJobs, lateImpact, plain, resultHash,
  serializeCompetitorMap, sourceProblems, withJobs, type SourceSnapshot,
} from "./source-snapshot.ts";
import { fixture, jobs, ADMIN, OWNER, WEEK } from "./testing/lifecycle-fixture.ts";
import type { ArenaJob, CompetitionResult, CompetitorResult } from "./types.ts";

const FREEZE_AT = "2026-11-02T06:00:00Z";
const TUE_NOON = "2026-11-03T17:00:00.000Z";

const P = [
  { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Ann Able", crm: "Ann", location: "Columbus" },
  { id: "aaaaaaaa-0000-4000-8000-000000000002", name: "Bo Baker", crm: "Bo", location: "Chicago" },
  { id: "aaaaaaaa-0000-4000-8000-000000000003", name: "Cy Cole", crm: "Cy", location: "Milwaukee" },
  { id: "aaaaaaaa-0000-4000-8000-000000000004", name: "Dan Dale", crm: "Dan", location: "Indianapolis" },
  { id: "aaaaaaaa-0000-4000-8000-000000000005", name: "Eve Ely", crm: "Eve", location: "Cleveland" },
];
const [, , CY, DAN, EVE] = P;

/**
 * The trial's shape on fictional data: Dan has 35 assigned / 20 closed /
 * 30 qualifying / $30,741.55 profit, one place behind Cy; deleting one of
 * his $0 Estimates after the freeze lifts him over Cy (#4 → #3).
 */
function trialWeek() {
  const dan = [...jobs(19, "Dan", "Closed", 1537.08), ...jobs(1, "Dan", "Closed", 1537.03), ...jobs(10, "Dan", "Estimate", 0), ...jobs(5, "Dan", "No answer", 0)];
  return {
    jobs: [
      ...jobs(21, "Ann", "Closed", 1500), ...jobs(9, "Ann", "Estimate", 0),
      ...jobs(19, "Bo", "Closed", 1500), ...jobs(11, "Bo", "Estimate", 0),
      ...jobs(21, "Cy", "Closed", 1500), ...jobs(15, "Cy", "Estimate", 0),
      ...dan,
      ...jobs(3, "Eve", "Closed", 1000), ...jobs(7, "Eve", "Estimate", 0),
    ],
    danZeroEstimate: dan.find((j) => j.status === "Estimate")!.id,
  };
}

async function frozenTrial(template: "standard" | "balanced" = "standard") {
  const f = await fixture({ people: P });
  if (template === "balanced") await saveTemplate(f.config, { templateId: "balanced", name: "Balanced", rules: SEED_BALANCED_PERFORMANCE }, OWNER);
  const t = trialWeek();
  f.data.jobs = t.jobs;
  const id = await f.startWeek(WEEK, template);
  f.setNow(FREEZE_AT);
  const frozen = await freezeCompetition(f.ctx, id, ADMIN);
  return { ...f, id, frozen, ...t };
}

const row = (r: CompetitionResult, id: string) => r.results.find((x) => x.competitorId === id)!;
const removeJob = (f: { data: { jobs: ArenaJob[] } }, id: string) => (f.data.jobs = f.data.jobs.filter((j) => j.id !== id));
const editJob = (f: { data: { jobs: ArenaJob[] } }, id: string, patch: Partial<ArenaJob>) =>
  (f.data.jobs = f.data.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)));

// ── 1. reproducible source snapshots ───────────────────────────────────────

test("freeze stores the exact job set with hashes, read time and source identity; recomputing reproduces the result hash", async () => {
  const f = await frozenTrial();
  const s = f.frozen.source!;
  assert.ok(s, "provisional snapshot carries its source");
  assert.equal(s.jobs.length, f.jobs.length);
  assert.deepEqual(Object.keys(s.jobs[0]).sort(), ["date", "dupKeys", "id", "location", "profit", "status", "tech"]);
  assert.equal(s.readAt, new Date(FREEZE_AT).toISOString());
  assert.deepEqual(s.identity, { system: "crm", database: "test", collection: "Job", user: "fixture", via: "lifecycle-fixture" });
  assert.match(s.jobsHash, /^[0-9a-f]{64}$/);
  assert.match(s.inputHash, /^[0-9a-f]{64}$/);
  assert.equal(f.frozen.reproducible, true);
  assert.equal(f.frozen.resultHash, resultHash(f.frozen.result));
  const rv = (await f.config.store.ruleVersions.findOne({ _id: f.frozen.ruleVersionId }))!;
  // The stored document (as MongoDB would return it) reproduces the result bit for bit.
  const stored = plain(f.frozen) as SnapshotDoc;
  assert.equal(resultHash(computeFromSource(stored.source!, rv.rules, rv.rulesHash, WEEK)), f.frozen.resultHash);
  assert.deepEqual(verifySnapshotSource(stored, rv), { ok: true, problems: [], recomputedHash: f.frozen.resultHash });
  // ...even after the CRM changed.
  removeJob(f, f.danZeroEstimate);
  assert.equal(verifySnapshotSource(stored, rv).ok, true);
});

test("a tampered source or result is detected", async () => {
  const f = await frozenTrial();
  const rv = (await f.config.store.ruleVersions.findOne({ _id: f.frozen.ruleVersionId }))!;
  const t1 = plain(f.frozen);
  t1.source!.jobs[0].profit += 1;
  assert.deepEqual(sourceProblems(t1.source!), ["job list does not match its hash", "source input does not match its hash"]);
  assert.equal(verifySnapshotSource(t1, rv).ok, false);
  const t2 = plain(f.frozen);
  t2.result.results[0].score += 1;
  assert.match(verifySnapshotSource(t2, rv).problems.join(), /stored result differs from its hash/);
});

test("competitor map round-trips through the stored form", () => {
  const map = buildCompetitorMap({
    mappings: P.map((p) => ({ supabaseUserId: p.id, supabaseFullName: p.name, crmTechNames: [p.crm] })),
    technicians: P.map((p) => ({ _id: p.crm, location: p.location })),
    crmNamesInUse: ["Ann", "Unknown Pool"],
  });
  const back = deserializeCompetitorMap(plain(serializeCompetitorMap(map)));
  assert.deepEqual([...back.byCrmName].sort(), [...map.byCrmName].sort());
  assert.deepEqual(back.competitors, map.competitors);
  assert.deepEqual(back.issues, map.issues);
});

// ── 2/3. per-job change list, the four kinds ───────────────────────────────

function src(jobsList: ArenaJob[], at: string, upd: Record<string, string> = {}): SourceSnapshot {
  return buildSource({
    readAt: at, identity: { system: "crm", database: "t", collection: "Job", user: "u", via: "test" },
    window: { from: "2026-09-28", toExclusive: "2026-11-02" }, jobs: jobsList,
    updateTimestamps: { field: Object.keys(upd).length ? "updatedAt" : null, byJobId: upd },
    competitors: buildCompetitorMap({ mappings: [], technicians: [], crmNamesInUse: [] }), accounts: {},
  });
}

test("diffJobs: removed, re-dated out, re-assigned, unassigned, status, profit, location, added — each with its detection time", () => {
  const j = (id: string, tech: string, date: string, status: string, profit: number, location = "X"): ArenaJob => ({ id, tech, date, status, profit, location, dupKeys: [] });
  const before = src([
    j("a-deleted", "Dan", "2026-10-27", "Estimate", 0),
    j("b-redated-away", "Eve", "2026-10-28", "Estimate", 0),
    j("c-redated-baseline", "Eve", "2026-10-28", "Estimate", 0),
    j("d-reassigned", "Ann", "2026-10-29", "Estimate", 0),
    j("e-unassigned", "Bo", "2026-10-29", "Estimate", 0),
    j("f-status-profit", "Eve", "2026-10-30", "Closed", 1000),
    j("g-location", "Cy", "2026-10-30", "Closed", 500, "Chicago"),
    j("h-same", "Cy", "2026-10-31", "Closed", 500),
  ], "2026-11-02T06:00:00.000Z");
  const after = src([
    j("c-redated-baseline", "Eve", "2026-10-20", "Estimate", 0),
    j("d-reassigned", "Bo", "2026-10-29", "Estimate", 0),
    j("f-status-profit", "Eve", "2026-10-30", "X close", 900),
    j("g-location", "Cy", "2026-10-30", "Closed", 500, "Gary"),
    j("h-same", "Cy", "2026-10-31", "Closed", 500),
    j("i-new", "Ann", "2026-11-01", "Closed", 700),
  ], "2026-11-03T18:00:00.000Z", { "f-status-profit": "2026-11-03T09:15:00.000Z" });
  const at = "2026-11-03T18:00:00.000Z";
  const changes = diffJobs(before, after, "2026-10-26", at, {
    "a-deleted": "deleted",
    "b-redated-away": j("b-redated-away", "Eve", "2026-11-04", "Estimate", 0),
    "e-unassigned": j("e-unassigned", "", "2026-10-29", "Estimate", 0),
  });
  const by = (id: string) => changes.filter((c) => c.jobId === id).map((c) => c.kind);
  assert.deepEqual(by("a-deleted"), ["removed"]);
  assert.deepEqual(by("b-redated-away"), ["redated_out"]);
  assert.equal(changes.find((c) => c.jobId === "b-redated-away")!.after, "2026-11-04");
  assert.deepEqual(by("c-redated-baseline"), ["redated_out"]);
  assert.deepEqual(by("d-reassigned"), ["reassigned"]);
  assert.equal(changes.find((c) => c.jobId === "d-reassigned")!.detail, "re-assigned Ann → Bo");
  assert.deepEqual(by("e-unassigned"), ["reassigned"]);
  assert.equal(changes.find((c) => c.jobId === "e-unassigned")!.after, "(nobody)");
  assert.deepEqual(by("f-status-profit"), ["profit", "status"]);
  assert.deepEqual(by("g-location"), ["location"]);
  assert.deepEqual(by("h-same"), []);
  assert.deepEqual(by("i-new"), ["added"]);
  assert.ok(changes.every((c) => c.detectedAt === at));
  assert.equal(changes.find((c) => c.kind === "status")!.crmUpdatedAt, "2026-11-03T09:15:00.000Z");
  assert.equal(changes.find((c) => c.kind === "removed")!.crmUpdatedAt, null, "no edit time recorded → null, never invented");
  // the change-set identity ignores when it was seen
  const again = diffJobs(before, after, "2026-10-26", "2026-11-04T00:00:00.000Z", {
    "a-deleted": "deleted", "b-redated-away": j("b-redated-away", "Eve", "2026-11-04", "Estimate", 0), "e-unassigned": j("e-unassigned", "", "2026-10-29", "Estimate", 0),
  });
  assert.equal(changeSetHash(again), changeSetHash(changes));
  // without a lookup, a vanished job is reported as removed (not looked up)
  assert.match(diffJobs(before, after, "2026-10-26", at).find((c) => c.jobId === "a-deleted")!.detail, /not looked up/);
});

// ── 4. materiality ─────────────────────────────────────────────────────────

const cr = (id: string, rank: number, o: Partial<CompetitorResult> = {}) =>
  ({ competitorId: id, displayName: id, rank, score: 100 - rank, eligible: true, prizeEligible: true, prizePosition: null, prizeCents: 0,
    wonMostImproved: false, assignedJobs: 10, closedJobs: 5, qualifyingJobs: 10, profitMicro: 0, ...o }) as CompetitorResult;
const res = (rows: CompetitorResult[], mi: string | null = null) => ({ results: rows, mostImprovedWinner: mi }) as CompetitionResult;

test("lateImpact: prize swap, Most Improved change and a prize-relevant eligibility flip are material; a change below the prize zone is not", () => {
  const base = res([cr("A", 1, { prizePosition: 1, prizeCents: 100 }), cr("B", 2, { prizePosition: 2, prizeCents: 50 }), cr("C", 3), cr("D", 4)]);
  // below the prize zone: C and D swap, nobody's prize changes
  const swapBelow = res([cr("A", 1, { prizePosition: 1, prizeCents: 100 }), cr("B", 2, { prizePosition: 2, prizeCents: 50 }), cr("D", 3), cr("C", 4)]);
  const i1 = lateImpact(base, swapBelow);
  assert.equal(i1.material, false);
  assert.equal(i1.rows.length, 2);
  // prize swap
  const swap = res([cr("B", 1, { prizePosition: 1, prizeCents: 100 }), cr("A", 2, { prizePosition: 2, prizeCents: 50 }), cr("C", 3), cr("D", 4)]);
  const i2 = lateImpact(base, swap);
  assert.equal(i2.material, true);
  assert.match(i2.reasons.join(), /A: prize #1 \(\$1\) → #2 \(\$1\)/);
  // Most Improved
  const mi = res([cr("A", 1, { prizePosition: 1, prizeCents: 100 }), cr("B", 2, { prizePosition: 2, prizeCents: 50 }), cr("C", 3, { wonMostImproved: true, prizeCents: 25 }), cr("D", 4)], "C");
  assert.match(lateImpact(base, mi).reasons.join(), /C: .*now wins Most Improved/);
  // eligibility flip of a prize holder that keeps its money (e.g. unresolved) is material
  const elig = res([cr("A", 1, { prizePosition: 1, prizeCents: 100, eligible: false, prizeEligible: false }), cr("B", 2, { prizePosition: 2, prizeCents: 50 }), cr("C", 3), cr("D", 4)]);
  assert.match(lateImpact(base, elig).reasons.join(), /A: loses prize eligibility/);
  // eligibility flip far below the cut-off is listed, not material
  const low = res([cr("A", 1, { prizePosition: 1, prizeCents: 100 }), cr("B", 2, { prizePosition: 2, prizeCents: 50 }), cr("C", 3), cr("D", 4, { eligible: false, prizeEligible: false })]);
  const i5 = lateImpact(base, low);
  assert.equal(i5.material, false);
  assert.equal(i5.rows[0].competitorId, "D");
});

// ── 3/4/6. the lifecycle, end to end on the trial scenario ─────────────────

test("trial scenario (WEIGHTED_V0): immaterial edits are listed without blocking; deleting Dan's $0 Estimate flips #3/#4 and BLOCKS approval", async () => {
  const f = await frozenTrial();
  const fr = f.frozen.result;
  assert.deepEqual([row(fr, CY.id).rank, row(fr, DAN.id).rank], [3, 4]);
  assert.deepEqual([row(fr, DAN.id).assignedJobs, row(fr, DAN.id).closedJobs, row(fr, DAN.id).qualifyingJobs], [35, 20, 30]);
  assert.equal(row(fr, DAN.id).profitMicro, 30_741_550_000);

  // Immaterial: Eve (not eligible, last) — re-dated out, re-assigned to a pool, status and profit edited.
  const eve = f.data.jobs.filter((j) => j.tech === "Eve");
  const [eClosed, e1, e2, e3] = [eve[0], eve[3], eve[4], eve[5]];
  removeJob(f, e1.id);
  f.data.lookup.set(e1.id, { ...e1, date: "2026-11-03" });
  editJob(f, e2.id, { tech: "POOL" });
  editJob(f, e3.id, { status: "Price Issue" });
  editJob(f, eClosed.id, { profit: 900 });
  f.setNow("2026-11-02T15:00:00Z");
  const r1 = await openReview(f.ctx, f.id, ADMIN);
  assert.deepEqual(r1.lateChanges!.changes.map((c) => c.kind).sort(), ["profit", "reassigned", "redated_out", "status"]);
  assert.equal(r1.lateChanges!.impact.material, false);
  assert.equal(r1.lateChanges!.updateTimestampField, null);
  assert.ok(r1.lateChanges!.changes.every((c) => c.detectedAt === "2026-11-02T15:00:00.000Z" && c.crmUpdatedAt === null));
  assert.deepEqual(snapshotBlockers(r1), []);
  assert.equal(r1.basis, "read");

  // Material: the trial's edit.
  removeJob(f, f.danZeroEstimate);
  f.setNow("2026-11-03T16:00:00Z");
  const r2 = await reconcileCompetition(f.ctx, f.id, ADMIN);
  const removed = r2.lateChanges!.changes.find((c) => c.jobId === f.danZeroEstimate)!;
  assert.equal(removed.kind, "removed");
  assert.equal(removed.detail, "deleted from the CRM");
  assert.equal(r2.lateChanges!.impact.material, true);
  assert.deepEqual([row(r2.result, DAN.id).rank, row(r2.result, CY.id).rank], [3, 4]);
  assert.deepEqual([row(r2.result, DAN.id).assignedJobs, row(r2.result, DAN.id).closedJobs, row(r2.result, DAN.id).qualifyingJobs], [34, 20, 29]);
  assert.match(r2.lateChanges!.impact.reasons.join("; "), /Dan D\.: prize #4 \(\$150\) → #3 \(\$200\)/);
  assert.match(r2.lateChanges!.impact.reasons.join("; "), /Cy C\.: prize #3 \(\$200\) → #4 \(\$150\)/);
  assert.match(snapshotBlockers(r2).join(), /keep freeze snapshot.*accept correction/);
  f.setNow(TUE_NOON);
  await assert.rejects(approveResults(f.ctx, f.id, OWNER, { snapshotId: r2._id }), (e: Error) => e instanceof ArenaStateError && /CRM jobs changed after the freeze/.test(e.message));
  assert.equal(await f.lc.results.findOne({ _id: f.id }), null, "nothing approved");
});

test("the owner's choice: owner only, a reason, on the exact snapshot; KEEP FREEZE approves the freeze job set; the choice survives a re-check with the same changes", async () => {
  const f = await frozenTrial();
  f.setNow("2026-11-02T15:00:00Z");
  await openReview(f.ctx, f.id, ADMIN);
  removeJob(f, f.danZeroEstimate);
  f.setNow(TUE_NOON);
  const blocked = await reconcileCompetition(f.ctx, f.id, ADMIN);
  await assert.rejects(decideLateChanges(f.ctx, f.id, ADMIN, { snapshotId: blocked._id, choice: "keep_freeze", reason: "frozen data" }), ArenaAuthorizationError);
  await assert.rejects(decideLateChanges(f.ctx, f.id, OWNER, { snapshotId: blocked._id, choice: "keep_freeze", reason: " " }), /reason is required/);
  await assert.rejects(decideLateChanges(f.ctx, f.id, OWNER, { snapshotId: "stale", choice: "keep_freeze", reason: "frozen data" }), /changed since you opened them/);
  await assert.rejects(decideLateChanges(f.ctx, f.id, OWNER, { snapshotId: blocked._id, choice: "maybe" as never, reason: "x y z" }), /keep_freeze/);

  const kept = await decideLateChanges(f.ctx, f.id, OWNER, { snapshotId: blocked._id, choice: "keep_freeze", reason: "estimate deleted after the week closed; office cleanup, not a real change" });
  assert.equal(kept.basis, "freeze_jobs");
  assert.equal(kept.lateDecision!.choice, "keep_freeze");
  assert.equal(kept.source!.jobsFrom!.snapshotId, f.frozen._id);
  assert.equal(kept.source!.jobsHash, f.frozen.source!.jobsHash, "the freeze job set, exactly");
  // Same job set → same ranks, scores and prizes as at freeze (only the account check time is newer).
  const standing = (r: CompetitionResult) => r.results.map((x) => [x.competitorId, x.rank, x.score, x.prizePosition, x.prizeCents]);
  assert.deepEqual(standing(kept.result), standing(f.frozen.result));
  assert.equal(kept.reproducible, true);
  assert.deepEqual(snapshotBlockers(kept), []);
  await assert.rejects(decideLateChanges(f.ctx, f.id, OWNER, { snapshotId: kept._id, choice: "accept_correction", reason: "changed my mind" }), /already decided/);
  const audit = await f.config.store.audit.find({ action: "competition.late_changes.keep_freeze" }).sort({ at: 1 }).toArray();
  assert.equal(audit.length, 1);
  assert.match(String(audit[0].reason), /office cleanup/);

  // A re-check that finds the same changes keeps the decision.
  const again = await reconcileCompetition(f.ctx, f.id, ADMIN);
  assert.equal(again.lateDecision!.carriedFrom, kept._id);
  assert.equal(again.basis, "freeze_jobs");
  assert.deepEqual(standing(again.result), standing(f.frozen.result));

  const r = await approveResults(f.ctx, f.id, OWNER, { snapshotId: again._id });
  assert.deepEqual([r.standings.find((s) => s.competitorId === CY.id)!.prizePosition, r.standings.find((s) => s.competitorId === DAN.id)!.prizePosition], [3, 4]);
  assert.equal(r.sourceInputHash, again.source!.inputHash);
  assert.equal(r.snapshotResultHash, again.resultHash);
});

test("a NEW material change after the owner's choice blocks again", async () => {
  const f = await frozenTrial();
  f.setNow("2026-11-02T15:00:00Z");
  await openReview(f.ctx, f.id, ADMIN);
  removeJob(f, f.danZeroEstimate);
  f.setNow(TUE_NOON);
  const b = await reconcileCompetition(f.ctx, f.id, ADMIN);
  await decideLateChanges(f.ctx, f.id, OWNER, { snapshotId: b._id, choice: "keep_freeze", reason: "keep the frozen data" });
  // Cy loses one closed job to Ann (re-assigned): a different change set.
  editJob(f, f.data.jobs.find((j) => j.tech === "Cy" && j.status === "Closed")!.id, { tech: "Ann" });
  const c = await reconcileCompetition(f.ctx, f.id, ADMIN);
  assert.equal(c.lateDecision, null);
  assert.equal(c.lateChanges!.impact.material, true);
  await assert.rejects(approveResults(f.ctx, f.id, OWNER, { snapshotId: c._id }), /CRM jobs changed after the freeze/);
});

test("trial scenario under BALANCED_PERFORMANCE_V1: it flips too and blocks; ACCEPT CORRECTION approves the corrected read", async () => {
  const f = await frozenTrial("balanced");
  assert.deepEqual([row(f.frozen.result, CY.id).rank, row(f.frozen.result, DAN.id).rank], [3, 4]);
  f.setNow("2026-11-02T15:00:00Z");
  await openReview(f.ctx, f.id, ADMIN);
  removeJob(f, f.danZeroEstimate);
  f.setNow(TUE_NOON);
  const b = await reconcileCompetition(f.ctx, f.id, ADMIN);
  assert.equal(b.lateChanges!.impact.material, true);
  assert.deepEqual([row(b.result, DAN.id).rank, row(b.result, CY.id).rank], [3, 4]);
  await assert.rejects(approveResults(f.ctx, f.id, OWNER, { snapshotId: b._id }), /CRM jobs changed after the freeze/);
  const acc = await decideLateChanges(f.ctx, f.id, OWNER, { snapshotId: b._id, choice: "accept_correction", reason: "the estimate was entered by mistake" });
  assert.equal(acc.basis, "read");
  assert.equal(acc.resultHash, b.resultHash);
  const r = await approveResults(f.ctx, f.id, OWNER, { snapshotId: acc._id });
  assert.equal(r.standings.find((s) => s.competitorId === DAN.id)!.prizePosition, 3);
});

// ── 5. after approval ──────────────────────────────────────────────────────

test("post-approval CRM edit: detected and logged once for the owner; approved result, snapshot, approvals and feed byte-identical", async () => {
  const f = await frozenTrial();
  f.setNow("2026-11-02T15:00:00Z");
  const r1 = await openReview(f.ctx, f.id, ADMIN);
  f.setNow(TUE_NOON);
  const result = await approveResults(f.ctx, f.id, OWNER, { snapshotId: r1._id });
  const before = structuredClone({ results: f.lc.results.docs, snapshots: f.lc.snapshots.docs, approvals: f.lc.approvals.docs, events: f.lc.events.docs });

  const none = await checkLateCorrections(f.ctx, f.id, ADMIN);
  assert.equal(none.status, "unchanged");
  assert.equal(f.lc.lateCorrections.docs.length, 0);

  removeJob(f, f.danZeroEstimate);
  editJob(f, f.data.jobs.find((j) => j.tech === "Ann")!.id, { profit: 1 });
  f.setNow("2026-11-05T10:00:00Z");
  const c = await checkLateCorrections(f.ctx, f.id, ADMIN);
  assert.equal(c.status, "logged");
  assert.deepEqual(c.report.changes.map((x) => x.kind).sort(), ["profit", "removed"]);
  assert.equal(c.report.impact.material, true, "it would have flipped #3/#4");
  assert.equal(c.record!.approvedContentHash, result.contentHash);
  assert.equal(c.record!.ownerAction, "manual");
  assert.equal((await checkLateCorrections(f.ctx, f.id, ADMIN)).status, "already_logged");
  assert.equal(f.lc.lateCorrections.docs.length, 1);

  assert.deepEqual({ results: f.lc.results.docs, snapshots: f.lc.snapshots.docs, approvals: f.lc.approvals.docs, events: f.lc.events.docs }, before);
  const rv = (await f.config.store.ruleVersions.findOne({ _id: result.ruleVersionId }))!;
  assert.equal(verifySnapshotSource((await f.lc.snapshots.findOne({ _id: result.snapshotId }))!, rv).ok, true);
  assert.equal((await f.config.store.competitions.findOne({ _id: f.id }))!.status, "approved");
  await assert.rejects(checkLateCorrections(f.ctx, "nope", ADMIN), ArenaStateError);
});

test("snapshots computed without a source (older records / callers that cannot provide one) keep the old behaviour", async () => {
  const f = await fixture({ people: P });
  f.data.jobs = trialWeek().jobs;
  const id = await f.startWeek();
  const compute = f.ctx.compute;
  f.ctx.compute = async (w, rv, m) => ({ result: (await compute(w, rv, m)).result });
  f.setNow(FREEZE_AT);
  const s = await freezeCompetition(f.ctx, id, ADMIN);
  assert.equal(s.source, undefined);
  f.setNow(TUE_NOON);
  const r = await openReview(f.ctx, id, ADMIN);
  assert.equal(r.lateChanges, undefined);
  assert.deepEqual(snapshotBlockers(r), []);
  await approveResults(f.ctx, id, OWNER, { snapshotId: (await reviewSnapshot(f.ctx, id))!._id });
  await assert.rejects(checkLateCorrections(f.ctx, id, ADMIN), /before source snapshots existed/);
});

test("recomputing the frozen job set with today's decisions isolates CRM edits from review decisions", () => {
  const map = buildCompetitorMap({
    mappings: P.map((p) => ({ supabaseUserId: p.id, supabaseFullName: p.name, crmTechNames: [p.crm] })),
    technicians: P.map((p) => ({ _id: p.crm, location: p.location })), crmNamesInUse: P.map((p) => p.crm),
  });
  const t = trialWeek();
  const s = buildSource({
    readAt: "2026-11-02T06:00:00.000Z", identity: { system: "crm", database: "t", collection: "Job", user: null, via: "t" },
    window: { from: "2026-09-28", toExclusive: "2026-11-02" }, jobs: t.jobs, competitors: map, accounts: {},
  });
  const direct = computeCompetition({ rules: SEED_STANDARD_WEEK, rulesHash: "h", weekStart: WEEK, competitors: map, jobs: t.jobs, accounts: {} });
  assert.equal(resultHash(computeFromSource(s, SEED_STANDARD_WEEK, "h", WEEK)), resultHash(direct));
  const swapped = withJobs(s, t.jobs.filter((j) => j.id !== t.danZeroEstimate), null);
  assert.notEqual(swapped.jobsHash, s.jobsHash);
  assert.equal(sourceProblems(swapped).length, 0);
  assert.deepEqual(swapped.competitors, s.competitors);
});
