// Live-recompute monitoring (/api/arena/health, /api/arena/monitor), the
// keep-warm step, serving the last snapshot when a recompute fails, the
// production credential guard (env.ts arenaMongoUri) and the ops-route auth.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { currentCompetition, keepLiveWarm, liveHealth, liveSnapshot } from "./lifecycle.ts";
import { arenaMongoUri, requiresDedicatedConnection, ArenaEnvError } from "./env.ts";
import { cronSecretOk } from "./ops-auth.ts";
import { fixture, jobs } from "./testing/lifecycle-fixture.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");

async function running() {
  const f = await fixture();
  f.data.jobs = [...jobs(6, "Ann", "Closed", 1000), ...jobs(5, "Bo", "Closed", 900)];
  await f.startWeek();
  const cur = (await currentCompetition(f.ctx))!;
  return { ...f, c: cur.c, rv: cur.rv };
}

test("a recompute records the compute time and duration; health reads it without recomputing", async () => {
  const f = await running();
  await liveSnapshot(f.ctx, f.c, f.rv);
  const calls = f.data.computeCalls;
  const h = await liveHealth(f.ctx);
  assert.equal(f.data.computeCalls, calls, "health never recomputes");
  assert.equal(h.healthy, true);
  assert.equal(h.competition?.phase, "live");
  assert.equal(h.live?.ageSeconds, 0);
  assert.equal(h.lastComputeAt, "2026-10-28T15:00:00.000Z");
  assert.equal(typeof h.lastDurationMs, "number");
  assert.equal(h.lastError, null);
});

test("health turns unhealthy once the live snapshot is older than 3 refresh intervals", async () => {
  const f = await running();
  await liveSnapshot(f.ctx, f.c, f.rv);
  const r = f.rv.rules.display.refreshSeconds;
  f.setNow(new Date(Date.parse("2026-10-28T15:00:00Z") + 3 * r * 1000).toISOString());
  assert.equal((await liveHealth(f.ctx)).healthy, true);
  f.setNow(new Date(Date.parse("2026-10-28T15:00:00Z") + (3 * r + 1) * 1000).toISOString());
  const h = await liveHealth(f.ctx);
  assert.equal(h.healthy, false);
  assert.match(h.problems.join(" "), /stale/);
});

test("a failed recompute serves the previous snapshot and is reported; the next success clears it", async () => {
  const f = await running();
  const first = await liveSnapshot(f.ctx, f.c, f.rv);
  f.setNow("2026-10-28T15:05:00Z");
  f.data.computeError = new Error("CRM unreachable (test)");
  const served = await liveSnapshot(f.ctx, f.c, f.rv);
  assert.equal(served?.computedAt, first?.computedAt, "the last good snapshot is served, its age shows");
  let h = await liveHealth(f.ctx);
  assert.equal(h.healthy, false);
  assert.equal(h.lastError, "CRM unreachable (test)");
  assert.equal(h.consecutiveFailures, 1);
  assert.equal(h.lastComputeAt, "2026-10-28T15:00:00.000Z");
  f.setNow("2026-10-28T15:06:00Z");
  f.data.computeError = null;
  await liveSnapshot(f.ctx, f.c, f.rv);
  h = await liveHealth(f.ctx);
  assert.equal(h.healthy, true);
  assert.equal(h.consecutiveFailures, 0);
  assert.equal(h.lastErrorAt, "2026-10-28T15:05:00.000Z", "the last error stays visible for diagnosis");
});

test("a failed FIRST recompute still fails the request (nothing to serve)", async () => {
  const f = await running();
  f.data.computeError = new Error("down");
  await assert.rejects(liveSnapshot(f.ctx, f.c, f.rv), /down/);
  assert.equal((await liveHealth(f.ctx)).consecutiveFailures, 1);
});

test("keep-warm recomputes a stale live snapshot with nobody connected, and only when stale", async () => {
  const f = await running();
  let h = await keepLiveWarm(f.ctx);
  assert.equal(f.data.computeCalls, 1);
  assert.equal(h.healthy, true);
  await keepLiveWarm(f.ctx);
  assert.equal(f.data.computeCalls, 1, "still fresh: served from cache");
  f.setNow("2026-10-28T15:10:00Z");
  h = await keepLiveWarm(f.ctx);
  assert.equal(f.data.computeCalls, 2);
  assert.equal(h.live?.ageSeconds, 0);
});

test("no running week: health is healthy and empty", async () => {
  const f = await fixture();
  const h = await liveHealth(f.ctx);
  assert.equal(h.competition, null);
  assert.equal(h.healthy, true);
});

// ── production credential guard ────────────────────────────────────────────

const ATLAS_CRM = "mongodb+srv://lbs_crm_app:pw@cluster0.example.mongodb.net/";
const ATLAS_ARENA = "mongodb+srv://lbs_arena_app:pw2@cluster0.example.mongodb.net/";
const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;

