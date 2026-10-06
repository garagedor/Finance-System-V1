// Run with:  node --test --import ./scripts/test-register.mjs src/lib/session-version.test.ts
//
// session_version is what lets the authority end a session that has already
// been issued. These pin which changes must do that — above all, disabling an
// account, which today leaves the user working for up to seven days.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_SESSION_VERSION,
  invalidatingFields,
  roleEditInvalidates,
  sessionVersionOf,
  shouldBumpSessionVersion,
} from "./session-version.ts";
import type { RoleRecord } from "@/types/rbac";

/* ── Reading the version ──────────────────────────────────────────────── */

test("a user with no stored version is version 0", () => {
  // No migration writes the field to anyone; absent simply means nothing has
  // invalidated their sessions yet.
  assert.equal(sessionVersionOf({}), DEFAULT_SESSION_VERSION);
  assert.equal(sessionVersionOf(null), 0);
  assert.equal(sessionVersionOf(undefined), 0);
});

test("a stored version is used as-is", () => {
  assert.equal(sessionVersionOf({ session_version: 7 }), 7);
});

test("a malformed version reads as 0 rather than throwing", () => {
  assert.equal(sessionVersionOf({ session_version: Number.NaN }), 0);
  assert.equal(sessionVersionOf({ session_version: "3" as unknown as number }), 0);
});

/* ── Which changes end a session ──────────────────────────────────────── */

test("disabling an account invalidates its sessions", () => {
  // The defect being closed. Everything else here is consistency.
  assert.equal(shouldBumpSessionVersion({ active: false }), true);
});

test("re-enabling also bumps, because `active` is the field that changed", () => {
  assert.equal(shouldBumpSessionVersion({ active: true }), true);
});

test("a changed password ends other sessions", () => {
  assert.equal(shouldBumpSessionVersion({ password: "hash" }), true);
});

test("any change to what a session may do invalidates it", () => {
  for (const change of [
    { role_id: "role_x" },
    { extra_permissions: [] },
    { denied_permissions: [] },
    { type: "office" },
  ] as Parameters<typeof shouldBumpSessionVersion>[0][]) {
    assert.equal(shouldBumpSessionVersion(change), true, JSON.stringify(change));
  }
});

test("a display change does not invalidate anything", () => {
  // Signing someone out to rename them would be hostile.
  assert.equal(shouldBumpSessionVersion({ name: "New Name" }), false);
  assert.equal(shouldBumpSessionVersion({}), false);
});

test("the reason records which fields caused it", () => {
  const fields = invalidatingFields({ active: false, name: "x", role_id: "r" });
  assert.deepEqual(fields.sort(), ["active", "role_id"]);
});

/* ── Role edits fan out ───────────────────────────────────────────────── */

function role(permissions: string[]): RoleRecord {
  return { _id: "r1", key: "office", name: "Office", permissions } as unknown as RoleRecord;
}

test("removing a permission from a role invalidates its holders", () => {
  // Without this, an admin removing a permission changes nothing for anyone
  // already signed in — their token carries the old list.
  assert.equal(roleEditInvalidates(role(["a", "b"]), { permissions: ["a"] as never }), true);
});

test("adding a permission also invalidates, so the grant takes effect", () => {
  assert.equal(roleEditInvalidates(role(["a"]), { permissions: ["a", "b"] as never }), true);
});

test("reordering the same permissions invalidates nothing", () => {
  assert.equal(roleEditInvalidates(role(["a", "b"]), { permissions: ["b", "a"] as never }), false);
});

test("renaming a role invalidates nothing", () => {
  assert.equal(roleEditInvalidates(role(["a"]), { name: "Renamed" }), false);
});

/* ── Still inert ──────────────────────────────────────────────────────── */

const RBAC = readFileSync(join(import.meta.dirname, "rbac.ts"), "utf8");

test("the claim is carried but not yet enforced", () => {
  // Enforcement is the step that signs everyone out and is approved
  // separately. Until then this must change nobody's access.
  assert.ok(RBAC.includes("session_version"), "the claim must be read");
  const code = RBAC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.equal(
    /sessionVersion\s*[<>!=]/.test(code),
    false,
    "nothing may compare the version yet — that is step 4",
  );
});

test("login stamps the user's current version into the token", () => {
  const login = readFileSync(
    join(import.meta.dirname, "..", "app", "api", "login", "route.ts"),
    "utf8",
  );
  assert.ok(/session_version:\s*sessionVersionOf\(user\)/.test(login));
});
