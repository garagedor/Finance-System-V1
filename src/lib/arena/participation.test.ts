// Manage Technicians: the owner-controlled participation list.
// Engine / competitor map, review detection, live snapshot invalidation,
// authorization, audit, re-inclusion, technician views, frozen / in-review /
// approved weeks, Most Improved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCompetition } from "./engine.ts";
import { buildCompetitorMap } from "./identity.ts";
import { SEED_STANDARD_WEEK, cloneRules, rulesHash } from "./config.ts";
import { buildSource, computeFromSource, deserializeCompetitorMap, resultHash, serializeCompetitorMap } from "./source-snapshot.ts";
import { detectCases } from "./detect.ts";
import type { ArenaJob } from "./types.ts";
import {
  approveResults, freezeCompetition, getCompetitionDoc, liveSnapshot, openReview, participationBlockers, reconcileCompetition,
  reviewDiff, reviewSnapshot, ruleVersionOf,
} from "./lifecycle.ts";
import { excludedCompetitorIds, participationRoster, setParticipation } from "./participation.ts";
import { ArenaAuthorizationError } from "./config-store.ts";
import { ArenaConfigError } from "./config.ts";
import { MemoryCollection } from "./testing/memory-collection.ts";
import { fixture, jobs, ADMIN, OWNER, PEOPLE } from "./testing/lifecycle-fixture.ts";
import { techLeaderboard, techLive, techMe, findCompetitor, type TechCtx } from "./tech/service.ts";

const [ANN, BO, CY] = PEOPLE;
const WEEK = "2026-11-02";
let seq = 0;
const job = (tech: string, status: string, profit: number, date = WEEK, dupKeys: string[] = []): ArenaJob => ({
  id: `p${String(++seq).padStart(6, "0")}`, tech, date, status, location: "Milwaukee", profit, dupKeys,
});
const many = (n: number, tech: string, status: string, profit: number, date = WEEK) => Array.from({ length: n }, () => job(tech, status, profit, date));
const mappingsOf = (...names: string[]) => names.map((n) => ({ supabaseUserId: `u_${n}`, supabaseFullName: n, crmTechNames: [n] }));
const techsOf = (...names: string[]) => names.map((n) => ({ _id: n, location: "Milwaukee" }));
function mapFor(names: string[], inUse: string[], notParticipating?: string[]) {
  return buildCompetitorMap({ mappings: mappingsOf(...names), technicians: techsOf(...names), crmNamesInUse: inUse, notParticipating });
}
function run(jobsIn: ArenaJob[], names: string[], notParticipating?: string[], rules = cloneRules(SEED_STANDARD_WEEK)) {
  const competitors = mapFor(names, [...new Set(jobsIn.map((j) => j.tech))], notParticipating);
  return computeCompetition({ rules, rulesHash: rulesHash(rules), weekStart: WEEK, competitors, jobs: jobsIn, accounts: {} });
}

// ── engine / competitor map ────────────────────────────────────────────────

test("an excluded person is not a competitor, but their CRM name stays attributed (no unmapped issue)", () => {
  const m = mapFor(["Ann", "Bo"], ["Ann", "Bo"], ["u_Ann"]);
  assert.deepEqual(m.competitors.map((c) => c.id), ["u_Bo"]);
  assert.equal(m.byCrmName.get("Ann"), "u_Ann");
  assert.deepEqual(m.issues, []);
  assert.deepEqual(m.notParticipating, ["u_Ann"]);
});

test("excluded: no result, no rank, no prize; their jobs are not unattributed; the others re-rank", () => {
  const all = [...many(10, "Ann", "Closed", 2000), ...many(10, "Bo", "Closed", 900), job("Zed", "Closed", 100)];
  const before = run(all, ["Ann", "Bo"]);
  assert.equal(before.results.find((r) => r.competitorId === "u_Ann")!.prizePosition, 1);
  const after = run(all, ["Ann", "Bo"], ["u_Ann"]);
  assert.deepEqual(after.results.map((r) => [r.competitorId, r.rank, r.prizePosition]), [["u_Bo", 1, 1]]);
  assert.deepEqual(after.unattributed, [{ crmName: "Zed", jobs: 1 }], "only the truly unmapped name is unattributed");
  assert.deepEqual(after.notParticipating, [{ competitorId: "u_Ann", jobs: 10 }]);
  // the other competitor's KPIs are exactly what they were
  const bo0 = before.results.find((r) => r.competitorId === "u_Bo")!, bo1 = after.results[0];
  assert.deepEqual([bo1.assignedJobs, bo1.closingRate, bo1.avgTicket, bo1.score], [bo0.assignedJobs, bo0.closingRate, bo0.avgTicket, bo0.score]);
});

