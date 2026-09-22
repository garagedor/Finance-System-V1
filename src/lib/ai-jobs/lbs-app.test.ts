// Run: node --test src/lib/ai-jobs/lbs-app.test.ts   (Node 24+, strips types)
//
// Regression suite for the LBS App integration doors: read-back scope, the
// TEST-only cleanup fence, idempotency and media handling. Runs the REAL
// decision + database-step code (lbs-app.ts, lbs-app-store.ts) against an
// in-memory Mongo double — no Atlas, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkIngestAuth } from "./ingest-auth.ts";
import { dashboardExtras, dashboardToEnvelope } from "./dashboard-payload.ts";
import { cleanupDecision, LBS_APP_CHANNEL, readEnvironment } from "./lbs-app.ts";
import { cleanupLbsApp, executeLbsAppIngest, readLbsApp } from "./lbs-app-store.ts";

// ── In-memory Mongo double (only the operators the store uses) ──────────────

// Mongo-style dotted path: arrays fan out, so "aiMedia.media_id" hits any element.
const getPath = (doc: any, path: string): unknown[] => {
  let cur: unknown[] = [doc];
  for (const part of path.split(".")) {
    cur = cur.flatMap((c) => (Array.isArray(c) ? c : [c])).map((c) => (c == null ? undefined : (c as any)[part]));
  }
  return cur.flatMap((v) => (Array.isArray(v) ? [...v, v] : [v]));
};
const eq = (a: unknown, b: unknown) => (a == null && b == null) || String(a) === String(b) && typeof a === typeof b;

function matches(doc: any, filter: any): boolean {
  for (const [k, cond] of Object.entries(filter ?? {})) {
    if (k === "$or") { if (!(cond as any[]).some((f) => matches(doc, f))) return false; continue; }
    const vals = getPath(doc, k);
    if (cond && typeof cond === "object" && !Array.isArray(cond) && Object.keys(cond).some((x) => x.startsWith("$"))) {
      const c = cond as any;
      if ("$ne" in c && vals.some((v) => eq(v, c.$ne))) return false;
      if ("$in" in c && !vals.some((v) => (c.$in as unknown[]).some((x) => eq(v, x)))) return false;
      if ("$not" in c) {
        const em = c.$not.$elemMatch;
        const arr = doc[k] ?? [];
        if (arr.some((el: any) => matches(el, em))) return false;
      }
      continue;
    }
    if (!vals.some((v) => eq(v, cond))) return false;
  }
  return true;
}

function fakeColl(seed: any[] = []) {
  const docs: any[] = seed.map((d) => structuredClone(d));
  let n = 1000;
  const coll = {
    docs,
    async findOne(f: any) { return structuredClone(docs.find((d) => matches(d, f)) ?? null); },
    find(f: any) {
      const res = () => docs.filter((d) => matches(d, f)).map((d) => structuredClone(d));
      return { limit: (k: number) => ({ toArray: async () => res().slice(0, k) }), toArray: async () => res() };
    },
    async insertOne(d: any) { const doc = { _id: d._id ?? `row${n++}`, ...structuredClone(d) }; docs.push(doc); return { insertedId: doc._id }; },
    async updateOne(f: any, u: any) {
      const d = docs.find((x) => matches(x, f));
      if (!d) return { matchedCount: 0 };
      Object.assign(d, structuredClone(u.$set ?? {}));
      for (const [k, v] of Object.entries(u.$push ?? {})) (d[k] ??= []).push(structuredClone(v));
      return { matchedCount: 1 };
    },
    async deleteOne(f: any) { const i = docs.findIndex((x) => matches(x, f)); if (i < 0) return { deletedCount: 0 }; docs.splice(i, 1); return { deletedCount: 1 }; },
    async deleteMany(f: any) { const before = docs.length; for (let i = docs.length - 1; i >= 0; i--) if (matches(docs[i], f)) docs.splice(i, 1); return { deletedCount: before - docs.length }; },
  };
  return coll;
}

// ── Helpers: send a payload_for()-shaped write through the real steps ───────

const payload = (over: Record<string, unknown> = {}) => ({
  source: "LBS_APP",
  lbs_job_id: 901,
  version: 1,
  event: "create_job",
  is_test: true,
  customer: { name: "Test Customer", phone_e164: "+15550000000" },
  address: { formatted: "1 Test St" },
  job: { invoice_number: "T-1", date: "2026-09-20", provider: "P", technician: "Tech A", market: "Miami", status: "Closed", notes: "Replaced springs" },
  money: { total: 500, payments: { paid_card: 500 }, parts: { tech_parts: 40 }, tips: { tips_card: 20 } },
  evidence: [{ kind: "photo", media_id: "m1", content_type: "image/jpeg", bytes: 10, sha256: "s1" }],
  verdict: "READY",
  ...over,
});

