// Run with:  node --test --import ./scripts/test-register.mjs src/lib/verify-access.test.ts
//
// Verify Reports is admin-only, and now says so in the RBAC vocabulary rather
// than by job title. These pin that the page, the navigation and the API all
// gate on the same permission, and that no seeded role other than Admin
// reaches it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clientHasPermission } from "./permissions-client.ts";
import { hasPermission } from "./rbac.ts";
import type { RbacSession } from "./rbac.ts";
import { VERIFY_READ, VERIFY_WRITE } from "./verify-auth.ts";
import { visibleGroups, CRM_NAV } from "../components/shell/nav-config.ts";

const LIB = import.meta.dirname;
const SEED = readFileSync(join(LIB, "rbac-seed.ts"), "utf8");
const PAGE = readFileSync(join(LIB, "..", "app", "verify-reports", "page.tsx"), "utf8");

/** The permissions the ADMIN role carries: everything. */
const adminUser = { permissions: [VERIFY_READ, VERIFY_WRITE] };
/** A Location Manager after this change: neither. */
const lmUser = { permissions: ["crm:jobs:view", "finance:tasks:view"] };

/* ── Page access ──────────────────────────────────────────────────────── */

test("an admin can open Verify", () => {
  assert.equal(clientHasPermission(adminUser, VERIFY_READ), true);
});

test("a location manager cannot open Verify", () => {
  assert.equal(clientHasPermission(lmUser, VERIFY_READ), false);
});

test("a signed-out visitor cannot open Verify", () => {
  assert.equal(clientHasPermission(null, VERIFY_READ), false);
  assert.equal(clientHasPermission(undefined, VERIFY_READ), false);
});

test("the page gates on the permission, not on an account type", () => {
  const code = PAGE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.equal(
    /user\.type\s*!==?\s*['"]admin['"]/.test(code),
    false,
    "the page must not gate on user.type",
  );
  assert.ok(code.includes("crm:verify_reports:view"), "it must gate on the permission");
});

/* ── Navigation ───────────────────────────────────────────────────────── */

function verifyLinkVisible(permissions: string[], isAdmin: boolean): boolean {
  return visibleGroups(CRM_NAV, permissions, isAdmin)
    .some((g) => g.items.some((i) => i.href === "/verify-reports"));
}

test("a location manager does not receive the Verify navigation entry", () => {
  assert.equal(verifyLinkVisible(lmUser.permissions, false), false);
});

test("an admin still receives it", () => {
  assert.equal(verifyLinkVisible(adminUser.permissions, false), true);
});

/* ── API ──────────────────────────────────────────────────────────────── */

function session(over: Partial<RbacSession> = {}): RbacSession {
  return {
    userId: "u1", name: "T", type: "location-manager",
    permissions: [] as RbacSession["permissions"], active: true, ...over,
  } as RbacSession;
}

test("a read without the view permission is refused", () => {
  assert.equal(hasPermission(session(), VERIFY_READ), false);
});

test("a write without the edit permission is refused, even holding view", () => {
  const viewer = session({ permissions: [VERIFY_READ] as RbacSession["permissions"] });
  assert.equal(hasPermission(viewer, VERIFY_WRITE), false);
});

/* ── The seeded roles ─────────────────────────────────────────────────── */

test("no seeded role template grants a verify permission", () => {
  // Admin reaches it through ALL_PERMISSIONS; every other seeded role — Office,
  // Bookkeeper, Location Manager, Simple — holds neither, by absence rather
  // than by an exclusion anyone has to remember.
  const code = SEED.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.equal(
    /["']crm:verify_reports:(view|edit)["']/.test(code),
    false,
    "no seed template may name a verify permission",
  );
});

test("the admin template is still the one that gets everything", () => {
  assert.ok(/key: SYSTEM_ROLE_KEYS\.admin[\s\S]{0,300}ALL_PERMISSIONS/.test(SEED));
});

test("the client helper is not a security boundary and has no imports", () => {
  const helper = readFileSync(join(LIB, "permissions-client.ts"), "utf8");
  assert.equal(/^\s*import\s/m.test(helper), false, "must stay importable from a client component");
});
