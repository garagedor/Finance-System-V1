/* Structural guarantees for the Admin Control Center API, asserted on source:
   1. every handler is gated by an Arena permission before any Arena code runs;
   2. handlers that change state need an edit permission (two reviewed exceptions);
   3. no Arena route or module can write a CRM or finance collection. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const API = join(ROOT, "src", "app", "api", "arena");
const LIB = join(ROOT, "src", "lib", "arena");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const routes = walk(API).filter((f) => f.endsWith("route.ts"));
const rel = (f: string) => relative(API, f);

/** exported handler name → its source text up to the next export */
function handlers(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /export async function (GET|POST|PUT|PATCH|DELETE)\b/g;
  const hits = [...src.matchAll(re)];
  hits.forEach((m, i) => (out[m[1]] = src.slice(m.index!, hits[i + 1]?.index ?? src.length)));
  return out;
}

test("there are Arena admin routes to check", () => {
  assert.ok(routes.length >= 9, `found ${routes.length}`);
});

test("every handler goes through arenaRoute with an Arena permission", () => {
  for (const f of routes) {
    const hs = handlers(strip(readFileSync(f, "utf8")));
    assert.ok(Object.keys(hs).length > 0, `${rel(f)} exports no handler`);
    for (const [verb, body] of Object.entries(hs)) {
      assert.match(body, /return arenaRoute\("arena:(console:view|rules:edit|review:edit)"/, `${rel(f)} ${verb} is not gated`);
    }
  }
});

test("state-changing handlers need an edit permission, except the two reviewed cases", () => {
  // settings: identity-checked (env owner for init, settings owner for changes) inside the store.
  // preview: computes a read-only summary; it saves nothing.
  const reviewed = new Set(["admin/settings/route.ts POST", "admin/settings/route.ts PUT", "admin/preview/route.ts POST"]);
  for (const f of routes) {
    for (const [verb, body] of Object.entries(handlers(strip(readFileSync(f, "utf8"))))) {
      if (verb === "GET") continue;
      const key = `${rel(f)} ${verb}`;
      if (reviewed.has(key)) continue;
      assert.match(body, /arenaRoute\("arena:(rules|review):edit"/, `${key} changes state with a view permission`);
    }
  }
});

test("GET handlers never change state", () => {
  const writes = /\.(insertOne|insertMany|updateOne|updateMany|replaceOne|deleteOne|deleteMany|bulkWrite|findOneAnd\w+|drop\w*)\s*\(|resolveCase|confirmCase|rejectCase|reopenCase|scanForReview|syncDetected|createCompetition|saveTemplate|updateDraftRules|initSettings|updateSettings/;
  for (const f of routes) {
    const get = handlers(strip(readFileSync(f, "utf8"))).GET;
    if (get) assert.doesNotMatch(get, writes, `${rel(f)} GET writes`);
  }
});

test("the settings bootstrap is limited to the configured owner account", () => {
  const s = strip(readFileSync(join(API, "admin", "settings", "route.ts"), "utf8"));
  assert.match(s, /arenaOwnerFromEnv\(\)/);
  assert.match(s, /owner !== session\.userId/);
});

test("no Arena route or module writes a CRM or finance collection, or reaches the AI shadow table", () => {
  const files = [...routes, ...walk(LIB).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.includes("testing"))];
  const crmNames = "Job|Job_ai|Technician|Location|users|TechNameMapping|AiJobLink|JobStatus";
  const crmWrite = new RegExp(`collection\\(["'\`](${crmNames})["'\`]\\)\\s*\\.\\s*(insert|update|replace|delete|bulkWrite|findOneAnd|drop|createIndex)`);
  for (const f of files) {
    const s = strip(readFileSync(f, "utf8"));
    assert.doesNotMatch(s, crmWrite, `${f} writes a CRM collection`);
    assert.doesNotMatch(s, /finance_(ledger|ledger_entry|payout|dispute|refund|scanpay)/, `${f} references a financial collection`);
    assert.doesNotMatch(s, /\bcrmDb\s*\.\s*collection\([^)]*\)\s*\.\s*(insert|update|replace|delete|bulkWrite|findOneAnd|drop|createIndex)/, `${f} writes through the CRM handle`);
    if (!f.endsWith("job-source.ts")) assert.doesNotMatch(s, /["'`]Job_ai["'`]/, `${f} names the AI shadow table`);
  }
});

test("Arena collections are only ever created in the Arena database", () => {
  const store = strip(readFileSync(join(LIB, "mongo-store.ts"), "utf8"));
  for (const name of store.matchAll(/:\s*"(arena_[a-z_]+)"/g)) assert.ok(name[1].startsWith("arena_"));
  const svc = strip(readFileSync(join(LIB, "admin-service.ts"), "utf8"));
  assert.match(svc, /client\.db\(arenaDbName\(\)\)/, "the Arena database comes from arenaDbName()");
  assert.match(svc, /arenaStores\(arenaDb\)/, "stores are built on the Arena database");
});