let clock = 0;
async function send(jobs: any, p: Record<string, unknown>, mediaOnly = false) {
  const env = dashboardToEnvelope(p);
  const lbs = dashboardExtras(p, mediaOnly);
  const now = new Date(Date.UTC(2026, 8, 23, 12, 0, clock++)).toISOString();
  return executeLbsAppIngest(jobs, {
    ingestId: String(p.lbs_job_id),
    normalized: mediaOnly || lbs.mediaOnly ? {} : (env.job as any),
    aiMeta: { source: "bot", eventType: env.meta!.eventType!, ingestId: String(p.lbs_job_id), ingestIdKind: "client", ingestedAt: now, refs: env.meta!.refs, validation: [] },
    externalJobId: String(p.lbs_job_id),
    lbs,
    validation: [],
    now,
  });
}
const stores = (jobs: any) => ({ jobs, links: fakeColl(), log: fakeColl() });

const humanRow = { _id: "human1", externalJobId: "777", tech: "Tech H", clientName: "Real Person", aiMeta: { source: "manual", eventType: "other", ingestId: "manual_x", ingestIdKind: "generated", ingestedAt: "2026-09-01T00:00:00Z" } };
// Exact shape of the rows the pre-stamping door (a11a20d) wrote — e.g. ids 16–20.
const legacyRow = (id: string) => ({ _id: `legacy${id}`, externalJobId: id, tech: "Tech L", totalAmount: 300, aiMeta: { source: "bot", eventType: "closing", ingestId: id, ingestIdKind: "client", ingestedAt: "2026-09-11T00:00:00Z", refs: { version: 1, operation: "create_job", lbs_job_id: Number(id), payload_source: "LBS_APP", verdict: "READY" } } });

// ── Auth ────────────────────────────────────────────────────────────────────

test("auth: correct Bearer passes; missing/wrong refused; unset token fails closed", () => {
  const prev = process.env.AI_INGEST_TOKEN;
  process.env.AI_INGEST_TOKEN = "secret-x";
  assert.deepEqual(checkIngestAuth("Bearer secret-x"), { ok: true });
  const noHeader = checkIngestAuth(null);
  assert.equal(noHeader.ok, false); assert.equal((noHeader as any).status, 401);
  assert.equal((checkIngestAuth("Bearer wrong") as any).status, 401);
  assert.ok(!JSON.stringify(checkIngestAuth("Bearer wrong")).includes("secret-x"), "never echoes the token");
  delete process.env.AI_INGEST_TOKEN;
  assert.equal((checkIngestAuth("Bearer secret-x") as any).status, 503);
  if (prev !== undefined) process.env.AI_INGEST_TOKEN = prev;
});

// ── Environment marker ───────────────────────────────────────────────────────

test("environment: explicit flag only; absent/contradictory/malformed → UNKNOWN", () => {
  assert.equal(readEnvironment({ is_test: true }), "TEST");
  assert.equal(readEnvironment({ environment: "test" }), "TEST");
  assert.equal(readEnvironment({ is_test: false }), "PRODUCTION");
  assert.equal(readEnvironment({}), "UNKNOWN");
  assert.equal(readEnvironment({ is_test: "true" }), "UNKNOWN");
  assert.equal(readEnvironment({ is_test: true, environment: "PRODUCTION" }), "UNKNOWN");
  // never inferred from business text
  assert.equal(readEnvironment({ customer: { name: "TEST" }, job: { invoice_number: "TEST-1", technician: "test" } }), "UNKNOWN");
});

// ── Read-back ────────────────────────────────────────────────────────────────

test("authenticated App-origin read returns the contract fields", async () => {
  const jobs = fakeColl();
  await send(jobs, payload());
  const r = await readLbsApp(jobs, "901");
  assert.equal(r.status, 200);
  const j = r.body.job as any;
  assert.equal(j.logical_job_id, "901");
  assert.equal(j.current_version, 1);
  assert.equal(j.versions.length, 1);
  assert.equal(j.origin.channel, LBS_APP_CHANNEL);
  assert.equal(j.origin.payload_source, "LBS_APP");
  assert.equal(j.is_test, true); assert.equal(j.environment, "TEST");
  assert.equal(j.technician, "Tech A"); assert.equal(j.market, "Miami");
  assert.equal(j.customer.name, "Test Customer"); assert.equal(j.invoice, "T-1");
  assert.equal(j.provider, "P"); assert.equal(j.address, "1 Test St");
  assert.equal(j.payments.paid_card, 500); assert.equal(j.tips.tips_card, 20);
  assert.equal(j.parts.tech_parts, 40); assert.equal(j.total, 500);
  assert.equal(j.work_done, "Replaced springs");
  assert.equal(j.media[0].media_id, "m1");
  assert.ok(j.created_at && j.updated_at);
  assert.ok(!("aiEditLog" in j) && !("_id" in j), "no internal/reviewer data");
});

