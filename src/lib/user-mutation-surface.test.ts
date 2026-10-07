// Run with:  node --test --import ./scripts/test-register.mjs src/lib/user-mutation-surface.test.ts
//
// There must be exactly ONE path that writes a user's security state.
//
// The legacy /api/users route wrote `$set: { ...body }` through a generic CRUD
// helper, so it could set arbitrary permission strings, flip role_id, type and
// active, and even lower session_version to revive a token that should be dead
// — none of it validated, none of it invalidating a session, none audited.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PROFILE_FIELDS,
  SECURITY_FIELDS,
  refuseNonProfileFields,
} from "../app/api/users/route.ts";
import { shouldBumpSessionVersion, invalidatingFields } from "./session-version.ts";
import { PERMISSION_BY_KEY, isWarehousePermission } from "../types/rbac.ts";

const ROOT = join(import.meta.dirname, "..");
const LEGACY = readFileSync(join(ROOT, "app", "api", "users", "route.ts"), "utf8");
const CANON = readFileSync(join(ROOT, "app", "api", "portal", "admin", "users", "route.ts"), "utf8");
const SCREEN = readFileSync(join(ROOT, "app", "admin", "users", "page.tsx"), "utf8");
const strip = (s: string) => s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

const refused = (body: Record<string, unknown>) => refuseNonProfileFields(body) !== null;

/* ── 1-3. the legacy door no longer writes security state ─────────────── */

test("1. /api/users cannot write arbitrary extra_permissions", () => {
  assert.equal(refused({ _id: "u1", extra_permissions: ["wh:admin"] }), true);
  assert.equal(refused({ _id: "u1", extra_permissions: ["totally:made:up"] }), true);
});

test("2. /api/users cannot write arbitrary denied_permissions", () => {
  assert.equal(refused({ _id: "u1", denied_permissions: ["crm:jobs:view"] }), true);
});

test("3. /api/users cannot write warehouse_agent", () => {
  assert.equal(refused({ _id: "u1", warehouse_agent: true }), true);
  assert.ok(SECURITY_FIELDS.has("warehouse_agent"));
});

test("…nor any other security-sensitive field, each named in the refusal", async () => {
  for (const f of ["active", "password", "role_id", "type", "session_version",
                   "totp_secret", "totp_enabled", "totp_backup_codes"]) {
    const res = refuseNonProfileFields({ _id: "u1", [f]: "x" });
    assert.ok(res, `${f} must be refused`);
    const body = await res!.json();
    assert.equal(res!.status, 400);
    assert.ok(body.detail.includes(f), `the refusal must name ${f}`);
    assert.ok(body.detail.includes("/api/portal/admin/users"), "and point at the canonical path");
  }
});

test("an unknown field is refused too — not dropped silently", async () => {
  const res = refuseNonProfileFields({ _id: "u1", is_superuser: true });
  assert.ok(res);
  assert.deepEqual((await res!.json()).unknown_fields, ["is_superuser"]);
});

/* ── 6. legitimate profile edits still work ───────────────────────────── */

test("6. a profile-only edit is still accepted", () => {
  assert.equal(refused({ _id: "u1", name: "New Name" }), false);
  assert.equal(refused({ _id: "u1", name: "N", email: "a@b.c" }), false);
  assert.equal(refused({ _id: "u1", notification_prefs: { x: true } }), false);
  for (const f of ["name", "email", "notification_prefs"]) assert.ok(PROFILE_FIELDS.has(f));
});

test("the two sets do not overlap", () => {
  for (const f of PROFILE_FIELDS) assert.equal(SECURITY_FIELDS.has(f), false, `${f} in both`);
});

/* ── 7. authorization is unchanged ────────────────────────────────────── */

test("7. every legacy verb still requires its permission before anything else", () => {
  const code = strip(LEGACY);
  assert.ok(code.includes("gate('system:users:edit')"), "PUT still gated");
  assert.ok(code.includes("gate('system:users:create')"), "POST still gated");
  assert.ok(code.includes("gate('system:users:view')"), "GET still gated");
  // the gate precedes the body in PUT
  const put = code.slice(code.indexOf("export const PUT"));
  assert.ok(put.indexOf("gate('system:users:edit')") < put.indexOf("request.clone().json()"));
});

/* ── 4-5. the canonical path is the one that validates and invalidates ── */

test("4. security-sensitive changes bump session_version on the canonical path", () => {
  for (const f of ["active", "password", "role_id", "type",
                   "extra_permissions", "denied_permissions", "warehouse_agent"]) {
    assert.equal(shouldBumpSessionVersion({ [f]: "x" } as never), true, `${f} must invalidate`);
  }
  assert.deepEqual(invalidatingFields({ active: false } as never), ["active"]);
  // profile fields must NOT invalidate
  assert.equal(shouldBumpSessionVersion({ name: "x" } as never), false);
  assert.equal(shouldBumpSessionVersion({ email: "a@b.c" } as never), false);
  assert.ok(CANON.includes("bumpSessionVersion(body._id"), "the PATCH actually calls it");
});

test("5. bogus warehouse permissions cannot be persisted by the canonical path", () => {
  // sanitisePermissions filters on PERMISSION_BY_KEY, so a string that merely
  // looks like a warehouse permission never reaches the document.
  assert.equal(PERMISSION_BY_KEY["wh:dashboard:view"], undefined);
  assert.equal(isWarehousePermission("wh:dashboard:view"), false);
  assert.ok(PERMISSION_BY_KEY["wh:catalog:view"], "a real one still resolves");
  const code = strip(CANON);
  assert.ok(code.includes("set.extra_permissions = sanitisePermissions("));
  assert.ok(code.includes("set.denied_permissions = sanitisePermissions("));
  assert.ok(/if \(!PERMISSION_BY_KEY\[raw\]\) continue;/.test(code),
    "sanitisePermissions must still filter on the catalog");
});

/* ── 8. no second weaker path remains ─────────────────────────────────── */

test("8. the legacy screen performs no mutation through /api/users", () => {
  const code = strip(SCREEN);
  const calls = [...code.matchAll(/fetch\(\s*[`'"]([^`'"]*\/api\/users[^`'"]*)[`'"][\s\S]{0,120}?method:\s*'(\w+)'/g)];
  for (const [, url, method] of calls) {
    assert.fail(`the screen still calls ${method} ${url} — use /api/portal/admin/users`);
  }
  assert.ok(code.includes("'/api/portal/admin/users'"), "it uses the canonical path");
});

test("8b. the legacy route no longer reaches generic CRUD for writes", () => {
  const code = strip(LEGACY);
  assert.equal(code.includes("handlers.POST"), false, "create must be refused outright");
  assert.equal(code.includes("handlers.DELETE"), false, "delete must be refused outright");
  // PUT still uses it, but only after the allowlist has run.
  const put = code.slice(code.indexOf("export const PUT"), code.indexOf("export const DELETE"));
  assert.ok(put.indexOf("refuseNonProfileFields") < put.indexOf("handlers.PUT"),
    "the allowlist must run before the generic handler");
});

test("8c. only the canonical route writes permissions, roles or the agent flag", () => {
  for (const [name, src] of [["legacy", LEGACY]] as const) {
    const code = strip(src);
    assert.equal(/sanitisePermissions|bumpSessionVersion/.test(code), false,
      `${name} must not reimplement canonical RBAC rules`);
  }
  assert.ok(CANON.includes("sanitisePermissions"));
  assert.ok(CANON.includes("bumpSessionVersion"));
});
