// LIVE BETA week mode (owner request 2026-11-09): a real-data test week labelled
// "LIVE BETA — TEST WEEK — NO OFFICIAL WINNERS OR PAYOUTS". It computes, freezes
// and goes through review exactly like any week, but can NEVER be approved as
// official: approval is refused with a clear message, no result record or
// approval row is written, and no `result_approved` event (the only celebration
// trigger) is ever emitted. Set by the owner only, audited, never cleared.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BETA_REFUSAL, approveResults, freezeCompetition, liveSnapshot, openReview, reconcileCompetition, reviewSnapshot, ruleVersionOf,
} from "./lifecycle.ts";
import {
  ArenaAuthorizationError, ArenaStateError, BETA_LABEL, activateCompetition, cancelCompetition, createCompetition, scheduleCompetition,
} from "./config-store.ts";
import { BETA_LABEL as SHARED_LABEL } from "./beta.ts";
import { fixture, jobs, ADMIN, OWNER, PEOPLE, WEEK } from "./testing/lifecycle-fixture.ts";
import { techEvents, techHistory, techLeaderboard, techMe, type TechCtx } from "./tech/service.ts";
import { MemoryCollection } from "./testing/memory-collection.ts";

const [ANN] = PEOPLE;
const TUE_NOON = "2026-11-03T17:00:00.000Z";
const LABEL = "LIVE BETA — TEST WEEK — NO OFFICIAL WINNERS OR PAYOUTS";

const weekJobs = () => [
  ...jobs(6, "Ann", "Closed", 1000), ...jobs(4, "Ann", "Estimate", 0),
  ...jobs(5, "Bo", "Closed", 900), ...jobs(5, "Bo", "Estimate", 0),
  ...jobs(4, "Cy", "Closed", 1000), ...jobs(4, "Cy", "Estimate", 0),
];

/** A week created as LIVE BETA by the owner (or made beta at activation). */
async function betaWeek(how: "create" | "activate" = "create") {
  const f = await fixture();
  f.data.jobs = weekJobs();
  const c = await createCompetition(f.config, WEEK, { template: "standard" }, OWNER, { beta: how === "create" });
  await scheduleCompetition(f.config, c._id, ADMIN);
  await activateCompetition(f.config, c._id, OWNER, { beta: how === "activate" });
  return { ...f, id: c._id };
}
async function betaInReview() {
  const f = await betaWeek();
  f.setNow("2026-11-02T06:00:00Z");
  await freezeCompetition(f.ctx, f.id, ADMIN);
  await openReview(f.ctx, f.id, ADMIN);
  f.setNow(TUE_NOON);
  return f;
}
const audits = (f: { config: { store: { audit: unknown } } }) =>
  (f.config.store.audit as MemoryCollection<{ action: string; target: string; by: string; reason: string | null; after: unknown }>).docs;

test("the label is exact and shared by server and client screens", () => {
  assert.equal(BETA_LABEL, LABEL);
  assert.equal(SHARED_LABEL, LABEL);
  assert.ok(BETA_REFUSAL.startsWith(LABEL));
});

test("beta flag: owner only, at creation or activation; audited; never cleared", async () => {
  const f = await fixture();
  await assert.rejects(createCompetition(f.config, WEEK, { template: "standard" }, ADMIN, { beta: true }), ArenaAuthorizationError);
  const c = await createCompetition(f.config, WEEK, { template: "standard" }, OWNER, { beta: true });
  assert.equal(c.beta, true);
  assert.ok(audits(f).some((a) => a.action === "competition.create" && (a.after as { beta?: boolean }).beta === true));
  assert.ok(audits(f).some((a) => a.action === "competition.beta" && a.by === OWNER && a.reason === LABEL));
  await scheduleCompetition(f.config, c._id, ADMIN);
  await activateCompetition(f.config, c._id, OWNER); // no flag passed: stays beta
  const after = (await f.config.store.competitions.findOne({ _id: c._id }))!;
  assert.equal(after.beta, true);
  assert.equal(after.status, "active");
  assert.ok(audits(f).some((a) => a.action === "competition.activate" && (a.after as { beta?: boolean }).beta === true));

  const g = await betaWeek("activate");
  assert.equal((await g.config.store.competitions.findOne({ _id: g.id }))!.beta, true);
  const betaRows = audits(g).filter((a) => a.action === "competition.beta");
  assert.equal(betaRows.length, 1);
  assert.deepEqual(betaRows[0].after, { beta: true, at: "activate" });

  // An ordinary week has no flag at all (absent = ordinary).
  const h = await fixture();
  const id = await h.startWeek();
  assert.equal("beta" in (await h.config.store.competitions.findOne({ _id: id }))!, false);
});