test("unrelated human job cannot be read through the integration scope", async () => {
  const jobs = fakeColl([humanRow]);
  const r = await readLbsApp(jobs, "777");
  assert.equal(r.status, 404);
  assert.ok(!JSON.stringify(r.body).includes("Real Person"));
});

test("legacy (pre-stamping) App rows are readable and report UNKNOWN environment", async () => {
  const jobs = fakeColl([legacyRow("16")]);
  const r = await readLbsApp(jobs, "16");
  assert.equal(r.status, 200);
  assert.equal((r.body.job as any).environment, "UNKNOWN");
  assert.equal((r.body.job as any).is_test, false);
  assert.equal((r.body.job as any).origin.provenance, "lbs_app_outbox_legacy_unstamped");
});

// ── Cleanup fence ────────────────────────────────────────────────────────────

test("TEST App job cleanup succeeds and removes its comparison links", async () => {
  const jobs = fakeColl();
  await send(jobs, payload());
  const s = stores(jobs);
  const rowId = jobs.docs[0]._id;
  await s.links.insertOne({ aiJobId: String(rowId), prodJobId: "p1" });
  const r = await cleanupLbsApp(s, "901", "2026-09-23T00:00:00Z");
  assert.equal(r.status, 200); assert.equal(r.body.status, "cleaned");
  assert.equal(jobs.docs.length, 0);
  assert.equal(s.links.docs.length, 0);
  assert.equal(s.log.docs.length, 1, "audit tombstone written");
  assert.equal((r.body.media as any).physicalMediaDeleted, false);
});

test("PRODUCTION App job cleanup refused", async () => {
  const jobs = fakeColl();
  await send(jobs, payload({ is_test: false }));
  const r = await cleanupLbsApp(stores(jobs), "901", "t");
  assert.equal(r.status, 409); assert.equal(r.body.code, "production_record");
  assert.equal(jobs.docs.length, 1);
});

test("human-created job cleanup refused (and not even visible)", async () => {
  const jobs = fakeColl([humanRow]);
  const r = await cleanupLbsApp(stores(jobs), "777", "t");
  assert.equal(r.status, 404);
  assert.equal(jobs.docs.length, 1);
  assert.equal(cleanupDecision(humanRow as any).allowed, false);
  assert.equal((cleanupDecision(humanRow as any) as any).code, "human_created");
});

test("ambiguous origin cleanup refused: legacy unstamped, flag missing, mixed versions, human-edited", async () => {
  // legacy rows 16–20 shape
  let jobs = fakeColl([legacyRow("16")]);
  let r = await cleanupLbsApp(stores(jobs), "16", "t");
  assert.equal(r.status, 409); assert.equal(r.body.code, "ambiguous_provenance");
  assert.equal(jobs.docs.length, 1);

  // no flag at all
  jobs = fakeColl();
  await send(jobs, payload({ is_test: undefined }));
  r = await cleanupLbsApp(stores(jobs), "901", "t");
  assert.equal(r.body.code, "ambiguous_environment");

  // TEST then a correction without the flag → sticky UNKNOWN
  jobs = fakeColl();
  await send(jobs, payload());
  await send(jobs, payload({ version: 2, event: "update_job", is_test: undefined }));
  r = await cleanupLbsApp(stores(jobs), "901", "t");
  assert.equal(r.body.code, "ambiguous_environment");

  // TEST then a later send claims TEST again after a legacy row: still UNKNOWN
  jobs = fakeColl([legacyRow("17")]);
  await send(jobs, payload({ lbs_job_id: 17, version: 2, event: "update_job" }));
  r = await cleanupLbsApp(stores(jobs), "17", "t");
  assert.equal(r.body.code, "ambiguous_environment", "a later TEST claim cannot launder a legacy row");

  // human-edited TEST row
  jobs = fakeColl();
  await send(jobs, payload());
  jobs.docs[0].aiLastEditedAt = "2026-09-22T00:00:00Z";
  r = await cleanupLbsApp(stores(jobs), "901", "t");
  assert.equal(r.body.code, "human_edited");
  assert.equal(jobs.docs.length, 1);

  // name/invoice saying "TEST" proves nothing
  jobs = fakeColl();
  await send(jobs, payload({ is_test: undefined, customer: { name: "TEST" }, job: { invoice_number: "TEST", technician: "TEST" } }));
  r = await cleanupLbsApp(stores(jobs), "901", "t");
  assert.equal(r.body.code, "ambiguous_environment");
});

