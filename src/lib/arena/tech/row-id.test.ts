// Leaderboard privacy (anonymous row ids) and the combined /live read model.
//   - no technician-facing body (me, leaderboard national/eligible, history, events,
//     live with and without a board) carries a UUID other than the caller's own;
//   - row ids are stable within a competition week (across recomputes, the frozen
//     review snapshot and the approved result), different across weeks, and not
//     derivable without the secret;
//   - "this is you" still works (isMe);
//   - /live = the separate bodies, from one lifecycle read, recomputing at most once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { anonymousRowId, rowIdsFor, rowIdSecretFromEnv, ROW_ID_PATTERN } from "./row-id.ts";
import { techEvents, techHistory, techLeaderboard, techLive, techMe, TechBadRequest, type TechCtx } from "./service.ts";
import { ArenaTechConfigError } from "./config.ts";
import { approveResults, freezeCompetition, liveSnapshot, currentCompetition, openReview, reviewSnapshot } from "../lifecycle.ts";
import { MemoryCollection } from "../testing/memory-collection.ts";
import { fixture, jobs, ADMIN, OWNER, PEOPLE } from "../testing/lifecycle-fixture.ts";

const SECRET = "row-id-test-secret-0123456789abcdef";
const [ANN, BO, CY] = PEOPLE;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function fakeCrm() {
  const mappings = PEOPLE.map((p) => ({ supabaseUserId: p.id, supabaseFullName: p.name, crmTechNames: [p.crm] }));
  return {
    collection(name: string) {
      const rows: Record<string, unknown>[] =
        name === "TechNameMapping" ? (mappings as never) : name === "Technician" ? PEOPLE.map((p) => ({ _id: p.crm, location: p.location })) : [];
      return {
        findOne: async (f: Record<string, unknown>) => rows.find((r) => Object.entries(f).every(([k, v]) => r[k] === v)) ?? null,
        find: () => ({ toArray: async () => rows }),
      };
    },
  } as never;
}

async function world() {
  const f = await fixture();
  f.data.jobs = [
    ...jobs(6, "Ann", "Closed", 1000), ...jobs(4, "Ann", "Estimate", 0),
    ...jobs(5, "Bo", "Closed", 900), ...jobs(5, "Bo", "Estimate", 0),
    ...jobs(4, "Cy", "Closed", 1000), ...jobs(4, "Cy", "Estimate", 0),
  ];
  const id = await f.startWeek();
  const ctx: TechCtx = {
    lifecycle: f.ctx,
    review: {
      store: { cases: new MemoryCollection(), events: new MemoryCollection(), audit: new MemoryCollection() },
      ownerUserId: async () => OWNER, verifiedCompetitorIds: async () => new Set(PEOPLE.map((p) => p.id)),
      now: () => f.ctx.config.now(), newId: (p: string) => `${p}_x`,
    } as never,
    crmDb: fakeCrm(),
    rowIdSecret: SECRET,
  };
  return { ...f, id, ctx };
}

/** Every UUID in a body must be the caller's own. */
function assertNoOtherIds(name: string, body: unknown, me: string) {
  const s = JSON.stringify(body);
  const found = [...new Set(s.match(UUID) ?? [])];
  assert.deepEqual(found.filter((x) => x.toLowerCase() !== me.toLowerCase()), [], `${name}: carries another person's account id`);
  for (const p of PEOPLE) if (p.id !== me) assert.ok(!s.includes(p.id), `${name}: carries ${p.name}'s account id`);
}

function assertRows(name: string, rows: { competitorId: string; isMe: boolean }[], me: string, competitionId: string) {
  for (const r of rows) assert.match(r.competitorId, ROW_ID_PATTERN, `${name}: row id shape`);
  assert.equal(new Set(rows.map((r) => r.competitorId)).size, rows.length, `${name}: row ids unique`);
  const mine = rows.filter((r) => r.isMe);
  assert.ok(mine.length <= 1, `${name}: at most one "me" row`);
  if (mine.length) assert.equal(mine[0].competitorId, anonymousRowId(SECRET, competitionId, me), `${name}: my row id`);
}

const ids = (rows: { competitorId: string; displayName: string }[]) => Object.fromEntries(rows.map((r) => [r.displayName, r.competitorId]));

test("row id: shape, determinism, per-competition and per-secret separation", () => {
  const a = anonymousRowId(SECRET, "arena_2026-10-26", ANN.id);
  assert.match(a, ROW_ID_PATTERN);
  assert.doesNotMatch(a, UUID);
  assert.equal(anonymousRowId(SECRET, "arena_2026-10-26", ANN.id), a, "stable");
  assert.notEqual(anonymousRowId(SECRET, "arena_2026-11-02", ANN.id), a, "another week → another id");
  assert.notEqual(anonymousRowId(SECRET, "arena_2026-10-26", BO.id), a, "another person → another id");
  assert.notEqual(anonymousRowId(SECRET + "x", "arena_2026-10-26", ANN.id), a, "another secret → another id");
  const memo = rowIdsFor(SECRET, "arena_2026-10-26");
  assert.equal(memo(ANN.id), a);
  assert.equal(memo(ANN.id), a);
});