test("nobody excluded (or an unknown id): map and result are unchanged bit for bit", () => {
  const all = [...many(10, "Ann", "Closed", 2000), ...many(10, "Bo", "Closed", 900)];
  const plainRun = run(all, ["Ann", "Bo"]);
  for (const np of [[], ["u_nobody"]]) {
    const r = run(all, ["Ann", "Bo"], np);
    assert.equal(resultHash(r), resultHash(plainRun));
    assert.equal("notParticipating" in r, false);
    assert.equal("notParticipating" in mapFor(["Ann", "Bo"], ["Ann", "Bo"], np), false);
  }
  const s = serializeCompetitorMap(mapFor(["Ann"], ["Ann"]));
  assert.equal("notParticipating" in s, false, "older source snapshots keep their hash");
});

test("the exclusion travels in the source snapshot: recomputing from it reproduces the result", () => {
  const all = [...many(10, "Ann", "Closed", 2000), ...many(10, "Bo", "Closed", 900)];
  const competitors = mapFor(["Ann", "Bo"], ["Ann", "Bo"], ["u_Ann"]);
  const rules = cloneRules(SEED_STANDARD_WEEK);
  const r = computeCompetition({ rules, rulesHash: rulesHash(rules), weekStart: WEEK, competitors, jobs: all, accounts: {} });
  assert.deepEqual(deserializeCompetitorMap(serializeCompetitorMap(competitors)).notParticipating, ["u_Ann"]);
  const src = buildSource({
    readAt: "2026-11-05T00:00:00Z", identity: { system: "crm", database: "t", collection: "Job", user: null, via: "test" },
    window: { from: WEEK, toExclusive: "2026-11-09" }, jobs: all, competitors, accounts: {},
  });
  assert.equal(resultHash(computeFromSource(src, rules, rulesHash(rules), WEEK)), resultHash(r));
});

test("Most Improved never goes to an excluded person; it passes to the next improver", () => {
  const rules = cloneRules(SEED_STANDARD_WEEK);
  rules.prizes.positionsCents = [];
  rules.prizes.budgetCents = 25_000;
  const prev = ["2026-10-26", "2026-10-19", "2026-10-12", "2026-10-05"];
  const all = [
    ...prev.flatMap((d) => [...many(5, "Ron", "Estimate", 0, d), job("Ron", "Closed", 50, d)]),
    ...prev.flatMap((d) => [...many(4, "Sue", "Estimate", 0, d), ...many(2, "Sue", "Closed", 300, d)]),
    ...many(5, "Ron", "Closed", 900), ...many(5, "Ron", "Estimate", 0),
    ...many(5, "Sue", "Closed", 900), ...many(5, "Sue", "Estimate", 0),
  ];
  assert.equal(run(all, ["Ron", "Sue"], [], rules).mostImprovedWinner, "u_Ron");
  const r = run(all, ["Ron", "Sue"], ["u_Ron"], rules);
  assert.equal(r.mostImprovedWinner, "u_Sue");
  assert.equal(r.results.some((x) => x.competitorId === "u_Ron"), false);
});

test("review detection: an excluded person's jobs raise no identity, duplicate or display-name case", () => {
  const dup = ["phone:aaaa"];
  const weekJobs = [
    job("Ann", "Closed", 500, WEEK, dup), job("Ann", "Closed", 500, WEEK, dup), ...many(3, "Ann", "Closed", 500),
    job("Zed", "Closed", 100),
  ];
  const base = {
    weeks: [{ weekStart: WEEK, jobs: weekJobs }],
    mappings: [{ supabaseUserId: "u_Ann", supabaseFullName: "אן", crmTechNames: ["Ann"] }],
    technicians: techsOf("Ann", "Zed"), rules: cloneRules(SEED_STANDARD_WEEK), overrides: [], displayNames: {}, exclusions: [],
  };
  const kinds = (cs: ReturnType<typeof detectCases>) => cs.map((c) => `${c.kind}:${c.kind === "duplicate_group" ? "dup" : c.key}`).sort();
  assert.deepEqual(kinds(detectCases(base)), ["display_name:u_Ann", "duplicate_group:dup", "identity_name:Zed"]);
  assert.deepEqual(kinds(detectCases({ ...base, notParticipating: ["u_Ann"] })), ["identity_name:Zed"], "only the truly unmapped name");
});