test("a beta week computes, freezes, reviews and re-checks exactly like a normal one", async () => {
  const f = await betaWeek();
  const c = (await f.config.store.competitions.findOne({ _id: f.id }))!;
  const live = await liveSnapshot(f.ctx, c, await ruleVersionOf(f.ctx, c));
  assert.equal(live!.result.results.find((r) => r.competitorId === ANN.id)!.prizeCents, 45_000, "projected prizes are computed");
  f.setNow("2026-11-02T06:00:00Z");
  await freezeCompetition(f.ctx, f.id, ADMIN);
  await openReview(f.ctx, f.id, ADMIN);
  await reconcileCompetition(f.ctx, f.id, ADMIN);
  const snap = (await reviewSnapshot(f.ctx, f.id))!;
  assert.equal(snap.kind, "reconciled");
  assert.equal((await f.config.store.competitions.findOne({ _id: f.id }))!.status, "in_review");
});

test("approval of a beta week is ALWAYS refused: no result, no approval row, no result_approved event", async () => {
  const f = await betaInReview();
  const snap = (await reviewSnapshot(f.ctx, f.id))!;
  const ev0 = f.lc.events.docs.length;
  await assert.rejects(approveResults(f.ctx, f.id, OWNER, { snapshotId: snap._id }), (e: unknown) =>
    e instanceof ArenaStateError && e.message === BETA_REFUSAL && e.message.includes(LABEL));
  // a second try, with a note, changes nothing either
  await assert.rejects(approveResults(f.ctx, f.id, OWNER, { snapshotId: snap._id, note: "please" }), ArenaStateError);
  assert.equal(f.lc.results.docs.length, 0, "no result record");
  assert.equal(f.lc.approvals.docs.length, 0, "no approval row");
  assert.equal(f.lc.events.docs.length, ev0, "no event of any kind written by the refusal");
  assert.equal(f.lc.events.docs.some((d) => d.event.kind === "result_approved"), false);
  assert.equal((await f.config.store.competitions.findOne({ _id: f.id }))!.status, "in_review");
  const refused = audits(f).filter((a) => a.action === "competition.approve.refused");
  assert.equal(refused.length, 2);
  assert.equal(refused[0].reason, BETA_REFUSAL);
  // non-owners are still refused as non-owners first
  await assert.rejects(approveResults(f.ctx, f.id, ADMIN, { snapshotId: snap._id }), ArenaAuthorizationError);
});

test("the beta refusal comes before every other check (status, window, snapshot)", async () => {
  const f = await betaWeek();
  // still active, wrong snapshot id, before the review window: the answer is the beta refusal
  await assert.rejects(approveResults(f.ctx, f.id, OWNER, { snapshotId: "nope" }), (e: unknown) => e instanceof Error && e.message === BETA_REFUSAL);
  // a beta week can still be cancelled by the owner (it was never approved)
  await cancelCompetition(f.config, f.id, OWNER, "test over");
  assert.equal((await f.config.store.competitions.findOne({ _id: f.id }))!.status, "cancelled");
});

test("control: an ordinary week in the same state is approved normally", async () => {
  const f = await fixture();
  f.data.jobs = weekJobs();
  const id = await f.startWeek();
  f.setNow("2026-11-02T06:00:00Z");
  await freezeCompetition(f.ctx, id, ADMIN);
  await openReview(f.ctx, id, ADMIN);
  f.setNow(TUE_NOON);
  await approveResults(f.ctx, id, OWNER, { snapshotId: (await reviewSnapshot(f.ctx, id))!._id });
  assert.equal(f.lc.results.docs.length, 1);
});