test("row id: not derivable without the secret (no unkeyed hash of the id matches; a wrong key matches nobody)", () => {
  const comp = "arena_2026-10-26";
  const target = anonymousRowId(SECRET, comp, BO.id);
  const unkeyed = (v: string) => `r_${createHash("sha256").update(v).digest().subarray(0, 16).toString("base64url")}`;
  for (const p of PEOPLE) {
    for (const guess of [p.id, `${comp}:${p.id}`, `${p.id}:${comp}`]) assert.notEqual(unkeyed(guess), target);
    // An attacker who knows every candidate account id but not the secret cannot link the row.
    const wrongKey = `r_${createHmac("sha256", "guessed-secret-guessed-secret-0000").update(`${comp}:${p.id}`).digest().subarray(0, 16).toString("base64url")}`;
    assert.notEqual(wrongKey, target);
  }
});

test("row id secret: missing or short fails closed (config error)", () => {
  assert.throws(() => rowIdSecretFromEnv({} as NodeJS.ProcessEnv), ArenaTechConfigError);
  assert.throws(() => rowIdSecretFromEnv({ ARENA_ROW_ID_SECRET: "short" } as NodeJS.ProcessEnv), ArenaTechConfigError);
  assert.equal(rowIdSecretFromEnv({ ARENA_ROW_ID_SECRET: ` ${SECRET} ` } as NodeJS.ProcessEnv), SECRET);
});

test("privacy: no technician-facing body carries another person's account id (live, review, approved, history, events, /live)", async () => {
  const w = await world();
  const scan = async (label: string) => {
    for (const p of PEOPLE) {
      const me = await techMe(w.ctx, p.id);
      assertNoOtherIds(`${label} me(${p.crm})`, me, p.id);
      for (const v of ["national", "eligible"] as const) {
        const lb = await techLeaderboard(w.ctx, p.id, v, null);
        assertNoOtherIds(`${label} leaderboard ${v} (${p.crm})`, lb, p.id);
        assertRows(`${label} leaderboard ${v} (${p.crm})`, lb.rows, p.id, w.id);
        const live = await techLive(w.ctx, p.id, v, null);
        assertNoOtherIds(`${label} live ${v} (${p.crm})`, live, p.id);
        assertRows(`${label} live ${v} (${p.crm})`, live.leaderboard!.rows, p.id, w.id);
      }
      const bare = await techLive(w.ctx, p.id, null, null);
      assert.equal(bare.leaderboard, null, "no board unless asked");
      assertNoOtherIds(`${label} live (no board)`, bare, p.id);
      const ev = await techEvents(w.ctx, p.id, null);
      assertNoOtherIds(`${label} events(${p.crm})`, ev, p.id);
      assertNoOtherIds(`${label} events since`, await techEvents(w.ctx, p.id, ev.cursor), p.id);
      assertNoOtherIds(`${label} history(${p.crm})`, await techHistory(w.ctx, p.id, null), p.id);
    }
  };
  await scan("live");
  const before = ids((await techLeaderboard(w.ctx, BO.id, "national", null)).rows);
  // a later recompute (cached snapshot replaced) keeps every id
  w.data.jobs.push(...jobs(3, "Cy", "Closed", 2000));
  w.setNow("2026-10-28T15:10:00Z");
  const lb2 = await techLeaderboard(w.ctx, BO.id, "national", null);
  assert.ok(w.data.computeCalls >= 2, "a recompute happened");
  assert.deepEqual(ids(lb2.rows), before, "stable across recomputes");
  // frozen → review snapshot
  w.setNow("2026-11-02T06:00:00Z");
  await freezeCompetition(w.ctx.lifecycle, w.id, ADMIN);
  await openReview(w.ctx.lifecycle, w.id, ADMIN);
  await scan("review");
  assert.deepEqual(ids((await techLeaderboard(w.ctx, BO.id, "national", null)).rows), before, "stable into the review snapshot");
  // approved result
  w.setNow("2026-11-03T17:00:00Z");
  await approveResults(w.ctx.lifecycle, w.id, OWNER, { snapshotId: (await reviewSnapshot(w.ctx.lifecycle, w.id))!._id });
  await scan("approved");
  assert.deepEqual(ids((await techLeaderboard(w.ctx, BO.id, "national", null)).rows), before, "stable into the approved result");
});

