// Account eligibility across the lifecycle: live (provisional, last known),
// freeze/review (fresh), approval (re-checked, must match the review),
// verifier unavailable (unresolved → blocked, nothing moved), approved weeks
// immutable, and what technicians may see.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  approvalBlockers, approveResults, freezeCompetition, liveSnapshot, openReview, reconcileCompetition, reviewSnapshot, ruleVersionOf,
} from "./lifecycle.ts";
import { ArenaStateError, amendActiveRules, rulesFor } from "./config-store.ts";
import { accountApprovalProblems, checkAccounts, classifyAccount } from "./accounts.ts";
import { leaderboardRows, myStanding } from "./tech/views.ts";
import { techLeaderboard } from "./tech/service.ts";
import { cloneRules } from "./config.ts";
import { fixture, jobs, ADMIN, OWNER, PEOPLE } from "./testing/lifecycle-fixture.ts";
import { MemoryCollection } from "./testing/memory-collection.ts";
import type { CompetitionResult } from "./types.ts";

const [ANN, BO, CY] = PEOPLE;
const TUE_NOON = "2026-11-03T17:00:00.000Z";
const OK = { active: true, approved: true, role: "technician" };
const PENDING = { active: true, approved: false, role: "technician" };
const INACTIVE = { active: false, approved: true, role: "technician" };

/** All three qualify; ranked Ann > Bo > Cy; prizes 1st/2nd/3rd for them. */
function threeQualified() {
  return [
    ...jobs(10, "Ann", "Closed", 1000), ...jobs(10, "Bo", "Closed", 900), ...jobs(10, "Cy", "Closed", 800),
  ];
}

async function setup(prizesCents = [30_000, 20_000]) {
  const f = await fixture();
  f.data.jobs = threeQualified();
  const id = await f.startWeek();
  const rules = cloneRules((await rulesFor(f.config, id)).rules);
  rules.prizes.positionsCents = prizesCents;
  rules.prizes.budgetCents = prizesCents.reduce((a, b) => a + b, 0) + rules.mostImproved.amountCents;
  rules.mostImproved.enabled = false;
  await amendActiveRules(f.config, id, rules, OWNER, "test prizes");
  return { ...f, id };
}

const prizeHolders = (r: CompetitionResult) =>
  r.results.filter((x) => x.prizePosition !== null).sort((a, b) => a.prizePosition! - b.prizePosition!).map((x) => x.competitorId);

async function toReview(f: Awaited<ReturnType<typeof setup>>) {
  f.setNow("2026-11-02T06:00:00Z");
  await freezeCompetition(f.ctx, f.id, ADMIN);
  await openReview(f.ctx, f.id, ADMIN);
  f.setNow(TUE_NOON);
  return (await reviewSnapshot(f.ctx, f.id))!;
}

test("classifyAccount maps Weekly Balance answers to states", () => {
  assert.equal(classifyAccount(OK), "eligible");
  assert.equal(classifyAccount(PENDING), "pending");
  assert.equal(classifyAccount(INACTIVE), "inactive");
  assert.equal(classifyAccount({ active: false, approved: false, role: "technician" }), "inactive");
  assert.equal(classifyAccount(null), "unmapped");
  assert.equal(classifyAccount({ active: true, approved: true, role: "management" }), "not_competing_role");
  assert.equal(classifyAccount({ active: true, approved: true, role: "area_manager" }), "eligible");
});

test("review: a PENDING competitor in a would-be prize spot is skipped; approval pays the eligible ranking", async () => {
  const f = await setup();
  f.data.accounts.set(ANN.id, PENDING);
  const snap = await toReview(f);
  const r = snap.result;
  assert.deepEqual(prizeHolders(r), [BO.id, CY.id]);
  const ann = r.results.find((x) => x.competitorId === ANN.id)!;
  assert.equal(ann.rank, 1, "still ranked (CRM performance intact)");
  assert.equal(ann.eligible, true);
  assert.equal(ann.prizeEligible, false);
  assert.equal(ann.account.state, "pending");
  assert.deepEqual(approvalBlockers(r), []);
  const doc = await approveResults(f.ctx, f.id, OWNER, { snapshotId: snap._id });
  assert.equal(doc.standings.find((s) => s.competitorId === ANN.id)!.account, "pending");
  assert.equal(doc.standings.find((s) => s.competitorId === ANN.id)!.prizeCents, 0);
  assert.equal(doc.standings.find((s) => s.competitorId === BO.id)!.prizePosition, 1);
});