test("production refuses to run without a dedicated ARENA_MONGODB_URI (no fallback)", () => {
  for (const e of [
    { NODE_ENV: "production", MONGODB_URI: ATLAS_CRM },
    { NODE_ENV: "production", VERCEL_ENV: "production", MONGODB_URI: ATLAS_CRM },
    { NODE_ENV: "production", VERCEL_ENV: "preview", VERCEL: "1", MONGODB_URI: ATLAS_CRM },
    { VERCEL_ENV: "production", MONGODB_URI: ATLAS_CRM },
    // the dev-stack marker does not exempt a deployment, nor a non-loopback database
    { NODE_ENV: "production", VERCEL_ENV: "production", ARENA_DEV_STACK: "1", MONGODB_URI: "mongodb://127.0.0.1:27031" },
    { NODE_ENV: "production", ARENA_DEV_STACK: "1", MONGODB_URI: ATLAS_CRM },
    { NODE_ENV: "production", ARENA_DEV_STACK: "1", MONGODB_URI: "mongodb://127.0.0.1.evil.example:27017" },
  ]) {
    assert.equal(requiresDedicatedConnection(env(e)), true, JSON.stringify(e));
    assert.throws(() => arenaMongoUri(env(e)), (err: unknown) => err instanceof ArenaEnvError && /refuses to run in production/.test(err.message), JSON.stringify(e));
  }
});

test("production refuses the CRM app's own connection as the 'dedicated' one", () => {
  for (const uri of [ATLAS_CRM, "mongodb+srv://lbs_crm_app:other@cluster0.example.mongodb.net/"])
    assert.throws(() => arenaMongoUri(env({ NODE_ENV: "production", VERCEL_ENV: "production", MONGODB_URI: ATLAS_CRM, ARENA_MONGODB_URI: uri })), /dedicated Arena user/);
});

test("production with the dedicated user is allowed; a malformed URI is refused everywhere", () => {
  assert.equal(arenaMongoUri(env({ NODE_ENV: "production", VERCEL_ENV: "production", MONGODB_URI: ATLAS_CRM, ARENA_MONGODB_URI: ATLAS_ARENA })), ATLAS_ARENA);
  assert.throws(() => arenaMongoUri(env({ ARENA_MONGODB_URI: "http://x" })), /not a MongoDB connection string/);
});

test("development keeps working: the local dev stack (next start, loopback DB) and plain dev share the CRM connection", () => {
  assert.equal(arenaMongoUri(env({ NODE_ENV: "production", ARENA_DEV_STACK: "1", MONGODB_URI: "mongodb://127.0.0.1:27031" })), null);
  assert.equal(arenaMongoUri(env({ NODE_ENV: "production", ARENA_DEV_STACK: "1", MONGODB_URI: "mongodb://localhost:27017/ag" })), null);
  assert.equal(arenaMongoUri(env({ NODE_ENV: "development", MONGODB_URI: ATLAS_CRM })), null);
  assert.equal(arenaMongoUri(env({ MONGODB_URI: ATLAS_CRM, ARENA_MONGODB_URI: ATLAS_ARENA })), ATLAS_ARENA);
});

test("arenaContexts goes through the guard (no direct read of ARENA_MONGODB_URI)", () => {
  const src = readFileSync(join(ROOT, "src", "lib", "arena", "admin-service.ts"), "utf8");
  const fn = src.slice(src.indexOf("function dedicatedArenaClient"), src.indexOf("/** Wire the stores"));
  assert.match(fn, /arenaMongoUri\(env\)/);
  assert.doesNotMatch(fn, /env\.ARENA_MONGODB_URI/);
});

// ── ops-route authentication ───────────────────────────────────────────────

const SECRET = "0123456789abcdef-cron-secret";
const h = (o: Record<string, string>) => new Headers(o);

test("cron secret: x-cron-secret or Bearer match; anything else (incl. an unset/short secret) fails closed", () => {
  const e = env({ CRON_SECRET: SECRET });
  assert.equal(cronSecretOk(h({ "x-cron-secret": SECRET }), e), true);
  assert.equal(cronSecretOk(h({ authorization: `Bearer ${SECRET}` }), e), true);
  assert.equal(cronSecretOk(h({ "x-cron-secret": SECRET + "x" }), e), false);
  assert.equal(cronSecretOk(h({ authorization: SECRET }), e), false);
  assert.equal(cronSecretOk(h({}), e), false);
  assert.equal(cronSecretOk(h({ "x-cron-secret": "" }), env({})), false, "unset secret never matches");
  assert.equal(cronSecretOk(h({ "x-cron-secret": "short" }), env({ CRON_SECRET: "short" })), false, "short secret refused");
});

test("ops routes: monitor is cron-secret only; health is cron secret OR an admin session; both fail closed", async () => {
  const saved = process.env.CRON_SECRET;
  process.env.CRON_SECRET = SECRET;
  try {
    const monitor = await import("../../app/api/arena/monitor/route.ts");
    const health = await import("../../app/api/arena/health/route.ts");
    assert.equal((await monitor.GET(new Request("https://app.test/api/arena/monitor"))).status, 401);
    assert.equal((await monitor.GET(new Request("https://app.test/api/arena/monitor", { headers: { "x-cron-secret": "wrong-wrong-wrong-wrong" } }))).status, 401);
    // no session outside a request scope → requirePermission answers 401
    assert.equal((await health.GET(new Request("https://app.test/api/arena/health"))).status, 401);
    delete process.env.CRON_SECRET;
    assert.equal((await monitor.GET(new Request("https://app.test/api/arena/monitor", { headers: { "x-cron-secret": SECRET } }))).status, 401, "unset secret: refused");
  } finally {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  }
  const src = readFileSync(join(ROOT, "src", "app", "api", "arena", "health", "route.ts"), "utf8");
  assert.match(src, /if \(!cronSecretOk\(req\.headers\)\) \{\s*const s = await requirePermission\("arena:console:view" as Permission\);\s*if \(s instanceof NextResponse\) return s;\s*\}/);
});
