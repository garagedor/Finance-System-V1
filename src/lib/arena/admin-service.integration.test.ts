// Real-driver integration test on an in-memory MongoDB (mongodb-memory-server):
// the Admin Control Center and review queue work end to end, write only to the
// Arena database, and leave every CRM document byte-for-byte unchanged.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { buildArenaContexts, previewRules, scanForReview, type ArenaContexts } from "./admin-service.ts";
import { ensureArenaIndexes } from "./mongo-store.ts";
import { createCompetition, initSettings, saveTemplate, updateDraftRules, activateCompetition, scheduleCompetition, ArenaAuthorizationError } from "./config-store.ts";
import { confirmCase, readiness, resolveCase, reviewDecisions } from "./review.ts";
import { SEED_STANDARD_WEEK, cloneRules } from "./config.ts";
import { loadJobs } from "./job-source.ts";

const OWNER = "owner-1";
const ADMIN = "admin-2";
let server: MongoMemoryServer, client: MongoClient, crm: Db, arena: Db, ctx: ArenaContexts;

const W1 = "2026-09-07";
function job(i: number, tech: string, date: string, status: string, paid: number, phone = `55500${String(i).padStart(5, "0")}`) {
  return { _id: `job${i}`, tech, date, status, location: "Chicago", totalPaidCard: paid, techParts: 0, companyParts: 0, clientPhoneNumber: phone };
}

async function crmFingerprint(db: Db) {
  const out: Record<string, string> = {};
  for (const c of (await db.listCollections().toArray()).map((x) => x.name).sort()) {
    const docs = await db.collection(c).find({}).sort({ _id: 1 }).toArray();
    out[c] = createHash("sha256").update(JSON.stringify(docs)).digest("hex");
  }
  return out;
}

before(async () => {
  server = await MongoMemoryServer.create();
  client = await MongoClient.connect(server.getUri());
  crm = client.db("crm_test");
  arena = client.db("arena_test");
  let i = 0;
  const jobs = [
    ...Array.from({ length: 12 }, () => job(++i, "Dana", "2026-09-08", "Closed", 600)),
    job(++i, "Dana", "2026-09-09", "Closed", 450, "5551112222"),
    job(++i, "Dana", "2026-09-09", "Closed", 450, "5551112222"), // likely duplicate
    ...Array.from({ length: 11 }, () => job(++i, "Yuval", "2026-09-08", "Closed", 500)),
    ...Array.from({ length: 4 }, () => job(++i, "Plenty", "2026-09-10", "Closed", 300)),
    ...Array.from({ length: 2 }, () => job(++i, "Yuval", "2026-09-15", "Estimate", 0)),
  ];
  await crm.collection("Job").insertMany(jobs as never);
  await crm.collection("Job_ai").insertOne({ _id: "shadow1", tech: "Dana", date: "2026-09-08", status: "Closed", totalPaidCard: 99999 } as never);
  await crm.collection("TechNameMapping").insertMany([
    { _id: "m1", supabaseUserId: "u_dana", supabaseFullName: "דנה כהן", crmTechNames: ["Dana"] },
    { _id: "m2", supabaseUserId: "u_yuval", supabaseFullName: "Yuval German", crmTechNames: ["Yuval"] },
  ] as never);
  await crm.collection("Technician").insertMany([{ _id: "Dana", location: "Chicago" }, { _id: "Yuval", location: "Chicago" }, { _id: "Plenty", location: "Chicago" }] as never);
  await ensureArenaIndexes(arena);
  let n = 0;
  ctx = buildArenaContexts(arena, crm, () => new Date("2026-09-22T15:00:00Z"));
  ctx.config.newId = ctx.review.newId = (p) => `${p}_${++n}`;
});

after(async () => {
  await client?.close();
  await server?.stop();
});

test("full admin + review session writes only Arena collections and leaves the CRM untouched", async () => {
  const crmBefore = await crmFingerprint(crm);

  await initSettings(ctx.config, { budgetCeilingCents: 150_000, ownerUserId: OWNER, approverUserIds: [OWNER] }, OWNER);
  await saveTemplate(ctx.config, { templateId: "standard", name: "Standard Week", rules: SEED_STANDARD_WEEK }, ADMIN);
  await createCompetition(ctx.config, "2026-09-28", { template: "standard" }, ADMIN);
  const r = cloneRules(SEED_STANDARD_WEEK);
  r.eligibility.minQualifyingJobs = 11;
  await updateDraftRules(ctx.config, "arena_2026-09-28", r, ADMIN);
  await scheduleCompetition(ctx.config, "arena_2026-09-28", ADMIN);
  ctx.config.now = () => new Date("2026-09-28T04:00:00Z"); // Monday 00:00 EDT
  await assert.rejects(activateCompetition(ctx.config, "arena_2026-09-28", ADMIN), ArenaAuthorizationError);
  await activateCompetition(ctx.config, "arena_2026-09-28", OWNER);

  const scan = await scanForReview(ctx, SEED_STANDARD_WEEK, W1, 2, ADMIN);
  assert.equal(scan.added, 3, "one duplicate group, one unmapped name, one display name");
  const again = await scanForReview(ctx, SEED_STANDARD_WEEK, W1, 2, ADMIN);
  assert.equal(again.added, 0, "a rescan never duplicates cases");

  const cases = await arena.collection("arena_review_case").find({}).toArray();
  const dup = cases.find((c) => c.kind === "duplicate_group")!;
  assert.equal((dup.data as { likely: boolean }).likely, true);
  await resolveCase(ctx.review, dup._id as unknown as string, { kind: "duplicate_confirmed", excludeJobIds: [(dup.data as { jobs: { id: string }[] }).jobs[1].id] }, OWNER, "entered twice; office will fix the CRM row");
  await resolveCase(ctx.review, "identity_name:Plenty", { kind: "identity_not_competitor", category: "location_pool" }, ADMIN, "Plenty is the Chicago pool");
  await resolveCase(ctx.review, "display_name:u_dana", { kind: "display_name", displayName: "Dana Cohen" }, ADMIN, "Dana's choice");
  assert.equal((await readiness(ctx.review)).launchReady, false);
  await confirmCase(ctx.review, "display_name:u_dana", OWNER);
  assert.equal((await readiness(ctx.review)).launchReady, true);

  const preview = await previewRules(ctx, SEED_STANDARD_WEEK, W1);
  assert.deepEqual(preview.prizes.map((p) => p.name).sort(), ["Dana Cohen", "Yuval German"]);
  assert.equal(preview.unmappedNamesWithJobs.length, 0, "Plenty was classified, so it no longer blocks");
  assert.equal(preview.blockingDuplicates, 0);
  assert.equal(preview.paidCents + preview.unallocatedCents, preview.budgetCents);
  // AI shadow records are never read: only production Job rows reach the engine
  const loaded = await loadJobs(crm, W1, "2026-09-21");
  assert.equal(loaded.length, 31);
  assert.ok(!loaded.some((j) => j.id === "shadow1"));

  const d = await reviewDecisions(ctx.review);
  assert.equal(d.exclusions.length, 1);

  assert.deepEqual(await crmFingerprint(crm), crmBefore, "no CRM document or collection changed");
  const arenaCollections = (await arena.listCollections().toArray()).map((c) => c.name).sort();
  assert.ok(arenaCollections.every((c) => c.startsWith("arena_")), arenaCollections.join(","));
  assert.ok((await arena.collection("arena_audit").countDocuments()) >= 10, "every action left an audit row");
});