test("verifier DOWN at freeze/review: unresolved, nothing redistributed, approval blocked with a clear message", async () => {
  const f = await setup();
  f.data.verifierDown = true;
  const snap = await toReview(f);
  assert.deepEqual(prizeHolders(snap.result), [ANN.id, BO.id], "same allocation as if everyone were eligible");
  assert.deepEqual(snap.result.accountUnresolved.sort(), [ANN.id, BO.id, CY.id].sort());
  const blockers = approvalBlockers(snap.result);
  assert.equal(blockers.length, 1);
  assert.match(blockers[0], /could not be verified/);
  assert.match(blockers[0], /Nobody was disqualified or moved/);
  await assert.rejects(approveResults(f.ctx, f.id, OWNER, { snapshotId: snap._id }), /could not be verified/);
  assert.equal(await f.lc.results.findOne({ _id: f.id }), null);
  // verifier back → re-check → approve
  f.data.verifierDown = false;
  const re = await reconcileCompetition(f.ctx, f.id, ADMIN);
  assert.deepEqual(re.result.accountUnresolved, []);
  await approveResults(f.ctx, f.id, OWNER, { snapshotId: re._id });
});

test("verifier down for ONE contender only: still blocks; a non-contender being unverifiable does not", async () => {
  const f = await setup();
  f.data.jobs.push(...jobs(2, "Cy", "Estimate", 0)); // keep Cy eligible
  f.data.verifierDown = new Set([CY.id]);
  const snap = await toReview(f);
  assert.deepEqual(snap.result.accountUnresolved, [CY.id]);
  await assert.rejects(approveResults(f.ctx, f.id, OWNER, { snapshotId: snap._id }), ArenaStateError);
});

test("status flips between review and approval → approval blocked until re-check; then the re-reviewed result is approved", async () => {
  const f = await setup();
  const snap = await toReview(f);
  assert.deepEqual(prizeHolders(snap.result), [ANN.id, BO.id]);
  f.data.accounts.set(BO.id, INACTIVE); // deactivated after the owner opened the review
  await assert.rejects(approveResults(f.ctx, f.id, OWNER, { snapshotId: snap._id }), /account status changed since this review: Bo Baker \(eligible → inactive\)/i);
  assert.equal(await f.lc.results.findOne({ _id: f.id }), null, "nothing approved");
  const audit = await f.config.store.audit.find({ action: "competition.approve.refused" }).sort({ at: 1 }).toArray();
  assert.equal(audit.length, 1);
  const re = await reconcileCompetition(f.ctx, f.id, ADMIN);
  assert.deepEqual(prizeHolders(re.result), [ANN.id, CY.id], "Bo skipped, Cy moves up");
  await assert.rejects(approveResults(f.ctx, f.id, OWNER, { snapshotId: snap._id }), /changed since you opened them/);
  const doc = await approveResults(f.ctx, f.id, OWNER, { snapshotId: re._id });
  assert.equal(doc.standings.find((s) => s.competitorId === CY.id)!.prizePosition, 2);
});

test("re-activation between review and approval also requires re-review (any change blocks)", async () => {
  const f = await setup();
  f.data.accounts.set(ANN.id, PENDING);
  const snap = await toReview(f);
  f.data.accounts.set(ANN.id, OK);
  await assert.rejects(approveResults(f.ctx, f.id, OWNER, { snapshotId: snap._id }), /pending → eligible/);
});

test("verifier down at the moment of approval → blocked, and nothing is redistributed", async () => {
  const f = await setup();
  const snap = await toReview(f);
  f.data.verifierDown = true;
  await assert.rejects(approveResults(f.ctx, f.id, OWNER, { snapshotId: snap._id }), /unavailable right now/);
  assert.equal(await f.lc.results.findOne({ _id: f.id }), null);
  const again = await reviewSnapshot(f.ctx, f.id);
  assert.equal(again!._id, snap._id, "no new snapshot, prizes untouched");
});

test("approved weeks are immutable: a later account change never recalculates them", async () => {
  const f = await setup();
  const snap = await toReview(f);
  const doc = await approveResults(f.ctx, f.id, OWNER, { snapshotId: snap._id });
  f.data.accounts.set(ANN.id, INACTIVE);
  f.data.accounts.set(BO.id, PENDING);
  await assert.rejects(reconcileCompetition(f.ctx, f.id, ADMIN), ArenaStateError);
  await assert.rejects(approveResults(f.ctx, f.id, OWNER, { snapshotId: snap._id }), /already approved/);
  const stored = (await f.lc.results.findOne({ _id: f.id }))!;
  assert.deepEqual(stored, doc);
  const computeBefore = f.data.computeCalls;
  const lb = await techLeaderboard({ lifecycle: f.ctx, review: null as never, crmDb: null as never }, CY.id, "national", null);
  assert.equal(f.data.computeCalls, computeBefore, "an approved week is served from the record, not recomputed");
  assert.deepEqual(lb.rows.filter((r) => r.prizeCents > 0).map((r) => r.competitorId), [ANN.id, BO.id]);
});

