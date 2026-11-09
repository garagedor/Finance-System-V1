/* Technician API structure and the middleware exemption:
   1. every technician route handler is the pass guard (or the exchange / CORS preflight);
   2. the technician glue never reads cookies or the CRM session;
   3. the middleware exempts EXACTLY the six technician paths — every other /api
      route still answers 401 to an anonymous request. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const API_ROOT = join(ROOT, "src", "app", "api");
const ARENA = join(API_ROOT, "arena");
const TECH_LIB = join(ROOT, "src", "lib", "arena", "tech");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const strip = (s: string) => s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
function handlers(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  const hits = [...src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE|OPTIONS)\b/g)];
  hits.forEach((m, i) => (out[m[1]] = src.slice(m.index!, hits[i + 1]?.index ?? src.length)));
  return out;
}

// Operations endpoints (scheduler, no session): exact paths, cron secret / admin session in-route (live-health.test.ts).
const OPS_PATHS = ["/api/arena/health", "/api/arena/monitor"];
const TECH_PATHS = ["/api/arena/auth/exchange", "/api/arena/tech/me", "/api/arena/tech/leaderboard", "/api/arena/tech/history", "/api/arena/tech/events", "/api/arena/tech/live"];
const techRoutes = [...walk(join(ARENA, "tech")), ...walk(join(ARENA, "auth"))].filter((f) => f.endsWith("route.ts"));

test("the technician routes are exactly the six contract endpoints", () => {
  const paths = techRoutes.map((f) => "/api/" + relative(API_ROOT, f).split(sep).slice(0, -1).join("/")).sort();
  assert.deepEqual(paths, [...TECH_PATHS].sort());
});

test("every technician GET is the Arena-pass guard; exchange and preflight use their wrappers", () => {
  for (const f of techRoutes) {
    const hs = handlers(strip(readFileSync(f, "utf8")));
    const isExchange = f.includes(`${sep}auth${sep}exchange${sep}`);
    assert.deepEqual(Object.keys(hs).sort(), isExchange ? ["OPTIONS", "POST"] : ["GET", "OPTIONS"], f);
    if (isExchange) assert.match(hs.POST, /^export async function POST\(req: Request\) \{\s*return exchangeRoute\(req\);\s*\}\s*$/);
    else assert.match(hs.GET, /^export async function GET\(req: Request\) \{\s*return techRoute\(req, async \(/, f);
    assert.match(hs.OPTIONS, /return techPreflight\(req\);/, f);
  }
});

test("the technician API never reads cookies or a CRM session", () => {
  const files = [...techRoutes, ...walk(TECH_LIB).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))];
  for (const f of files) {
    const s = strip(readFileSync(f, "utf8"));
    assert.doesNotMatch(s, /cookies\s*\(|\.cookies\b|readSession|requirePermission|jwtSecret|@\/lib\/rbac/, f);
    assert.doesNotMatch(s, /Access-Control-Allow-Credentials/, f);
  }
});

test("the middleware exemption is an exact-path set, not a prefix", () => {
  const mw = strip(readFileSync(join(ROOT, "src", "middleware.ts"), "utf8"));
  const set = /const ARENA_PASS_ROUTES = new Set\(\[([\s\S]*?)\]\)/.exec(mw);
  assert.ok(set, "ARENA_PASS_ROUTES missing");
  assert.deepEqual([...set[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort(), [...TECH_PATHS].sort());
  assert.match(mw, /ARENA_PASS_ROUTES\.has\(request\.nextUrl\.pathname\)/);
  assert.doesNotMatch(mw, /'\/api\/arena[^']*'\s*\]/, "no /api/arena prefix in the exempt-prefix list");
  const ops = /const ARENA_OPS_ROUTES = new Set\(\[([\s\S]*?)\]\)/.exec(mw);
  assert.ok(ops, "ARENA_OPS_ROUTES missing");
  assert.deepEqual([...ops[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort(), [...OPS_PATHS].sort());
  assert.match(mw, /ARENA_OPS_ROUTES\.has\(request\.nextUrl\.pathname\)/);
});

async function anonymous(path: string) {
  const { NextRequest } = await import("next/server");
  const { middleware } = await import("../../middleware.ts");
  return middleware(new NextRequest(new URL("https://app.test" + path), {}));
}

// Exemptions that existed before the Arena (each authenticates itself).
const PRE_EXISTING = ["/api/login", "/api/logout", "/api/scanpay/webhook", "/api/scanpay/cron-sync", "/api/cron/job-mirror-resync", "/api/ai-jobs/ingest", "/api/ai-jobs/jobs", "/api/internal/auth/session-state"];

test("the five technician paths pass the middleware without a CRM session", async () => {
  for (const p of TECH_PATHS) assert.notEqual((await anonymous(p)).status, 401, p);
});

test("the two ops paths pass the middleware (they authenticate in-route)", async () => {
  for (const p of OPS_PATHS) assert.notEqual((await anonymous(p)).status, 401, p);
});

test("NO other /api route becomes reachable without a CRM session", async () => {
  const all = walk(API_ROOT)
    .filter((f) => f.endsWith("route.ts"))
    .map((f) => "/api/" + relative(API_ROOT, f).split(sep).slice(0, -1).map((seg) => seg.replace(/^\[+\.*([^\]]+)\]+$/, "x-$1")).join("/"));
  assert.ok(all.length > 50);
  let checked = 0;
  for (const p of all) {
    if (TECH_PATHS.includes(p) || OPS_PATHS.includes(p) || PRE_EXISTING.some((e) => p.startsWith(e))) continue;
    assert.equal((await anonymous(p)).status, 401, `${p} must still require a session`);
    checked++;
  }
  assert.ok(checked > 50);
  const lookalikes = [
    "/api/arena/tech", "/api/arena/tech/", "/api/arena/tech/me/", "/api/arena/tech/me/x", "/api/arena/tech/meX",
    "/api/arena/techx/me", "/api/arena/auth", "/api/arena/auth/exchange/x", "/api/arena/auth/exchange2",
    "/api/arena/admin/overview", "/api/arena/admin/competitions/arena_2026-10-26/approve", "/api/arena", "/api/arena/tech/../admin/overview",
    "/api/arena/health/", "/api/arena/health/x", "/api/arena/healthz", "/api/arena/monitor/x", "/api/arena/monitorx",
  ];
  for (const p of lookalikes) assert.equal((await anonymous(p)).status, 401, `${p} must still require a session`);
});