/** Minimal read-only CRM handle (TechNameMapping + Technician) for the technician read models. */
const fakeCrm = () => ({
  collection(name: string) {
    const rows: Record<string, unknown>[] =
      name === "TechNameMapping" ? PEOPLE.map((p) => ({ supabaseUserId: p.id, supabaseFullName: p.name, crmTechNames: [p.crm] }))
      : name === "Technician" ? PEOPLE.map((p) => ({ _id: p.crm, location: p.location })) : [];
    return {
      findOne: async (q: Record<string, unknown>) => rows.find((r) => Object.entries(q).every(([k, v]) => r[k] === v)) ?? null,
      find: () => ({ toArray: async () => rows }),
    };
  },
}) as never;
const techCtx = (f: Awaited<ReturnType<typeof betaWeek>>): TechCtx => ({
  lifecycle: f.ctx,
  review: {
    store: { cases: new MemoryCollection(), events: new MemoryCollection(), audit: new MemoryCollection() },
    ownerUserId: async () => OWNER, verifiedCompetitorIds: async () => new Set(PEOPLE.map((p) => p.id)),
    now: () => f.ctx.config.now(), newId: (p: string) => `${p}_x`,
  } as never,
  crmDb: fakeCrm(),
});

test("technician API: competition.beta / leaderboard beta are true; never an award, a history week or a result_approved", async () => {
  const f = await betaWeek();
  const t = techCtx(f);
  const me = await techMe(t, ANN.id);
  assert.equal(me.competition!.beta, true);
  assert.equal(me.standing!.potentialPrizeCents, 45_000, "projected prize still shown (labelled beta by the app)");
  const board = await techLeaderboard(t, ANN.id, null, null);
  assert.equal(board.beta, true);
  f.setNow("2026-11-02T06:00:00Z");
  await freezeCompetition(f.ctx, f.id, ADMIN);
  await openReview(f.ctx, f.id, ADMIN);
  f.setNow(TUE_NOON);
  await assert.rejects(approveResults(f.ctx, f.id, OWNER, { snapshotId: (await reviewSnapshot(f.ctx, f.id))!._id }));
  const after = await techMe(t, ANN.id);
  assert.equal(after.competition!.phase, "in_review");
  assert.equal(after.competition!.beta, true);
  assert.equal(after.award, null);
  assert.deepEqual((await techHistory(t, ANN.id, null)).weeks, []);
  const fresh = await techEvents(t, ANN.id, null);
  assert.deepEqual(fresh.events, [], "no winner replay");
  assert.equal(f.lc.events.docs.some((d) => d.event.kind === "result_approved"), false);

  const ordinary = await fixture();
  ordinary.data.jobs = weekJobs();
  const oid = await ordinary.startWeek();
  void oid;
  assert.equal((await techMe(techCtx({ ...ordinary, id: oid }), ANN.id)).competition!.beta, false);
});

// ── routes ─────────────────────────────────────────────────────────────────

const API = join(import.meta.dirname, "..", "..", "app", "api", "arena", "admin");
const src = (p: string) => readFileSync(join(API, p), "utf8").replace(/^\s*\/\/.*$/gm, "");

test("route: the approve endpoint maps the beta refusal to 409 with the explanation (real arenaError)", async () => {
  const { arenaError } = await import("../../app/api/arena/admin/_lib.ts");
  const res = arenaError(new ArenaStateError(BETA_REFUSAL));
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: BETA_REFUSAL });
  // The approve route can only reach approval through approveResults (which refuses beta first).
  const approve = src("competitions/[id]/approve/route.ts");
  assert.match(approve, /await approveResults\(ctx\.lifecycle, id, session\.userId,/);
  assert.doesNotMatch(approve, /insertOne|result_approved|lc\.results|lc\.events/);
});

test("routes: create and activate pass the beta flag through to the owner-checked store calls", () => {
  assert.match(src("competitions/route.ts"), /createCompetition\(ctx\.config, weekStart, source, session\.userId, \{ beta: b\.beta === true \}\)/);
  assert.match(src("competitions/[id]/action/route.ts"), /activateCompetition\(ctx\.config, id, by, \{ beta: b\.beta === true \}\)/);
  // the results route tells the console the week is beta
  assert.match(src("competitions/[id]/results/route.ts"), /beta: c\.beta === true/);
});
