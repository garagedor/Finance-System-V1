// Run with:  node --test src/lib/verify-backfill-auth.test.ts   (Node 24+, strips types)
//
// Guards the authorization boundary of POST /api/verify/backfill-lm, which
// previously verified the session cookie against a signing secret written as a
// literal in its own source file.
//
// The properties below are what makes that fixed: the route trusts the same
// authority as the rest of the application, a token minted with the old string
// is not that authority, and the gate runs before any request parameter is
// read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SignJWT, jwtVerify } from "jose";
import { hasPermission } from "./rbac.ts";
import type { RbacSession } from "./rbac.ts";

const OLD_DEV_STRING = "super-secret-key-for-development";
const PERMISSION = "crm:verify_reports:edit" as const;

const ROUTE = join(
  import.meta.dirname,
  "..",
  "app",
  "api",
  "verify",
  "backfill-lm",
  "route.ts",
);
const source = readFileSync(ROUTE, "utf8");

function session(over: Partial<RbacSession> = {}): RbacSession {
  return {
    userId: "u1",
    name: "Tester",
    type: "admin",
    permissions: [PERMISSION],
    active: true,
    ...over,
  } as RbacSession;
}

/* ── 1. A token minted with the old public string is not a session ─────── */

test("a token signed with the old dev string does not verify against a real secret", async () => {
  const forged = await new SignJWT({ type: "admin", name: "Mallory", active: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(OLD_DEV_STRING));

  const realSecret = new TextEncoder().encode("a-real-configured-secret-value");
  await assert.rejects(() => jwtVerify(forged, realSecret));
});

test("the route no longer contains its own verifier or any signing material", async () => {
  // The whole defect was that this file decided for itself what a valid
  // session is. It must not do that again.
  assert.equal(source.includes(OLD_DEV_STRING), false, "the literal must be gone");
  assert.equal(/jwtVerify/.test(source), false, "the route must not verify tokens itself");
  assert.equal(/TextEncoder\(\)\.encode\(/.test(source), false, "no signing material in this file");
  assert.ok(/readSession/.test(source), "it must use the shared session authority");
});

/* ── 2–4. The authorization decision ───────────────────────────────────── */

test("a real admin session is accepted", () => {
  // The Admin role is seeded with every permission, so the previous admin-only
  // requirement still holds — expressed as the thing being protected.
  assert.equal(hasPermission(session(), PERMISSION), true);
});

test("a signed-in user without the permission is rejected", () => {
  const tech = session({ type: "technician", permissions: ["crm:verify_reports:view"] as RbacSession["permissions"] });
  assert.equal(hasPermission(tech, PERMISSION), false);
});

test("a disabled account is rejected even holding the permission", () => {
  assert.equal(hasPermission(session({ active: false }), PERMISSION), false);
});

test("no session is rejected", () => {
  assert.equal(hasPermission(null, PERMISSION), false);
});

/* ── 5. dryRun cannot influence whether the request is authorized ──────── */

/** The handler with comments removed, so prose about the code is not mistaken
 *  for the code. */
const postBody = source
  .slice(source.indexOf("export async function POST"))
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");

test("the gate runs before any request parameter is read", () => {
  const gateAt = postBody.indexOf("requireBackfillAccess");
  const dryRunAt = postBody.indexOf("const dryRun");
  const searchParamsAt = postBody.indexOf("searchParams");

  assert.ok(gateAt > -1, "the handler must call the gate");
  assert.ok(dryRunAt > gateAt, "dryRun must be read after authorization");
  assert.ok(searchParamsAt > gateAt, "no parameter may be read before authorization");
});

test("the handler refuses before it reaches Supabase or Mongo", () => {
  const gateAt = postBody.indexOf("requireBackfillAccess");
  for (const call of ["getSupabaseServerClient", "getMongoClient", "isSupabaseConfigured"]) {
    const at = postBody.indexOf(call);
    assert.ok(at === -1 || at > gateAt, `${call} must not run before authorization`);
  }
});