test("row ids differ across weeks (unlinkable); a past week's board keeps that week's ids; highlighting works", async () => {
  const w = await world();
  const wk1 = ids((await techLeaderboard(w.ctx, ANN.id, "national", null)).rows);
  w.setNow("2026-11-02T06:00:00Z");
  await freezeCompetition(w.ctx.lifecycle, w.id, ADMIN);
  await openReview(w.ctx.lifecycle, w.id, ADMIN);
  w.setNow("2026-11-03T17:00:00Z");
  await approveResults(w.ctx.lifecycle, w.id, OWNER, { snapshotId: (await reviewSnapshot(w.ctx.lifecycle, w.id))!._id });
  w.data.jobs = [...jobs(6, "Ann", "Closed", 1000, "2026-11-03"), ...jobs(5, "Bo", "Closed", 900, "2026-11-03"), ...jobs(4, "Cy", "Closed", 1000, "2026-11-03")];
  const id2 = await w.startWeek("2026-11-02");
  const cur = (await currentCompetition(w.ctx.lifecycle))!;
  assert.equal(cur.c._id, id2);
  await liveSnapshot(w.ctx.lifecycle, cur.c, cur.rv);
  const lb2 = await techLeaderboard(w.ctx, ANN.id, "national", null);
  const wk2 = ids(lb2.rows);
  assert.deepEqual(Object.keys(wk2).sort(), Object.keys(wk1).sort());
  for (const name of Object.keys(wk1)) assert.notEqual(wk2[name], wk1[name], `${name}: a different id in another week`);
  assert.equal(new Set([...Object.values(wk1), ...Object.values(wk2)]).size, 6, "no id shared between the weeks");
  const past = await techLeaderboard(w.ctx, ANN.id, "national", "2026-10-26");
  assert.deepEqual(ids(past.rows), wk1, "the week-1 board (week=) keeps week-1 ids");
  for (const p of PEOPLE) {
    const rows = (await techLeaderboard(w.ctx, p.id, "national", null)).rows;
    assert.deepEqual(rows.filter((r) => r.isMe).map((r) => r.displayName), [rows.find((r) => r.competitorId === anonymousRowId(SECRET, id2, p.id))!.displayName]);
    assertRows(`wk2 ${p.crm}`, rows, p.id, id2);
  }
});

test("/live: the same bodies as /me + /events (+ /leaderboard), one lifecycle read, at most one recompute", async () => {
  const w = await world();
  const ev0 = await techEvents(w.ctx, ANN.id, null);
  const calls0 = w.data.computeCalls;
  const live = await techLive(w.ctx, ANN.id, "eligible", ev0.cursor);
  assert.equal(w.data.computeCalls, calls0, "fresh snapshot: no recompute");
  const { serverTime: _a, ...me } = await techMe(w.ctx, ANN.id);
  const { serverTime: _b, ...liveMe } = live.me;
  assert.deepEqual(liveMe, me);
  assert.deepEqual(live.leaderboard, await techLeaderboard(w.ctx, ANN.id, "eligible", null));
  assert.deepEqual(live.events, await techEvents(w.ctx, ANN.id, ev0.cursor));
  assert.deepEqual(Object.keys(live).sort(), ["apiVersion", "events", "leaderboard", "me"]);
  // stale snapshot: exactly one recompute for the combined request
  w.setNow("2026-10-28T15:10:00Z");
  const calls1 = w.data.computeCalls;
  const l2 = await techLive(w.ctx, ANN.id, "national", ev0.cursor);
  assert.equal(w.data.computeCalls, calls1 + 1, "one recompute for me + events + leaderboard together");
  assert.equal(l2.me.competition!.dataAsOf, l2.leaderboard!.dataAsOf, "me and the board describe the same snapshot");
  // first poll: no cursor → current position only
  const first = await techLive(w.ctx, BO.id, null, null);
  assert.match(first.events.cursor, /^c1\./);
  assert.deepEqual(first.events.events, []);
  await assert.rejects(techLive(w.ctx, ANN.id, "everyone", null), TechBadRequest);
  await assert.rejects(techLive(w.ctx, ANN.id, null, "c1.!!"), TechBadRequest);
  await assert.rejects(techLive(w.ctx, ANN.id, null, "not-a-cursor"), TechBadRequest);
});

test("/live with no competition: me says so, no board, events still answer", async () => {
  const f = await fixture();
  const ctx: TechCtx = { lifecycle: f.ctx, review: { store: { cases: new MemoryCollection() } } as never, crmDb: fakeCrm(), rowIdSecret: SECRET };
  const r = await techLive(ctx, ANN.id, "national", null);
  assert.equal(r.me.competition, null);
  assert.equal(r.leaderboard, null);
  assert.deepEqual(r.events.events, []);
  assert.equal(CY.id.length, 36);
});
