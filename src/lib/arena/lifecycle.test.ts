// Lifecycle: live snapshot caching, freeze at Sunday end (DST-aware), review,
// OWNER-ONLY approval after the review window, immutable results, the event
// feed, the dev-only early freeze, and "no payouts".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  approveResults, currentCompetition, diffEvents, freezeCompetition, freezeIfDue, liveSnapshot, openReview,
  phaseOf, reconcileCompetition, resultContentHash, reviewSnapshot, ruleVersionOf, windowOf,
} from "./lifecycle.ts";
import { ArenaAuthorizationError, ArenaStateError, amendActiveRules, rulesFor } from "./config-store.ts";
import { cloneRules } from "./config.ts";
import { fixture, jobs, ADMIN, OWNER, PEOPLE, WEEK } from "./testing/lifecycle-fixture.ts";

const [ANN, BO, CY] = PEOPLE;
const SUNDAY_END = "2026-11-02T05:00:00.000Z"; // Mon 00:00 EST (DST ended Nov 1)
const TUE_NOON = "2026-11-03T17:00:00.000Z"; // Tue 12:00 EST

function standardJobs() {
  return [
    ...jobs(6, "Ann", "Closed", 1000), ...jobs(4, "Ann", "Estimate", 0),
    ...jobs(5, "Bo", "Closed", 900), ...jobs(5, "Bo", "Estimate", 0),
    ...jobs(4, "Cy", "Closed", 1000), ...jobs(4, "Cy", "Estimate", 0),
  ];
}

async function running() {
  const f = await fixture();
  f.data.jobs = standardJobs();
  const id = await f.startWeek();
  return { ...f, id };
}

async function inReview() {
  const f = await running();
  f.setNow("2026-11-02T06:00:00Z");
  await freezeCompetition(f.ctx, f.id, ADMIN);
  await openReview(f.ctx, f.id, ADMIN);
  return f;
}

test("week window: Mon 00:00 → next Mon 00:00 America/New_York across the DST change; review opens Tue 12:00", async () => {
  const f = await running();
  const c = (await f.config.store.competitions.findOne({ _id: f.id }))!;
  const w = windowOf(c, await ruleVersionOf(f.ctx, c));
  assert.equal(w.startsAt.toISOString(), "2026-10-26T04:00:00.000Z"); // EDT
  assert.equal(w.closesAt.toISOString(), SUNDAY_END); // EST
  assert.equal(w.approvalOpensAt.toISOString(), TUE_NOON);
  assert.equal(phaseOf(c, w, new Date("2026-11-02T04:59:59Z")), "live");
  assert.equal(phaseOf(c, w, new Date(SUNDAY_END)), "frozen");
});

test("live snapshot: computed on read, cached for refreshSeconds, then recomputed", async () => {
  const f = await running();
  const c = (await f.config.store.competitions.findOne({ _id: f.id }))!;
  const rv = await ruleVersionOf(f.ctx, c);
  const s1 = await liveSnapshot(f.ctx, c, rv);
  assert.equal(f.data.computeCalls, 1);
  assert.equal(s1!.result.results.find((r) => r.competitorId === ANN.id)!.eligible, true);
  f.setNow("2026-10-28T15:00:10Z");
  await liveSnapshot(f.ctx, c, rv);
  assert.equal(f.data.computeCalls, 1, "served from cache inside the refresh interval");
  f.setNow("2026-10-28T15:00:31Z");
  const s3 = await liveSnapshot(f.ctx, c, rv);
  assert.equal(f.data.computeCalls, 2);
  assert.equal(s3!.n, 2);
});

test("a concurrent recompute is claimed by one caller only", async () => {
  const f = await running();
  const c = (await f.config.store.competitions.findOne({ _id: f.id }))!;
  const rv = await ruleVersionOf(f.ctx, c);
  await Promise.all([liveSnapshot(f.ctx, c, rv), liveSnapshot(f.ctx, c, rv), liveSnapshot(f.ctx, c, rv)]);
  assert.equal(f.data.computeCalls, 1);
});

test("an owner amendment changes scoring on the very next read (no cache wait)", async () => {
  const f = await running();
  let c = (await f.config.store.competitions.findOne({ _id: f.id }))!;
  const before = await liveSnapshot(f.ctx, c, await ruleVersionOf(f.ctx, c));
  assert.equal(before!.result.results.find((r) => r.competitorId === CY.id)!.eligible, false);
  const rules = cloneRules((await rulesFor(f.config, f.id)).rules);
  rules.eligibility.minQualifyingJobs = 8;
  await amendActiveRules(f.config, f.id, rules, OWNER, "Short week");
  c = (await f.config.store.competitions.findOne({ _id: f.id }))!;
  const after = await liveSnapshot(f.ctx, c, await ruleVersionOf(f.ctx, c));
  assert.equal(after!.result.results.find((r) => r.competitorId === CY.id)!.eligible, true, "Cy qualifies under the amended minimum");
  const ev = f.lc.events.docs.filter((e) => e.competitorId === CY.id).map((e) => e.event);
  assert.ok(ev.some((e) => e.kind === "qualified" && e.gate === "all"));
});

