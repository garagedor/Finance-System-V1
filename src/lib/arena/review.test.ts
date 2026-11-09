import { test } from "node:test";
import assert from "node:assert/strict";
import {
  caseHistory, confirmCase, isEnglishDisplayName, readiness, rejectCase, reopenCase, resolveCase, reviewDecisions, syncDetected,
  type DetectedCase, type ReviewContext, type ReviewStore,
} from "./review.ts";
import { ArenaAuthorizationError, ArenaStateError } from "./config-store.ts";
import { ArenaConfigError } from "./config.ts";
import { MemoryCollection } from "./testing/memory-collection.ts";

const OWNER = "owner-1";
const ADMIN = "admin-2";

function setup() {
  let n = 0;
  const store = { cases: new MemoryCollection(), events: new MemoryCollection(), audit: new MemoryCollection() };
  const ctx: ReviewContext = {
    store: store as unknown as ReviewStore,
    ownerUserId: async () => OWNER,
    verifiedCompetitorIds: async () => new Set(["u_dana", "u_yuval"]),
    now: () => new Date("2026-10-29T15:00:00Z"),
    newId: (p) => `${p}_${++n}`,
  };
  return { ctx, store };
}

const dup = (mayAffectPrizes: boolean, ids = ["j1", "j2"]): DetectedCase => ({
  kind: "duplicate_group",
  key: ids.join(","),
  weeks: ["2026-09-07"],
  data: {
    weekStart: "2026-09-07", date: "2026-09-08", competitorId: "u_dana", competitorName: "Dana",
    jobs: ids.map((id) => ({ id, tech: "Dana", status: "Closed", profit: 300 })), likely: true, mayAffectPrizes,
  },
});
const name = (crmName: string): DetectedCase => ({
  kind: "identity_name", key: crmName, weeks: ["2026-09-07"],
  data: { issue: "unmapped_name", crmName, candidates: [], jobs: 4, locations: ["Chicago"], suggestedCategory: null },
});
const display = (id: string, current: string): DetectedCase => ({
  kind: "display_name", key: id, weeks: ["2026-09-07"], data: { competitorId: id, currentName: current, crmNames: ["דנה"] },
});

test("detection is idempotent: a rescan refreshes a case, never duplicates or reopens it", async () => {
  const { ctx, store } = setup();
  assert.deepEqual(await syncDetected(ctx, [dup(false), name("TZVI")], ADMIN), { added: 2, refreshed: 0 });
  await resolveCase(ctx, "identity_name:TZVI", { kind: "identity_not_competitor", category: "subcontractor" }, ADMIN, "Subcontractor crew");
  const again = { ...name("TZVI"), weeks: ["2026-09-14"] };
  assert.deepEqual(await syncDetected(ctx, [dup(false), again], ADMIN), { added: 0, refreshed: 2 });
  const c = store.cases.docs.find((d: { _id: string }) => d._id === "identity_name:TZVI") as { status: string; weeks: string[] };
  assert.equal(c.status, "resolved");
  assert.deepEqual(c.weeks, ["2026-09-07", "2026-09-14"]);
  assert.equal(store.cases.docs.length, 2);
});

test("every decision needs a reason and is recorded in history and the audit log", async () => {
  const { ctx, store } = setup();
  await syncDetected(ctx, [name("Plenty")], ADMIN);
  await assert.rejects(resolveCase(ctx, "identity_name:Plenty", { kind: "identity_not_competitor", category: "location_pool" }, ADMIN, "  "), ArenaConfigError);
  await resolveCase(ctx, "identity_name:Plenty", { kind: "identity_not_competitor", category: "location_pool" }, ADMIN, "Plenty is a location pool");
  const h = await caseHistory(ctx, "identity_name:Plenty");
  assert.deepEqual(h.map((e) => e.action), ["detected", "resolved"]);
  assert.equal(h[1].by, ADMIN);
  assert.equal(h[1].reason, "Plenty is a location pool");
  assert.ok(store.audit.docs.some((a: { action: string; target: string }) => a.action === "review.resolved" && a.target === "identity_name:Plenty"));
});