test("repeated cleanup is safe/idempotent", async () => {
  const jobs = fakeColl();
  await send(jobs, payload());
  const s = stores(jobs);
  const a = await cleanupLbsApp(s, "901", "t1");
  const b = await cleanupLbsApp(s, "901", "t2");
  assert.equal(a.body.status, "cleaned");
  assert.equal(b.status, 200); assert.equal(b.body.status, "already_cleaned");
  assert.equal(s.log.docs.length, 1);
  const c = await cleanupLbsApp(s, "never-existed", "t3");
  assert.equal(c.status, 404);
});

// ── Idempotency ─────────────────────────────────────────────────────────────

test("repeated POST of the same logical_job_id + version does not duplicate", async () => {
  const jobs = fakeColl();
  const a = await send(jobs, payload());
  const b = await send(jobs, payload());
  const c = await send(jobs, payload());
  assert.equal((a as any).status, "created");
  assert.equal((b as any).duplicate, true); assert.equal((c as any).duplicate, true);
  assert.equal(jobs.docs.length, 1);
  assert.equal(jobs.docs[0].aiVersions.length, 1);
  assert.equal(jobs.docs[0].aiMedia.length, 1);
});

test("correction version stays the same logical job; history appends; original frozen; stale retry ignored", async () => {
  const jobs = fakeColl();
  await send(jobs, payload());
  await send(jobs, payload({ version: 2, event: "update_job", money: { total: 650, payments: { paid_card: 650 } } }));
  await send(jobs, payload({ version: 1, event: "update_job", money: { total: 1 } })); // late, out-of-order
  assert.equal(jobs.docs.length, 1);
  const d = jobs.docs[0];
  assert.deepEqual(d.aiVersions.map((v: any) => `${v.version}:${v.operation}`), ["1:create_job", "2:update_job", "1:update_job"]);
  assert.equal(d.totalAmount, 650, "stale v1 retry did not clobber v2");
  assert.equal(d.aiOriginal.totalAmount, 500, "aiOriginal frozen");
  const r = await readLbsApp(jobs, "901");
  assert.equal((r.body.job as any).current_version, 2);
});

// ── Media ────────────────────────────────────────────────────────────────────

test("media door attaches identifiers only, never job fields; inherits env when flagless", async () => {
  const jobs = fakeColl();
  await send(jobs, payload());
  await send(jobs, { lbs_job_id: 901, version: 1, event: "sync_media", media: [{ media_id: "m2", kind: "receipt", sha256: "s2" }] }, true);
  await send(jobs, { lbs_job_id: 901, version: 1, event: "sync_media", media: [{ media_id: "m2", kind: "receipt", sha256: "s2" }] }, true); // dup
  const d = jobs.docs[0];
  assert.deepEqual(d.aiMedia.map((m: any) => m.media_id), ["m1", "m2"]);
  assert.equal(d.totalAmount, 500); assert.equal(d.tech, "Tech A");
  assert.equal(d.aiMeta.environment, "TEST");
  assert.equal(d.aiVersions.length, 2);
  const unknownJob = await send(jobs, { lbs_job_id: 999, event: "sync_media", media: [{ media_id: "x" }] }, true);
  assert.equal((unknownJob as any).status, 404);
});

test("media cleanup cannot delete shared/preserved media", async () => {
  const jobs = fakeColl([
    { ...legacyRow("18"), aiMedia: [{ media_id: "shared1", sha256: "sh", kind: "photo" }] },
  ]);
  await send(jobs, payload({ evidence: [{ media_id: "shared1", sha256: "sh" }, { media_id: "own1", sha256: "o1" }] }));
  const s = stores(jobs);
  const r = await cleanupLbsApp(s, "901", "t");
  assert.equal(r.body.status, "cleaned");
  const media = r.body.media as any;
  assert.deepEqual(media.retainedShared, ["shared1"]);
  assert.deepEqual(media.released, ["own1"]);
  assert.equal(media.physicalMediaDeleted, false);
  const preserved = jobs.docs.find((x: any) => x.externalJobId === "18");
  assert.ok(preserved, "preserved row untouched");
  assert.equal(preserved.aiMedia[0].media_id, "shared1");
});
