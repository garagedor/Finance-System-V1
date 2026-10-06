// Run with:  node --test --import ./scripts/test-register.mjs src/lib/verify-auth.test.ts
//
// Every route under /api/verify/* reaches Supabase and most of them mutate it.
// Middleware proves there is a session; these prove the session may act.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { hasPermission } from "./rbac.ts";
import type { RbacSession } from "./rbac.ts";
import { VERIFY_READ, VERIFY_WRITE } from "./verify-auth.ts";

const API = join(import.meta.dirname, "..", "app", "api", "verify");

function routes(dir: string = API, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) routes(p, out);
    else if (name === "route.ts") out.push(p);
  }
  return out;
}

function session(over: Partial<RbacSession> = {}): RbacSession {
  return {
    userId: "u1",
    name: "Tester",
    type: "admin",
    permissions: [VERIFY_READ, VERIFY_WRITE],
    active: true,
    ...over,
  } as RbacSession;
}

/* ── The authorization decision ───────────────────────────────────────── */

test("an admin session may read and write", () => {
  assert.equal(hasPermission(session(), VERIFY_READ), true);
  assert.equal(hasPermission(session(), VERIFY_WRITE), true);
});

test("no session may do either", () => {
  assert.equal(hasPermission(null, VERIFY_READ), false);
  assert.equal(hasPermission(null, VERIFY_WRITE), false);
});

test("a technician with a valid session gains no access at all", () => {
  // The whole point of this work: holding a session is not holding permission.
  // A technician is signed in every day.
  const tech = session({ type: "technician", permissions: [] as RbacSession["permissions"] });
  assert.equal(hasPermission(tech, VERIFY_READ), false);
  assert.equal(hasPermission(tech, VERIFY_WRITE), false);
});

test("read permission does not confer write permission", () => {
  // This is the location-manager shape: the seeded role holds view and not
  // edit, so it must be able to look without being able to approve.
  const reader = session({
    type: "location-manager",
    permissions: [VERIFY_READ] as RbacSession["permissions"],
  });
  assert.equal(hasPermission(reader, VERIFY_READ), true);
  assert.equal(hasPermission(reader, VERIFY_WRITE), false);
});

test("a disabled account is refused even holding both permissions", () => {
  const disabled = session({ active: false });
  assert.equal(hasPermission(disabled, VERIFY_READ), false);
  assert.equal(hasPermission(disabled, VERIFY_WRITE), false);
});

/* ── Every route is gated, and gated before it does anything ──────────── */

const METHOD = /^export async function (GET|POST|PUT|PATCH|DELETE)\(/gm;

test("every handler under /api/verify is gated", () => {
  for (const file of routes()) {
    const src = readFileSync(file, "utf8");
    const rel = file.slice(file.indexOf("api/verify"));
    const handlers = [...src.matchAll(METHOD)].map((m) => m[1]);
    assert.ok(handlers.length > 0, `${rel} has no handlers?`);

    const gates = (src.match(/require(VerifyRead|VerifyWrite|BackfillAccess)\(\)/g) ?? []).length;
    assert.ok(
      gates >= handlers.length,
      `${rel}: ${handlers.length} handler(s) but ${gates} gate(s)`,
    );
  }
});

test("each gate runs before any client is built or any body is read", () => {
  for (const file of routes()) {
    const src = readFileSync(file, "utf8");
    const rel = file.slice(file.indexOf("api/verify"));

    for (const m of src.matchAll(METHOD)) {
      // The handler body, comments stripped so prose about the code is not
      // mistaken for the code.
      const after = src
        .slice(m.index!)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      const body = after.slice(0, after.indexOf("\nexport ") === -1 ? undefined : after.indexOf("\nexport "));

      const gateAt = body.search(/require(VerifyRead|VerifyWrite|BackfillAccess)\(\)/);
      assert.ok(gateAt > -1, `${rel} ${m[1]}: no gate`);

      for (const risky of ["getSupabaseServerClient", "getMongoClient", "req.json", "request.json"]) {
        const at = body.indexOf(risky);
        assert.ok(at === -1 || at > gateAt, `${rel} ${m[1]}: ${risky} runs before authorization`);
      }
    }
  }
});

test("no verify route keeps a hardcoded admin type check", () => {
  // RBAC can express every one of these actions, so a job title is a second
  // authority that would drift from the first.
  for (const file of routes()) {
    const src = readFileSync(file, "utf8");
    const rel = file.slice(file.indexOf("api/verify"));
    assert.equal(/type\s*!==?\s*['"]admin['"]/.test(src), false, `${rel} still checks user.type`);
  }
});

test("the helper demands the read permission for reads and the write one for writes", () => {
  const helper = readFileSync(join(import.meta.dirname, "verify-auth.ts"), "utf8");
  // Comments stripped: the file explains in prose that it has no admin
  // shortcut, and that sentence must not be read as one.
  const code = helper.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.match(helper, /VERIFY_READ\s*=\s*["']crm:verify_reports:view["']/);
  assert.match(helper, /VERIFY_WRITE\s*=\s*["']crm:verify_reports:edit["']/);
  assert.equal(/type\s*===\s*['"]admin['"]/.test(code), false, "no admin shortcut in the helper");
});