test("identity: attach only to a verified person, chosen explicitly; an admin's attach waits for the owner", async () => {
  const { ctx } = setup();
  await syncDetected(ctx, [name("Yuvi")], ADMIN);
  // never by similarity: an id that is not a mapping record is refused
  await assert.rejects(resolveCase(ctx, "identity_name:Yuvi", { kind: "identity_attach", competitorId: "Yuval" }, ADMIN, "looks like Yuval"), /verified person/);
  const c = await resolveCase(ctx, "identity_name:Yuvi", { kind: "identity_attach", competitorId: "u_yuval" }, ADMIN, "Yuval confirmed he uses Yuvi");
  assert.equal(c.status, "pending_owner");
  assert.equal((await reviewDecisions(ctx)).overrides.length, 0, "a pending decision changes nothing");
  await assert.rejects(confirmCase(ctx, "identity_name:Yuvi", ADMIN), ArenaAuthorizationError);
  await confirmCase(ctx, "identity_name:Yuvi", OWNER);
  const d = await reviewDecisions(ctx);
  assert.deepEqual(d.overrides.map((o) => [o.crmName, o.competitorId, o.by]), [["Yuvi", "u_yuval", OWNER]]);
});

test("identity: non-person names can be excluded after review, and block the name in the engine", async () => {
  const { ctx } = setup();
  await syncDetected(ctx, [name("Milwaukee Pool")], ADMIN);
  const c = await resolveCase(ctx, "identity_name:Milwaukee Pool", { kind: "identity_not_competitor", category: "location_pool" }, ADMIN, "location pool");
  assert.equal(c.status, "resolved");
  const o = (await reviewDecisions(ctx)).overrides[0];
  assert.equal(o.competitorId, null);
  assert.match(o.reason, /^location_pool: /);
});

test("duplicates: confirm keeps at least one job counted; exclusions touch the qualifying count only", async () => {
  const { ctx } = setup();
  await syncDetected(ctx, [dup(false, ["j1", "j2", "j3"])], ADMIN);
  const id = "duplicate_group:j1,j2,j3";
  await assert.rejects(resolveCase(ctx, id, { kind: "duplicate_confirmed", excludeJobIds: [] }, ADMIN, "dup"), /choose/);
  await assert.rejects(resolveCase(ctx, id, { kind: "duplicate_confirmed", excludeJobIds: ["j9"] }, ADMIN, "dup"), /not in this group/);
  await assert.rejects(resolveCase(ctx, id, { kind: "duplicate_confirmed", excludeJobIds: ["j1", "j2", "j3"] }, ADMIN, "dup"), /stay counted/);
  await resolveCase(ctx, id, { kind: "duplicate_confirmed", excludeJobIds: ["j3", "j2"] }, ADMIN, "entered twice; office fixing in CRM");
  const d = await reviewDecisions(ctx);
  assert.deepEqual(d.exclusions.map((x) => [x.jobId, x.kind]), [["j2", "duplicate"], ["j3", "duplicate"]]);
});

test("duplicates: a group that may affect prizes needs the owner; a dismissal feeds the engine's dismissed list", async () => {
  const { ctx } = setup();
  await syncDetected(ctx, [dup(true)], ADMIN);
  const c = await resolveCase(ctx, "duplicate_group:j1,j2", { kind: "duplicate_dismissed" }, ADMIN, "two separate visits");
  assert.equal(c.status, "pending_owner");
  await rejectCase(ctx, "duplicate_group:j1,j2", OWNER, "check the invoice numbers first");
  await resolveCase(ctx, "duplicate_group:j1,j2", { kind: "duplicate_dismissed" }, OWNER, "separate visits, invoices differ");
  assert.deepEqual((await reviewDecisions(ctx)).dismissedDuplicateGroups, ["j1,j2"]);
});