// ── store: authorization, audit, re-inclusion ──────────────────────────────

test("only the owner can change participation; a reason is required; unmapped ids are refused", async () => {
  const f = await fixture();
  const coll = f.participation;
  const person = { crmNames: ["Ann"] };
  await assert.rejects(setParticipation(f.ctx, coll, { competitorId: ANN.id, status: "excluded", reason: "x", by: ADMIN, person }), ArenaAuthorizationError);
  await assert.rejects(setParticipation(f.ctx, coll, { competitorId: ANN.id, status: "excluded", reason: "  ", by: OWNER, person }), ArenaConfigError);
  await assert.rejects(setParticipation(f.ctx, coll, { competitorId: ANN.id, status: "excluded", reason: "left", by: OWNER, person: null }), /not a verified technician/);
  await assert.rejects(setParticipation(f.ctx, coll, { competitorId: "Ann Able", status: "excluded", reason: "left", by: OWNER, person }), ArenaConfigError);
  assert.equal(coll.docs.length, 0);
  assert.equal((await f.config.store.audit.find({}).sort({ at: 1 }).toArray()).filter((a) => a.action.startsWith("participation")).length, 0);
});

test("exclude → audit (who, when, why, before → after); idempotent; re-include → audit; CRM names are information only", async () => {
  const f = await fixture();
  const coll = f.participation;
  const ex = await setParticipation(f.ctx, coll, { competitorId: ANN.id, status: "excluded", reason: "left the company", by: OWNER, person: { crmNames: ["Ann"] } });
  assert.equal(ex.changed, true);
  assert.deepEqual(await excludedCompetitorIds(coll), [ANN.id]);
  const again = await setParticipation(f.ctx, coll, { competitorId: ANN.id, status: "excluded", reason: "again", by: OWNER, person: { crmNames: ["Ann"] } });
  assert.equal(again.changed, false);
  f.setNow("2026-10-28T16:00:00Z");
  const back = await setParticipation(f.ctx, coll, { competitorId: ANN.id, status: "included", reason: "came back", by: OWNER, person: { crmNames: ["Ann"] } });
  assert.equal(back.changed, true);
  assert.deepEqual(await excludedCompetitorIds(coll), []);
  const audit = (await f.config.store.audit.find({}).sort({ at: 1 }).toArray()).filter((a) => a.action.startsWith("participation"));
  assert.deepEqual(audit.map((a) => [a.action, a.target, a.by, a.reason]), [
    ["participation.exclude", `participation:${ANN.id}`, OWNER, "left the company"],
    ["participation.include", `participation:${ANN.id}`, OWNER, "came back"],
  ]);
  assert.deepEqual(audit[0].before, { status: "included", default: true });
  assert.deepEqual(audit[0].after, { status: "excluded", crmNames: ["Ann"] });
  assert.deepEqual(audit[1].before, { status: "excluded", reason: "left the company", by: OWNER, at: "2026-10-28T15:00:00.000Z" });
  assert.deepEqual(audit[1].after, { status: "included", crmNames: ["Ann"] });
  assert.equal(audit[1].at, "2026-10-28T16:00:00.000Z");
});

// ── live snapshot invalidation + technician views ──────────────────────────