test("events: rank, qualification and prize-zone changes derive from successive snapshots", () => {
  const base = { weekStart: WEEK, rulesHash: "h", eligibleCount: 0, gateCounts: { jobs: 0, avgTicket: 0, closingRate: 0, allThree: 0 }, awardedCents: 0, unallocatedCents: 0, mostImprovedWinner: null, duplicateGroups: [], unattributed: [] };
  const row = (id: string, rank: number, eligible: boolean, jobsMet: boolean, prize: number | null) => ({
    competitorId: id, displayName: id, location: "", assignedJobs: 0, closedJobs: 0, xCloseJobs: 0, qualifyingJobs: 0, excludedFromQualifying: 0,
    profitMicro: 0, closingRate: 0, avgTicket: 0, closingIndex: 0, avgIndex: 0, score: 0,
    gates: { jobs: { met: jobsMet, actual: 0, required: 0 }, avgTicket: { met: eligible, actual: 0, required: 0 }, closingRate: { met: eligible, actual: 0, required: 0 } },
    eligible, rank, prizePosition: prize, prizeCents: 0, mostImproved: null, wonMostImproved: false, jobIds: [],
  });
  const prev = { ...base, results: [row("a", 1, false, false, null), row("b", 2, true, true, 1)] };
  const next = { ...base, results: [row("b", 2, false, true, null), row("a", 1, true, true, 1)] };
  const out = diffEvents(prev, next, "2026-10-28T15:00:00.000Z");
  const a = out.get("a")!.map((e) => e.kind + ("gate" in e ? `:${e.gate}` : ""));
  assert.deepEqual(a, ["qualified:all", "entered_prize_zone"]);
  const b = out.get("b")!.map((e) => e.kind + ("gate" in e ? `:${e.gate}` : ""));
  assert.deepEqual(b, ["lost_qualification:avgTicket", "lost_qualification:closingRate"]);
  assert.equal(diffEvents(null, next, "x").size, 0, "no events without a previous snapshot");
});

test("freeze: refused before Sunday ends; the first read after it freezes the week", async () => {
  const f = await running();
  f.setNow("2026-11-02T04:59:59Z");
  await assert.rejects(freezeCompetition(f.ctx, f.id, ADMIN), ArenaStateError);
  let c = (await f.config.store.competitions.findOne({ _id: f.id }))!;
  assert.equal((await freezeIfDue(f.ctx, c)).status, "active");
  f.setNow(SUNDAY_END);
  c = await freezeIfDue(f.ctx, c);
  assert.equal(c.status, "provisional");
  assert.ok(await f.lc.snapshots.findOne({ _id: `${f.id}:provisional` }));
  assert.ok(f.config.store.audit.docs.some((a: { action: string; by: string }) => a.action === "competition.freeze" && a.by === "system"));
  await assert.rejects(freezeCompetition(f.ctx, f.id, ADMIN), ArenaStateError, "a frozen week cannot be frozen again");
});

test("late CRM entries: review re-checks and shows the difference against the freeze", async () => {
  const f = await running();
  f.setNow("2026-11-02T06:00:00Z");
  await freezeCompetition(f.ctx, f.id, ADMIN);
  f.data.jobs.push(...jobs(2, "Cy", "Closed", 1000, "2026-11-01")); // Sunday jobs keyed in on Monday
  const snap = await openReview(f.ctx, f.id, ADMIN);
  assert.equal(snap.result.results.find((r) => r.competitorId === CY.id)!.eligible, true);
  const again = await reconcileCompetition(f.ctx, f.id, ADMIN);
  assert.equal(again.n, 2);
  assert.equal((await reviewSnapshot(f.ctx, f.id))!._id, again._id);
});

test("approval is OWNER ONLY", async () => {
  const f = await inReview();
  f.setNow(TUE_NOON);
  const snap = (await reviewSnapshot(f.ctx, f.id))!;
  await assert.rejects(approveResults(f.ctx, f.id, ADMIN, { snapshotId: snap._id }), ArenaAuthorizationError);
  // even an approver who is not the owner
  await f.config.store.settings.updateOne({ current: true }, { $set: { approverUserIds: [OWNER, ADMIN] } });
  await assert.rejects(approveResults(f.ctx, f.id, ADMIN, { snapshotId: snap._id }), ArenaAuthorizationError);
});

test("approval waits for the review window (Tue 12:00 ET) and needs the snapshot the owner saw", async () => {
  const f = await inReview();
  const snap = (await reviewSnapshot(f.ctx, f.id))!;
  f.setNow("2026-11-03T16:59:59Z");
  await assert.rejects(approveResults(f.ctx, f.id, OWNER, { snapshotId: snap._id }), /approval opens/);
  f.setNow(TUE_NOON);
  await assert.rejects(approveResults(f.ctx, f.id, OWNER, { snapshotId: "stale" }), /changed since/);
  const res = await approveResults(f.ctx, f.id, OWNER, { snapshotId: snap._id, note: "ok" });
  const { contentHash, ...rest } = res;
  assert.equal(contentHash, resultContentHash(rest), "content hash covers the whole record");
  const c = (await f.config.store.competitions.findOne({ _id: f.id }))!;
  assert.equal(c.status, "approved");
  assert.equal(res.standings.find((s) => s.competitorId === ANN.id)!.prizePosition, 1);
  assert.equal(JSON.stringify(res).includes("job0"), false, "the approved record holds no job ids");
});