test("live: the same rule applies provisionally; a failed check falls back to the last known answer", async () => {
  const f = await setup();
  const c = (await f.config.store.competitions.findOne({ _id: f.id }))!;
  const rv = await ruleVersionOf(f.ctx, c);
  f.data.accounts.set(ANN.id, PENDING);
  const s1 = (await liveSnapshot(f.ctx, c, rv))!;
  assert.deepEqual(prizeHolders(s1.result), [BO.id, CY.id]);
  assert.equal(s1.result.results.find((x) => x.competitorId === ANN.id)!.account.lastKnown, undefined);
  f.data.verifierDown = true;
  f.setNow("2026-10-28T15:05:00Z");
  const s2 = (await liveSnapshot(f.ctx, c, rv))!;
  const ann = s2.result.results.find((x) => x.competitorId === ANN.id)!;
  assert.equal(ann.account.state, "pending");
  assert.equal(ann.account.lastKnown, true);
  assert.deepEqual(prizeHolders(s2.result), [BO.id, CY.id], "consistent with the last known status");
});

test("live: never-checked + verifier down → unverified (kept in place, not moved)", async () => {
  const f = await setup();
  f.data.verifierDown = true;
  const c = (await f.config.store.competitions.findOne({ _id: f.id }))!;
  const s = (await liveSnapshot(f.ctx, c, await ruleVersionOf(f.ctx, c)))!;
  assert.deepEqual(prizeHolders(s.result), [ANN.id, BO.id]);
  assert.ok(s.result.results.every((x) => x.account.state === "unverified"));
});

test("freeze/review never use the last known answer (fresh only)", async () => {
  const cache = new MemoryCollection<{ _id: string; state: "eligible"; checkedAt: string }>();
  await cache.insertOne({ _id: ANN.id, state: "eligible", checkedAt: "2026-10-28T00:00:00Z" });
  const deps = { verifier: { verify: async () => { throw new Error("down"); } }, cache, now: () => new Date() };
  assert.equal((await checkAccounts(deps as never, [ANN.id], "fresh"))[ANN.id].state, "unverified");
  assert.equal((await checkAccounts(deps as never, [ANN.id], "live"))[ANN.id].state, "eligible");
  assert.equal((await checkAccounts({ verifier: null, cache: null, now: () => new Date() }, [ANN.id], "fresh"))[ANN.id].state, "unverified");
});

test("accountApprovalProblems: a snapshot from before the account rule must be re-checked", () => {
  const r = { results: [{ competitorId: ANN.id, displayName: "Ann", eligible: true }] } as unknown as CompetitionResult;
  const p = accountApprovalProblems(r, { [ANN.id]: { state: "eligible", checkedAt: "x" } });
  assert.match(p.join(), /not checked → eligible/);
});

test("technicians never see another competitor's account status", async () => {
  const f = await setup();
  f.data.accounts.set(ANN.id, INACTIVE);
  const snap = await toReview(f);
  const rv = await ruleVersionOf(f.ctx, (await f.config.store.competitions.findOne({ _id: f.id }))!);
  rv.rules.display.showIneligibleMetrics = true;
  const { toStanding } = await import("./lifecycle.ts");
  const standings = snap.result.results.map(toStanding);
  const national = leaderboardRows(standings, rv.rules, "in_review", BO.id, "national");
  const ann = national.find((r) => r.competitorId === ANN.id)!;
  assert.equal(ann.rank, 1);
  assert.equal(ann.eligible, false, "shown only as not prize-eligible");
  assert.equal(ann.prizeCents, 0);
  assert.equal(ann.closingRateBp, null);
  assert.equal(ann.avgTicketCents, null);
  assert.equal(ann.qualifyingJobs, null);
  const text = JSON.stringify(national);
  for (const w of ["inactive", "pending", "unmapped", "account", "verif"]) assert.ok(!text.includes(w), `no "${w}" in technician rows`);
  const eligibleView = leaderboardRows(standings, rv.rules, "in_review", BO.id, "eligible");
  assert.ok(!eligibleView.some((r) => r.competitorId === ANN.id));
  // Bo's own dashboard: holds the 1st prize the excluded Ann would have taken
  const mine = myStanding(standings.find((s) => s.competitorId === BO.id)!, standings, rv.rules, "in_review");
  assert.equal(mine.eligible, true);
  assert.ok(mine.potentialPrizeCents > 0);
  assert.ok(!JSON.stringify(mine).includes("inactive"));
});