test("display names: English only, owner-confirmed", async () => {
  const { ctx } = setup();
  await syncDetected(ctx, [display("u_dana", "דנה כהן")], ADMIN);
  const id = "display_name:u_dana";
  await assert.rejects(resolveCase(ctx, id, { kind: "display_name", displayName: "דנה" }, ADMIN, "x"), /Latin letters/);
  const c = await resolveCase(ctx, id, { kind: "display_name", displayName: "  Dana   Cohen " }, ADMIN, "as Dana asked");
  assert.equal(c.status, "pending_owner");
  await confirmCase(ctx, id, OWNER);
  assert.deepEqual((await reviewDecisions(ctx)).displayNames, { u_dana: "Dana Cohen" });
  assert.ok(isEnglishDisplayName("Yuval German"));
  assert.ok(isEnglishDisplayName("D'Angelo O'Neil-Smith"));
  assert.ok(!isEnglishDisplayName("Y"));
  assert.ok(!isEnglishDisplayName("Bob <script>"));
});

test("a wrong resolution type for the case kind is refused", async () => {
  const { ctx } = setup();
  await syncDetected(ctx, [name("John")], ADMIN);
  await assert.rejects(resolveCase(ctx, "identity_name:John", { kind: "duplicate_dismissed" }, ADMIN, "x"), ArenaConfigError);
});

test("reopen: needs a reason; only the owner can undo an owner-confirmed decision", async () => {
  const { ctx } = setup();
  await syncDetected(ctx, [name("Yuvi"), name("Plenty")], ADMIN);
  await resolveCase(ctx, "identity_name:Yuvi", { kind: "identity_attach", competitorId: "u_yuval" }, OWNER, "confirmed by Yuval");
  await assert.rejects(reopenCase(ctx, "identity_name:Yuvi", ADMIN, "mistake"), ArenaAuthorizationError);
  await assert.rejects(reopenCase(ctx, "identity_name:Yuvi", OWNER, ""), ArenaConfigError);
  await reopenCase(ctx, "identity_name:Yuvi", OWNER, "Yuvi is a different person");
  assert.equal((await reviewDecisions(ctx)).overrides.length, 0);
  // an admin can reopen their own non-owner decision
  await resolveCase(ctx, "identity_name:Plenty", { kind: "identity_not_competitor", category: "location_pool" }, ADMIN, "pool");
  await reopenCase(ctx, "identity_name:Plenty", ADMIN, "check again");
  assert.deepEqual((await caseHistory(ctx, "identity_name:Yuvi")).map((e) => e.action), ["detected", "resolved", "reopened"]);
  await assert.rejects(reopenCase(ctx, "identity_name:Plenty", ADMIN, "again"), ArenaStateError);
});

test("launch readiness: blocked until every case is resolved; pending decisions still block", async () => {
  const { ctx } = setup();
  await syncDetected(ctx, [dup(false), name("TZVI"), display("u_dana", "דנה")], ADMIN);
  let r = await readiness(ctx);
  assert.equal(r.launchBlocking, 3);
  assert.equal(r.byKind.duplicate_group.likelyOpen, 1);
  await resolveCase(ctx, "duplicate_group:j1,j2", { kind: "duplicate_confirmed", excludeJobIds: ["j2"] }, ADMIN, "dup");
  await resolveCase(ctx, "identity_name:TZVI", { kind: "identity_not_competitor", category: "subcontractor" }, ADMIN, "sub");
  await resolveCase(ctx, "display_name:u_dana", { kind: "display_name", displayName: "Dana" }, ADMIN, "her choice");
  r = await readiness(ctx);
  assert.equal(r.launchReady, false, "the display name still waits for the owner");
  assert.equal(r.byKind.display_name.pendingOwner, 1);
  await confirmCase(ctx, "display_name:u_dana", OWNER);
  assert.equal((await readiness(ctx)).launchReady, true);
});

test("concurrent decisions on one case: the second is refused, not silently overwritten", async () => {
  const { ctx } = setup();
  await syncDetected(ctx, [name("John")], ADMIN);
  const a = resolveCase(ctx, "identity_name:John", { kind: "identity_not_competitor", category: "other" }, ADMIN, "a");
  const b = resolveCase(ctx, "identity_name:John", { kind: "identity_not_competitor", category: "subcontractor" }, OWNER, "b");
  const results = await Promise.allSettled([a, b]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(results.filter((x) => x.status === "rejected").length, 1);
});