test("approved results are immutable: a second approval is refused and the record is unchanged", async () => {
  const f = await inReview();
  f.setNow(TUE_NOON);
  const snap = (await reviewSnapshot(f.ctx, f.id))!;
  const first = await approveResults(f.ctx, f.id, OWNER, { snapshotId: snap._id });
  await assert.rejects(approveResults(f.ctx, f.id, OWNER, { snapshotId: snap._id }), /already approved/);
  await assert.rejects(f.lc.results.insertOne({ ...first }), /duplicate/);
  assert.deepEqual(await f.lc.results.findOne({ _id: f.id }), first);
  await assert.rejects(reconcileCompetition(f.ctx, f.id, ADMIN), ArenaStateError);
});

test("result_approved events are created only by the approval action", async () => {
  const f = await inReview();
  const kinds = () => f.lc.events.docs.map((e) => e.event.kind);
  assert.equal(kinds().includes("result_approved"), false, "nothing before approval");
  f.setNow(TUE_NOON);
  await approveResults(f.ctx, f.id, OWNER, { snapshotId: (await reviewSnapshot(f.ctx, f.id))!._id });
  const ann = f.lc.events.docs.filter((e) => e.competitorId === ANN.id && e.event.kind === "result_approved");
  assert.equal(ann.length, 1);
  assert.deepEqual({ ...ann[0].event, at: "" }, { kind: "result_approved", at: "", weekStart: WEEK, prizeCents: 45_000, position: 1, mostImproved: false });
  // structural: the literal appears in exactly one function of the lifecycle
  const src = readFileSync(join(import.meta.dirname, "lifecycle.ts"), "utf8");
  const uses = [...src.matchAll(/kind: "result_approved"/g)].map((m) => m.index!);
  assert.equal(uses.length, 1);
  assert.ok(uses[0] > src.indexOf("export async function approveResults"));
});

test("approval creates no payout, ledger or CRM write: only Arena collections change", async () => {
  const f = await inReview();
  f.setNow(TUE_NOON);
  const counts = () => ({
    results: f.lc.results.docs.length, approvals: f.lc.approvals.docs.length,
  });
  const before = counts();
  await approveResults(f.ctx, f.id, OWNER, { snapshotId: (await reviewSnapshot(f.ctx, f.id))!._id });
  assert.deepEqual(counts(), { results: before.results + 1, approvals: before.approvals + 1 });
  const src = readFileSync(join(import.meta.dirname, "lifecycle.ts"), "utf8")
    .replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(src, /payout|ledger_entry|finance_|collection\(/i);
});

test("blocking duplicate groups stop approval", async () => {
  const f = await running();
  f.data.jobs.push(
    { id: "dupA", tech: "Ann", date: WEEK, status: "Closed", location: "", profit: 500, dupKeys: ["phone:x"] },
    { id: "dupB", tech: "Ann", date: WEEK, status: "Closed", location: "", profit: 500, dupKeys: ["phone:x"] },
  );
  f.setNow("2026-11-02T06:00:00Z");
  await freezeCompetition(f.ctx, f.id, ADMIN);
  await openReview(f.ctx, f.id, ADMIN);
  f.setNow(TUE_NOON);
  await assert.rejects(approveResults(f.ctx, f.id, OWNER, { snapshotId: (await reviewSnapshot(f.ctx, f.id))!._id }), /duplicate/);
});

test("dev 'freeze now': refused off the dev stack and for non-owners; lets a dev demo be approved early", async () => {
  const off = await running();
  await assert.rejects(freezeCompetition(off.ctx, off.id, OWNER, { devEarlyClose: true }), /dev stack/);
  const f = await fixture({ devStack: true });
  f.data.jobs = standardJobs();
  const id = await f.startWeek();
  await assert.rejects(freezeCompetition(f.ctx, id, ADMIN, { devEarlyClose: true }), ArenaAuthorizationError);
  await freezeCompetition(f.ctx, id, OWNER, { devEarlyClose: true });
  await openReview(f.ctx, id, ADMIN);
  const snap = (await reviewSnapshot(f.ctx, id))!;
  // the dev flag alone is not enough off the dev stack
  f.ctx.devStack = false;
  await assert.rejects(approveResults(f.ctx, id, OWNER, { snapshotId: snap._id }), /approval opens/);
  f.ctx.devStack = true;
  await approveResults(f.ctx, id, OWNER, { snapshotId: snap._id });
  assert.ok(f.config.store.audit.docs.some((a: { action: string }) => a.action === "competition.freeze.dev"));
});

test("currentCompetition: the started week, else the next scheduled week as upcoming", async () => {
  const f = await fixture({ now: "2026-10-28T15:00:00Z" });
  assert.equal(await currentCompetition(f.ctx), null);
  const id = await f.startWeek();
  assert.equal((await currentCompetition(f.ctx))!.c._id, id);
});
