// Run: npm test
//
// The session cookie must fit the browser's 4096-byte limit, or the browser
// drops it silently and the user loops back to the login page right after a
// successful login. These tests sign real tokens with the full catalog.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jwtVerify } from "jose";
import { PERMISSION_BY_KEY } from "@/types/rbac";
import { packPermissions, unpackPermissions, MAX_PACKED_PERMISSION_BYTES } from "./session-permissions.ts";
import { signSessionToken } from "./rbac.ts";

const ALL = Object.keys(PERMISSION_BY_KEY);
const COOKIE_LIMIT = 4096;
const SECRET = "x".repeat(40);
const sameSet = (a: readonly string[], b: readonly string[]) =>
  assert.deepEqual([...new Set(a)].sort(), [...new Set(b)].sort());

const sign = (permissions: string[]) => {
  process.env.JWT_SECRET = SECRET;
  return signSessionToken({
    _id: "665f1c2e9a1b2c3d4e5f6a7b",
    // A long name, to leave no margin for luck.
    name: "A Very Long Employee Display Name For Margin",
    type: "simple",
    role_id: "role_mtk0000000000000000",
    permissions: permissions as never,
    active: true,
    session_version: 12,
    warehouse_agent: true,
  });
};
const claimsOf = async (jwt: string) =>
  (await jwtVerify(jwt, new TextEncoder().encode(SECRET))).payload as Record<string, unknown>;

test("round-trips the full catalog exactly", () => {
  sameSet(unpackPermissions(packPermissions(ALL)), ALL);
});

test("round-trips subsets, duplicates, the empty list and ungroupable keys", () => {
  sameSet(unpackPermissions(packPermissions([])), []);
  sameSet(unpackPermissions(packPermissions(["crm:jobs:view", "crm:jobs:view", "wh:catalog:edit"])), ["crm:jobs:view", "wh:catalog:edit"]);
  sameSet(unpackPermissions(packPermissions(["solo", "a:b"])), ["solo", "a:b"]);
  for (let i = 0; i < ALL.length; i += 7) {
    const subset = ALL.filter((_, j) => j % 7 === i % 7 || j < i);
    sameSet(unpackPermissions(packPermissions(subset)), subset);
  }
});

test("a full-permission session cookie fits the browser limit, with headroom", async () => {
  const jwt = await sign(ALL);
  const cookieBytes = `session=${jwt}`.length;
  assert.ok(cookieBytes < COOKIE_LIMIT - 1000, `cookie is ${cookieBytes} bytes`);
});

test("the token carries the packed form, and it decodes to the same permissions", async () => {
  const claims = await claimsOf(await sign(ALL));
  assert.equal(claims.permissions, undefined);
  assert.equal(typeof claims.perms, "string");
  sameSet(unpackPermissions(claims.perms as string), ALL);
  // Everything else on the token is unchanged.
  assert.equal(claims.session_version, 12);
  assert.equal(claims.warehouse_agent, true);
  assert.equal(claims.role_id, "role_mtk0000000000000000");
});

test("past the cap, permissions are left out (DB fallback) and the cookie still fits", async () => {
  const huge = Array.from({ length: 400 }, (_, i) => `module${i}:section${i}:view`);
  assert.ok(packPermissions(huge).length > MAX_PACKED_PERMISSION_BYTES);
  const jwt = await sign(huge);
  const claims = await claimsOf(jwt);
  assert.equal(claims.perms, undefined);
  assert.equal(claims.permissions, undefined);
  assert.ok(`session=${jwt}`.length < COOKIE_LIMIT);
});

test("the cap itself keeps any token under the browser limit", () => {
  // Packed permissions are base64url-encoded inside the JWT (×4/3); the rest
  // of the claims, header and signature are well under 700 bytes.
  assert.ok(Math.ceil(MAX_PACKED_PERMISSION_BYTES * 4 / 3) + 700 < COOKIE_LIMIT);
});

test("readSession accepts the packed form AND the old array form", () => {
  const RBAC = readFileSync(join(import.meta.dirname, "rbac.ts"), "utf8");
  assert.match(RBAC, /typeof claims\.perms === "string"\s*\?\s*\(unpackPermissions\(claims\.perms\)/);
  // Sessions issued before this change keep working until they expire.
  assert.match(RBAC, /: Array\.isArray\(claims\.permissions\) \? claims\.permissions : undefined/);
  // And a token with neither still resolves from the database.
  assert.match(RBAC, /if \(!permissions\) \{\s*permissions = await computeEffectivePermissions/);
});
