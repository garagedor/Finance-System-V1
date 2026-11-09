// Dead-man's-switch ping (ARENA_MONITOR_PING_URL) against a FAKE HTTP server on
// 127.0.0.1: unset → no-op; healthy → success ping; 3 failed runs in a row → <url>/fail;
// recovery → success again; 5 s timeout (shortened here); never throws; never logs
// the URL; the real /api/arena/monitor route pings (in-memory MongoDB).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import {
  monitorPing, monitorPingUrl, failUrl, MONITOR_FAIL_AFTER, MONITOR_PING_DOC_ID, MONITOR_PING_TIMEOUT_MS, _resetMonitorPingMemory,
} from "./monitor-ping.ts";
import { MemoryCollection } from "./testing/memory-collection.ts";

const TOKEN = "0f8e2c1a-5b7d-4e3f-9a6b-c2d1e0f9a8b7"; // stands in for a Healthchecks check uuid
let srv: http.Server;
let base = "";
let hits: string[] = [];
let mode: "ok" | "500" | "hang" = "ok";
const hanging: http.ServerResponse[] = [];

before(async () => {
  srv = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    if (mode === "hang") return void hanging.push(res);
    res.writeHead(mode === "500" ? 500 : 200, { "content-type": "text/plain" }).end(mode === "500" ? "nope" : "OK");
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
after(async () => {
  for (const r of hanging) r.destroy();
  srv.closeAllConnections();
  await new Promise((r) => srv.close(r));
});

const env = (url?: string) => ({ ...(url !== undefined ? { ARENA_MONITOR_PING_URL: url } : {}) }) as NodeJS.ProcessEnv;
function logger() {
  const lines: string[] = [];
  return { lines, log: (m: string) => lines.push(m) };
}
const reset = () => { hits = []; mode = "ok"; _resetMonitorPingMemory(); };

test("unset (or blank) → no-op: no request, nothing stored", async () => {
  reset();
  const store = new MemoryCollection();
  for (const healthy of [true, false, false, false]) {
    assert.deepEqual(await monitorPing({ healthy, store: store as never, env: env() }), { sent: null, failures: 0, ok: null });
    assert.deepEqual(await monitorPing({ healthy, store: store as never, env: env("   ") }), { sent: null, failures: 0, ok: null });
  }
  assert.deepEqual(hits, []);
  assert.equal(await store.findOne({ _id: MONITOR_PING_DOC_ID }), null);
});

test("URL validation: https anywhere, http only on loopback; invalid → off, and the value is never logged", () => {
  const l = logger();
  assert.equal(monitorPingUrl(env("https://hc-ping.com/abc"), l.log)?.href, "https://hc-ping.com/abc");
  assert.ok(monitorPingUrl(env("http://127.0.0.1:9/x"), l.log));
  for (const bad of ["http://hc-ping.example.com/" + TOKEN, "ftp://x/" + TOKEN, "not a url " + TOKEN, "https://user:pw@hc-ping.com/" + TOKEN, "https://hc-ping.com/" + TOKEN + "#frag"])
    assert.equal(monitorPingUrl(env(bad), l.log), null, bad);
  assert.ok(l.lines.length >= 5);
  for (const line of l.lines) assert.ok(!line.includes(TOKEN) && !line.includes("hc-ping"), line);
  assert.equal(failUrl(new URL("https://hc-ping.com/ping/abc/")).href, "https://hc-ping.com/ping/abc/fail");
  assert.equal(failUrl(new URL("https://hc-ping.com/ping/abc?rid=1")).href, "https://hc-ping.com/ping/abc/fail?rid=1");
});

test("healthy → success ping; 1st and 2nd failure → nothing; 3rd+ → /fail; recovery → success; counter persisted", async () => {
  reset();
  const store = new MemoryCollection();
  const url = `${base}/ping/${TOKEN}`;
  const l = logger();
  const run = (healthy: boolean) => monitorPing({ healthy, store: store as never, env: env(url), log: l.log });
  assert.deepEqual(await run(true), { sent: "success", failures: 0, ok: true });
  assert.deepEqual(await run(false), { sent: null, failures: 1, ok: null });
  assert.deepEqual(await run(false), { sent: null, failures: 2, ok: null });
  assert.equal(MONITOR_FAIL_AFTER, 3);
  assert.deepEqual(await run(false), { sent: "fail", failures: 3, ok: true });
  assert.deepEqual(await run(false), { sent: "fail", failures: 4, ok: true });
  assert.equal(((await store.findOne({ _id: MONITOR_PING_DOC_ID })) as { failures: number }).failures, 4, "kept in arena_live_health");
  assert.deepEqual(await run(true), { sent: "success", failures: 0, ok: true });
  assert.deepEqual(await run(false), { sent: null, failures: 1, ok: null }, "a new run starts from zero");
  assert.deepEqual(hits, [`GET /ping/${TOKEN}`, `GET /ping/${TOKEN}/fail`, `GET /ping/${TOKEN}/fail`, `GET /ping/${TOKEN}`]);
  assert.ok(l.lines.some((x) => /recovery ping sent/.test(x)));
  for (const line of l.lines) assert.ok(!line.includes(TOKEN) && !line.includes(base), line);
});

test("the failure run survives across instances (store) and falls back to memory when the store is down", async () => {
  reset();
  const store = new MemoryCollection();
  const url = `${base}/ping/${TOKEN}`;
  await monitorPing({ healthy: false, store: store as never, env: env(url) });
  _resetMonitorPingMemory(); // "another instance": memory empty, store has 1
  await monitorPing({ healthy: false, store: store as never, env: env(url) });
  const third = await monitorPing({ healthy: false, store: store as never, env: env(url) });
  assert.equal(third.sent, "fail");
  reset();
  const broken = { findOne: async () => { throw new Error("db down"); }, updateOne: async () => { throw new Error("db down"); }, insertOne: async () => { throw new Error("db down"); } };
  const outs = [];
  for (let i = 0; i < 3; i++) outs.push(await monitorPing({ healthy: false, store: broken, env: env(url) }));
  assert.deepEqual(outs.map((o) => o.sent), [null, null, "fail"], "in-process counter when the database is unreachable");
  const none = [];
  for (let i = 0; i < 3; i++) none.push(await monitorPing({ healthy: false, store: null, env: env(url) }));
  assert.deepEqual(none.map((o) => o.failures), [4, 5, 6]);
});

test("timeout: a hanging monitor service never blocks longer than the timeout and never throws", async () => {
  reset();
  assert.equal(MONITOR_PING_TIMEOUT_MS, 5_000);
  mode = "hang";
  const l = logger();
  const t0 = Date.now();
  const r = await monitorPing({ healthy: true, env: env(`${base}/ping/${TOKEN}`), timeoutMs: 300, log: l.log });
  const ms = Date.now() - t0;
  assert.deepEqual(r, { sent: "success", failures: 0, ok: false, reason: "timeout" });
  assert.ok(ms >= 250 && ms < 2_000, `${ms} ms`);
  assert.deepEqual(l.lines, ["[arena-monitor] success ping not delivered (timeout)"]);
});

test("HTTP error, refused connection and a throwing fetch: logged without the URL, never thrown", async () => {
  reset();
  mode = "500";
  const l = logger();
  assert.deepEqual(await monitorPing({ healthy: true, env: env(`${base}/ping/${TOKEN}`), log: l.log }), { sent: "success", failures: 0, ok: false, reason: "HTTP 500" });
  const closed = http.createServer();
  await new Promise<void>((r) => closed.listen(0, "127.0.0.1", r));
  const port = (closed.address() as AddressInfo).port;
  await new Promise((r) => closed.close(r));
  assert.equal((await monitorPing({ healthy: true, env: env(`http://127.0.0.1:${port}/ping/${TOKEN}`), log: l.log })).reason, "network error");
  const evil = (async () => { throw new TypeError(`Failed to parse URL from http://127.0.0.1/ping/${TOKEN}`); }) as unknown as typeof fetch;
  assert.equal((await monitorPing({ healthy: true, env: env(`${base}/ping/${TOKEN}`), fetchImpl: evil, log: l.log })).reason, "network error");
  assert.equal(l.lines.length, 3);
  for (const line of l.lines) assert.ok(!line.includes(TOKEN) && !line.includes("127.0.0.1"), line);
});

test("the real /api/arena/monitor route pings: healthy → success; 3 failing runs → /fail; recovery; unset → none", async () => {
  reset();
  const mongo = await MongoMemoryServer.create();
  const saved = { ...process.env };
  const prefix = `arena_wtmon_${process.pid}`;
  Object.assign(process.env, {
    CRON_SECRET: "monitor-test-cron-secret-0123", ARENA_MONGODB_URI: mongo.getUri(), ARENA_MONGODB_DB: `${prefix}_arena`, MONGODB_DB: `${prefix}_crm`,
    ARENA_MONITOR_PING_URL: `${base}/ping/${TOKEN}`,
  });
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  const opened: MongoClient[] = [];
  const realConnect = MongoClient.connect.bind(MongoClient);
  MongoClient.connect = (async (...a: Parameters<typeof MongoClient.connect>) => {
    const c = await realConnect(...a);
    opened.push(c);
    return c;
  }) as typeof MongoClient.connect;
  try {
    const { GET } = await import("../../app/api/arena/monitor/route.ts");
    const call = () => GET(new Request("https://app.test/api/arena/monitor", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
    const ok = await call();
    assert.equal(ok.status, 200, "no competition → healthy");
    assert.deepEqual(hits, [`GET /ping/${TOKEN}`]);
    // The run itself fails (Arena database misconfigured): counted in memory (no store reachable).
    process.env.ARENA_MONGODB_DB = "ag";
    for (let i = 0; i < 3; i++) assert.equal((await call()).status, 503);
    assert.deepEqual(hits.slice(1), [`GET /ping/${TOKEN}/fail`], "fail ping only on the 3rd failed run");
    process.env.ARENA_MONGODB_DB = `${prefix}_arena`;
    assert.equal((await call()).status, 200);
    assert.deepEqual(hits.slice(2), [`GET /ping/${TOKEN}`], "recovery ping");
    delete process.env.ARENA_MONITOR_PING_URL;
    hits = [];
    assert.equal((await call()).status, 200);
    assert.deepEqual(hits, [], "unset → no ping");
    // unauthenticated calls never ping
    process.env.ARENA_MONITOR_PING_URL = `${base}/ping/${TOKEN}`;
    assert.equal((await GET(new Request("https://app.test/api/arena/monitor"))).status, 401);
    assert.deepEqual(hits, []);
  } finally {
    MongoClient.connect = realConnect as typeof MongoClient.connect;
    for (const c of opened) await c.close().catch(() => {});
    await mongo.stop();
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