function fakeCrm() {
  const mappings = PEOPLE.map((p) => ({ supabaseUserId: p.id, supabaseFullName: p.name, crmTechNames: [p.crm] }));
  return {
    collection(name: string) {
      const rows: Record<string, unknown>[] =
        name === "TechNameMapping" ? (mappings as never) : name === "Technician" ? PEOPLE.map((p) => ({ _id: p.crm, location: p.location })) : [];
      return {
        findOne: async (q: Record<string, unknown>) => rows.find((r) => Object.entries(q).every(([k, v]) => r[k] === v)) ?? null,
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
  const review = {
    store: { cases: new MemoryCollection(), events: new MemoryCollection(), audit: new MemoryCollection() },
    ownerUserId: async () => OWNER, verifiedCompetitorIds: async () => new Set(PEOPLE.map((p) => p.id)),
    now: () => f.ctx.config.now(), newId: (p: string) => `${p}_x`,
  };
  const tech: TechCtx = { lifecycle: f.ctx, review: review as never, crmDb: fakeCrm(), rowIdSecret: "participation-test-row-secret-0123456789" };
  const set = (who: { id: string; crm: string }, status: "excluded" | "included", reason = "owner decision") =>
    setParticipation(f.ctx, f.participation, { competitorId: who.id, status, reason, by: OWNER, person: { crmNames: [who.crm] } });
  const live = async () => {
    const c = await getCompetitionDoc(f.ctx, id);
    return liveSnapshot(f.ctx, c, await ruleVersionOf(f.ctx, c));
  };
  return { ...f, id, tech, set, live };
}

test("a participation change invalidates the cached live snapshot: the next read recomputes, even within the refresh interval", async () => {
  const w = await world();
  const s1 = await w.live();
  assert.ok(s1!.result.results.some((r) => r.competitorId === ANN.id));
  const calls = w.data.computeCalls;
  await w.live();
  assert.equal(w.data.computeCalls, calls, "cached within the refresh interval");
  const out = await w.set(ANN, "excluded");
  assert.match(out.effects.map((e) => e.effect).join(), /Live standings recompute now/);
  const s2 = await w.live();
  assert.equal(w.data.computeCalls, calls + 1, "recomputed at once");
  assert.equal(s2!.result.results.some((r) => r.competitorId === ANN.id), false);
  assert.deepEqual(s2!.result.results.map((r) => r.rank), [1, 2], "the others re-rank without a gap");
  await w.live();
  assert.equal(w.data.computeCalls, calls + 1, "and cached again afterwards (no recompute loop)");
  // re-include: back on the next read
  await w.set(ANN, "included");
  const s3 = await w.live();
  assert.equal(w.data.computeCalls, calls + 2);
  assert.equal(s3!.result.results.find((r) => r.competitorId === ANN.id)!.rank, 1);
});

test("technician API: an excluded technician is absent from leaderboard / live and sees 'not participating' on me; access is unchanged", async () => {
  const w = await world();
  await w.live();
  await w.set(ANN, "excluded");
  const board = await techLeaderboard(w.tech, BO.id, "national", null);
  assert.equal(board.participantCount, 2);
  assert.equal(board.rows.some((r) => r.displayName.startsWith("Ann")), false);
  const me = await techMe(w.tech, ANN.id);
  assert.equal(me.standing, null, "the existing 'not participating' state");
  assert.equal(me.competition?.phase, "live");
  const live = await techLive(w.tech, ANN.id, "national", null);
  assert.equal(live.me.standing, null);
  assert.equal(live.leaderboard!.rows.some((r) => r.isMe), false);
  assert.equal((await techMe(w.tech, BO.id)).standing!.rank, 2, "others keep a standing (Cy #1, Bo #2)");
  assert.equal((await findCompetitor(w.tech, ANN.id)).ok, true, "exclusion is not access: the pass and allowlist decide that");
  // re-included: standing again
  await w.set(ANN, "included");
  assert.equal((await techMe(w.tech, ANN.id)).standing!.rank, 1);
});

// ── frozen / in review / approved ──────────────────────────────────────────

const AFTER_CLOSE = "2026-11-02T06:00:00Z";
const APPROVAL_OPEN = "2026-11-03T18:00:00Z";

test("in review: the snapshot is never changed silently; approval is refused until a re-check applies the current list", async () => {
  const w = await world();
  w.setNow(AFTER_CLOSE);
  const prov = await freezeCompetition(w.ctx, w.id, "system");
  const r1 = await openReview(w.ctx, w.id, ADMIN);
  assert.ok(r1.result.results.some((r) => r.competitorId === ANN.id));
  const out = await w.set(ANN, "excluded");
  assert.match(out.effects.find((e) => e.competitionId === w.id)!.effect, /Approval is refused until the owner re-checks/);
  assert.equal((await reviewSnapshot(w.ctx, w.id))!._id, r1._id, "no new snapshot was written by the change");
  w.setNow(APPROVAL_OPEN);
  await assert.rejects(approveResults(w.ctx, w.id, OWNER, { snapshotId: r1._id }), /excluded from the Arena after this snapshot.*re-check CRM data/);
  const r2 = await reconcileCompetition(w.ctx, w.id, OWNER);
  assert.equal(r2.result.results.some((r) => r.competitorId === ANN.id), false);
  assert.deepEqual(r2.result.notParticipating, [{ competitorId: ANN.id, jobs: 10 }]);
  assert.equal(r2.reproducible, true);
  assert.deepEqual(reviewDiff(prov.result, r2.result).find((d) => d.competitorId === ANN.id)!.after, null, "the review diff shows it");
  const approved = await approveResults(w.ctx, w.id, OWNER, { snapshotId: r2._id });
  assert.equal(approved.standings.some((s) => s.competitorId === ANN.id), false);
  // the frozen snapshot itself was never touched
  assert.ok((await w.lc.snapshots.findOne({ _id: prov._id }))!.result.results.some((r) => r.competitorId === ANN.id));
});

test("re-included during review: approval is refused until the re-check brings them back", async () => {
  const w = await world();
  await w.set(ANN, "excluded");
  w.setNow(AFTER_CLOSE);
  const prov = await freezeCompetition(w.ctx, w.id, "system");
  assert.equal(prov.result.results.some((r) => r.competitorId === ANN.id), false);
  const r1 = await openReview(w.ctx, w.id, ADMIN);
  await w.set(ANN, "included");
  assert.equal(participationBlockers(r1.result, []).length, 1);
  w.setNow(APPROVAL_OPEN);
  await assert.rejects(approveResults(w.ctx, w.id, OWNER, { snapshotId: r1._id }), /re-included/);
  const r2 = await reconcileCompetition(w.ctx, w.id, OWNER);
  assert.equal(r2.result.results.find((r) => r.competitorId === ANN.id)!.rank, 1);
  await approveResults(w.ctx, w.id, OWNER, { snapshotId: r2._id });
});

test("an exclusion that does not touch the week (no jobs there) does not block approval", async () => {
  const w = await world();
  w.data.jobs = w.data.jobs.filter((j) => j.tech !== "Cy");
  w.setNow(AFTER_CLOSE);
  await freezeCompetition(w.ctx, w.id, "system");
  const r1 = await openReview(w.ctx, w.id, ADMIN);
  const out = await w.set(CY, "excluded");
  assert.match(out.effects.find((e) => e.competitionId === w.id)!.effect, /no effect/);
  w.setNow(APPROVAL_OPEN);
  await approveResults(w.ctx, w.id, OWNER, { snapshotId: r1._id });
});

test("approved results are never rewritten by a later exclusion", async () => {
  const w = await world();
  w.setNow(AFTER_CLOSE);
  await freezeCompetition(w.ctx, w.id, "system");
  const r1 = await openReview(w.ctx, w.id, ADMIN);
  w.setNow(APPROVAL_OPEN);
  const doc = await approveResults(w.ctx, w.id, OWNER, { snapshotId: r1._id });
  const snapsBefore = structuredClone(w.lc.snapshots.docs);
  const out = await w.set(ANN, "excluded");
  assert.equal(out.effects.some((e) => e.competitionId === w.id), false, "approved weeks are not even candidates");
  assert.deepEqual(await w.lc.results.findOne({ _id: w.id }), doc);
  assert.deepEqual(w.lc.snapshots.docs, snapsBefore);
  const board = await techLeaderboard(w.tech, BO.id, "national", WEEK.replace("11-02", "10-26"));
  assert.equal(board.phase, "approved");
  assert.equal(board.participantCount, 3, "the approved week still shows everyone it was approved with");
});

test("provisional (frozen): the frozen snapshot is unchanged; opening the review applies the current list", async () => {
  const w = await world();
  w.setNow(AFTER_CLOSE);
  const prov = await freezeCompetition(w.ctx, w.id, "system");
  const out = await w.set(ANN, "excluded");
  assert.match(out.effects.find((e) => e.competitionId === w.id)!.effect, /frozen snapshot is not changed/);
  assert.deepEqual(await w.lc.snapshots.findOne({ _id: prov._id }), prov);
  // until the review re-check, technicians see the stored snapshot (consistently, me and board)
  assert.equal((await techMe(w.tech, ANN.id)).standing!.rank, 1);
  const r1 = await openReview(w.ctx, w.id, ADMIN);
  assert.equal(r1.result.results.some((r) => r.competitorId === ANN.id), false);
  assert.equal((await techMe(w.tech, ANN.id)).standing, null);
});

// ── the Manage Technicians list ────────────────────────────────────────────

test("the list: stable ids, locations, unmapped CRM technicians flagged, ambiguous names flagged, decided names labelled", () => {
  const rows = participationRoster({
    mappings: [
      { supabaseUserId: "u1", supabaseFullName: "Ann Able", crmTechNames: ["Ann", "Shared"] },
      { supabaseUserId: "u2", supabaseFullName: "Bo Baker", crmTechNames: ["Bo", "Shared"] },
      { supabaseUserId: "u3", supabaseFullName: "Cy Cole", crmTechNames: [] },
    ],
    technicians: [
      { _id: "Ann", location: "Columbus" }, { _id: "Bo", location: "Chicago" }, { _id: "Shared", location: "Chicago" },
      { _id: "ann", location: "Columbus" }, { _id: "Pool", location: "Miami" }, { _id: "Sub", location: "Tampa" },
    ],
    docs: [
      { _id: "u2", status: "excluded", reason: "left", by: OWNER, at: "2026-11-01T00:00:00Z", crmNames: ["Bo"] },
      { _id: "gone", status: "excluded", reason: "old", by: OWNER, at: "2026-10-01T00:00:00Z", crmNames: ["Old"] },
    ],
    overrides: [{ crmName: "Sub", competitorId: null }],
    publicNames: new Map([["u1", { displayName: "Ann A." }], ["u2", { displayName: "Bo B." }]]),
    accounts: [{ _id: "u1", state: "eligible", checkedAt: "2026-11-01T00:00:00Z" }],
    access: [{ _id: "u1", allowed: true }],
  });
  const by = (k: string) => rows.find((r) => r.key === k)!;
  assert.deepEqual([by("u1").competitorId, by("u1").crmTechnicianIds, by("u1").locations, by("u1").status], ["u1", ["Ann", "Shared"], ["Chicago", "Columbus"], "included"]);
  assert.equal(by("u1").reviewNeeded, true, "Shared is listed for two people");
  assert.equal(by("u1").appAccess, true);
  assert.equal(by("u2").status, "excluded");
  assert.equal(by("u3").reviewNeeded, true, "no CRM name mapped");
  assert.equal(by("gone").canChange, true, "a decision whose mapping is gone can still be re-included");
  assert.equal(by("crm:Pool").status, "not_mapped");
  assert.equal(by("crm:Pool").canChange, false, "no stable competitor id: never excluded by name");
  assert.match(by("crm:ann").flags.join(), /Spelling matches a CRM name of Ann Able/);
  assert.match(by("crm:Sub").flags.join(), /not a competitor/);
  assert.equal(rows[0].status, "excluded", "excluded first");
});

// ── authorization structure ─────────────────────────────────────────────────

test("the admin route: view permission to read, rules:edit + owner (in the store) to change; no technician route; session-gated", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = join(import.meta.dirname, "..", "..", "..");
  const src = readFileSync(join(root, "src", "app", "api", "arena", "admin", "participation", "route.ts"), "utf8");
  assert.match(src, /export async function GET\(\) \{\s*return arenaRoute\("arena:console:view"/);
  assert.match(src, /export async function POST\(req: Request\) \{\s*return arenaRoute\("arena:rules:edit"/);
  assert.match(src, /by: session\.userId/);
  for (const dir of ["tech", "auth"]) {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    for (const f of walk(join(root, "src", "app", "api", "arena", dir)))
      assert.doesNotMatch(readFileSync(f, "utf8"), /participation/, `${f} must not touch participation`);
  }
  const { NextRequest } = await import("next/server");
  const { middleware } = await import("../../middleware.ts");
  for (const method of ["GET", "POST"]) {
    const res = await middleware(new NextRequest(new URL("https://app.test/api/arena/admin/participation"), {
      method, headers: { authorization: "Bearer a.b.c" },
    }));
    assert.equal(res.status, 401, `${method} with only an Arena pass is refused (no CRM session)`);
  }
});
