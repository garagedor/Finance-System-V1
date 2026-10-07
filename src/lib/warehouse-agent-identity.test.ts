// Run with:  node --test --import ./scripts/test-register.mjs src/lib/warehouse-agent-identity.test.ts
//
// Agent identity is DECLARED on the user record, not inferred from permissions.
// These pin both halves of why that changed: a declared agent holding anything
// outside Warehouse is refused rather than quietly demoted to employee (which
// is what turned financial redaction off), and an internal employee holding
// only warehouse permissions stays an employee rather than being treated as a
// supplier.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SignJWT, importSPKI, jwtVerify } from "jose";
import { mintWarehouseToken } from "./warehouse-mint.ts";
import { accountTypeOf, type SessionLike } from "./warehouse-claims.ts";
import { shouldBumpSessionVersion, invalidatingFields } from "./session-version.ts";
import { signSessionToken } from "./rbac.ts";
import type { RbacSession } from "./rbac.ts";
import { WAREHOUSE_ROLE_TEMPLATES } from "./warehouse-roles.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
process.env.WAREHOUSE_JWT_PRIVATE_KEY = privateKey;
process.env.WAREHOUSE_JWT_ISSUER = "https://crm.test";

const AGENT_BUNDLE = [...WAREHOUSE_ROLE_TEMPLATES.find((r) => r.name === "Warehouse Agent")!.permissions];

function rbac(over: Partial<RbacSession> = {}): RbacSession {
  return {
    userId: "u1", name: "Tester", type: "simple", permissions: [] as RbacSession["permissions"],
    active: true, sessionVersion: 0, isWarehouseAgent: false, ...over,
  } as RbacSession;
}
const agent = (perms: string[]) =>
  rbac({ permissions: perms as RbacSession["permissions"], isWarehouseAgent: true });

async function claimsOf(token: string) {
  const { payload } = await jwtVerify(token, await importSPKI(publicKey, "RS256"), {
    algorithms: ["RS256"], issuer: "https://crm.test", audience: "warehouse",
  });
  return payload;
}

/* ── 1. the happy path ────────────────────────────────────────────────── */

test("1. declared Agent holding only canonical warehouse permissions mints", async () => {
  const r = await mintWarehouseToken(agent(AGENT_BUNDLE));
  assert.equal(r.ok, true, r.ok ? "" : `refused: ${(r as { detail?: string }).detail}`);
  if (!r.ok) return;
  const c = await claimsOf(r.token);
  assert.equal(c["account_type"], "warehouse_agent");
  assert.deepEqual(c["modules"], ["warehouse"]);
  assert.deepEqual(c["warehouse_permissions"], AGENT_BUNDLE);
  // Not a stringified-payload check: `iss` is https://crm.test and legitimately
  // contains "crm". The claims that must be clean are modules and permissions.
  assert.deepEqual(c["modules"], ["warehouse"]);
  for (const p of c["warehouse_permissions"] as string[]) {
    assert.ok(p.startsWith("wh:"), `${p} is not a warehouse permission`);
  }
});

/* ── 2-5. contamination fails closed ──────────────────────────────────── */

for (const [n, contaminant] of [
  ["2", "crm:jobs:view"],
  ["3", "finance:payouts:view"],
  ["4", "system:users:edit"],
  ["5", "wh:dashboard:view"],       // non-canonical: looks like one, is not
] as const) {
  test(`${n}. declared Agent + ${contaminant} is REFUSED, not reclassified`, async () => {
    const r = await mintWarehouseToken(agent([...AGENT_BUNDLE, contaminant]));
    assert.equal(r.ok, false, "no token may be issued");
    if (r.ok) return;
    assert.equal(r.status, 403);
    assert.equal(r.reason, "agent_contaminated");
    assert.ok(r.detail.includes(contaminant), "the refusal must name what to remove");
    // Neither of the two silent outcomes the declaration exists to prevent:
    assert.equal(JSON.stringify(r).includes('"employee"'), false, "not reclassified");
  });
}

test("5b. a bogus permission is not silently dropped from the claim either", async () => {
  const r = await mintWarehouseToken(agent([...AGENT_BUNDLE, "totally:made:up"]));
  assert.equal(r.ok, false);
});

/* ── 6-8. employees stay employees ────────────────────────────────────── */

test("6. an undeclared employee holding ONLY warehouse permissions is an employee", async () => {
  const recv = WAREHOUSE_ROLE_TEMPLATES.find((r) => r.name === "Warehouse Receiving")!;
  const r = await mintWarehouseToken(rbac({ permissions: [...recv.permissions] as RbacSession["permissions"] }));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const c = await claimsOf(r.token);
  assert.equal(c["account_type"], "employee");
  assert.deepEqual(c["modules"], ["warehouse"]);
});

test("7. a CRM Admin with wh:admin is an employee, and wh:admin travels intact", async () => {
  const r = await mintWarehouseToken(
    rbac({ permissions: ["crm:jobs:view", "system:users:edit", "wh:admin"] as RbacSession["permissions"] }));
  assert.equal(r.ok, true, "an employee is never refused for holding CRM permissions");
  if (!r.ok) return;
  const c = await claimsOf(r.token);
  assert.equal(c["account_type"], "employee");
  assert.deepEqual((c["modules"] as string[]).sort(), ["crm", "warehouse"]);
  assert.deepEqual(c["warehouse_permissions"], ["wh:admin"]);
});

test("8. a session token predating the claim reads as employee", async () => {
  // Signed without the field at all, the way every live token was.
  const secret = new TextEncoder().encode("x".repeat(40));
  const old = await new SignJWT({ _id: "u1", name: "T", type: "simple", active: true, permissions: [] })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("7d").sign(secret);
  const payload = JSON.parse(
    Buffer.from(old.split(".")[1]!, "base64url").toString()) as Record<string, unknown>;
  assert.equal("warehouse_agent" in payload, false, "the old shape really has no claim");
  assert.equal(payload["warehouse_agent"] === true, false, "which readSession reads as false");

  const src = readFileSync(join(import.meta.dirname, "rbac.ts"), "utf8");
  assert.ok(src.includes("isWarehouseAgent: claims.warehouse_agent === true"),
    "readSession must default an absent claim to false, never to true");

  // And a freshly signed token carries it explicitly.
  process.env.JWT_SECRET = "x".repeat(40);
  const fresh = await signSessionToken({ name: "T", type: "simple", permissions: [], active: true });
  const p2 = JSON.parse(Buffer.from(fresh.split(".")[1]!, "base64url").toString());
  assert.equal(p2.warehouse_agent, false);
});

/* ── 9. the bump ──────────────────────────────────────────────────────── */

test("9. changing warehouse_agent invalidates existing sessions", () => {
  assert.equal(shouldBumpSessionVersion({ warehouse_agent: true }), true);
  assert.equal(shouldBumpSessionVersion({ warehouse_agent: false }), true);
  assert.deepEqual(invalidatingFields({ warehouse_agent: true }), ["warehouse_agent"]);
  assert.equal(shouldBumpSessionVersion({ name: "harmless rename" }), false);
});

/* ── 10. the Warehouse verifier is unchanged and still refuses ────────── */

test("10. the Warehouse verifier still refuses an agent token carrying CRM modules", () => {
  // Asserted against Warehouse's source rather than by importing it: its
  // modules resolve `@/` against its own tree, which this repo's test loader
  // maps to this one. The runtime assertion lives where it can actually run —
  // lbs-warehouse/src/lib/auth/verify.test.ts, "an agent token carrying CRM
  // modules is refused" — and this pins that the rule has not been removed or
  // weakened while the CRM authority changed around it.
  const dir = join(import.meta.dirname, "..", "..", "..", "lbs-warehouse", "src", "lib", "auth");
  const verify = readFileSync(join(dir, "verify.ts"), "utf8");
  const code = verify.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  assert.ok(
    code.includes('accountType === "warehouse_agent" && modules.some((m) => m !== "warehouse")'),
    "the verifier must still refuse an agent carrying any non-warehouse module");
  assert.ok(code.includes('throw new TokenError('),
    "…and must still throw rather than downgrade the identity");
  assert.ok(code.includes('const ALG = "RS256"') && code.includes("algorithms: [ALG]"),
    "RS256 must stay pinned — the verifier declares it once and pins the list to it");

  const spec = readFileSync(join(dir, "verify.test.ts"), "utf8");
  assert.ok(spec.includes("an agent token carrying CRM modules is refused"),
    "the runtime test for this must still exist in the Warehouse repo");
});

/* ── and the rule that made all of this necessary ─────────────────────── */

test("accountTypeOf reads the declaration and nothing else", () => {
  const perms = ["wh:po:view", "crm:jobs:view", "system:users:edit"];
  assert.equal(accountTypeOf({ name: "x", active: true, sessionVersion: 0, permissions: perms } as SessionLike), "employee");
  assert.equal(accountTypeOf({ name: "x", active: true, sessionVersion: 0, permissions: perms, isWarehouseAgent: true } as SessionLike), "warehouse_agent");
  assert.equal(accountTypeOf({ name: "x", active: true, sessionVersion: 0, permissions: [] } as SessionLike), "employee");
});
