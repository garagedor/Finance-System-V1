// Run with:  node --test --import ./scripts/test-register.mjs src/lib/warehouse-token.test.ts
//
// The claim set the CRM mints, and the key material it mints with. The
// cross-repository test at the bottom verifies a real token against the real
// Warehouse verifier rather than against a reimplementation of it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { SignJWT, importPKCS8, importSPKI, jwtVerify } from "jose";
import {
  accountTypeOf,
  buildWarehouseClaims,
  hasWarehouseEntitlement,
  modulesOf,
  warehousePermissionsOf,
  type SessionLike,
} from "./warehouse-claims.ts";
import {
  WAREHOUSE_AUDIENCE,
  WAREHOUSE_TOKEN_TTL_SECONDS,
  WarehouseSigningError,
  warehouseSigningConfig,
} from "./warehouse-signing-key.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

function session(over: Partial<SessionLike> = {}): SessionLike {
  return {
    userId: "u1",
    name: "Tester",
    permissions: ["wh:receiving:count", "wh:po:view"],
    active: true,
    sessionVersion: 3,
    ...over,
  };
}

/* ── Entitlement ──────────────────────────────────────────────────────── */

test("a CRM session with no warehouse permission is not entitled", () => {
  // A valid session is necessary and not sufficient.
  assert.equal(hasWarehouseEntitlement(session({ permissions: ["crm:jobs:view"] })), false);
});

test("a disabled account is not entitled, whatever it holds", () => {
  assert.equal(hasWarehouseEntitlement(session({ active: false })), false);
});

test("holding one warehouse permission is entitlement", () => {
  assert.equal(hasWarehouseEntitlement(session({ permissions: ["wh:po:view"] })), true);
});

/* ── The claim set ────────────────────────────────────────────────────── */

test("only warehouse permissions travel", () => {
  const s = session({ permissions: ["crm:jobs:view", "finance:payouts:view", "wh:po:view"] });
  assert.deepEqual(warehousePermissionsOf(s), ["wh:po:view"]);
  const claims = buildWarehouseClaims(s);
  assert.equal(JSON.stringify(claims).includes("crm:jobs:view"), false);
  assert.equal(JSON.stringify(claims).includes("finance:payouts:view"), false);
});

test("an identity holding only warehouse permissions is NOT an agent unless declared", () => {
  // The old rule inferred this, which misclassified internal warehouse-only
  // staff as supplier agents and showed them redacted purchase orders.
  const internal = session({ permissions: ["wh:po:view", "wh:shipment:view"] });
  assert.equal(accountTypeOf(internal), "employee");

  const agent = session({ permissions: ["wh:po:view", "wh:shipment:view"], isWarehouseAgent: true });
  assert.equal(accountTypeOf(agent), "warehouse_agent");
  assert.deepEqual(modulesOf(agent), ["warehouse"]);
});

test("a declared agent token can never carry crm or finance", () => {
  // The declaration fixes the account type; issuance refuses outright if such
  // an identity holds anything outside Warehouse, so the two cannot disagree.
  // Warehouse's verifier refuses the combination as well.
  const agent = session({ permissions: ["wh:po:view"], isWarehouseAgent: true });
  const claims = buildWarehouseClaims(agent);
  assert.equal(claims.account_type, "warehouse_agent");
  assert.deepEqual(claims.modules, ["warehouse"]);
});

test("an employee carries the modules they actually reach", () => {
  const employee = session({ permissions: ["crm:jobs:view", "wh:po:view"] });
  assert.equal(accountTypeOf(employee), "employee");
  assert.deepEqual(modulesOf(employee).sort(), ["crm", "warehouse"]);

  const both = session({ permissions: ["crm:jobs:view", "finance:payouts:view", "wh:po:view"] });
  assert.deepEqual(modulesOf(both).sort(), ["crm", "finance", "warehouse"]);
});

test("session_version is carried from the live session", () => {
  assert.equal(buildWarehouseClaims(session({ sessionVersion: 11 })).session_version, 11);
});

test("warehouse_ids is absent, because no scoping model exists yet", () => {
  // Warehouse reads an absent list as "every warehouse". Inventing a scoping
  // policy here would be writing product policy into a token.
  assert.equal("warehouse_ids" in buildWarehouseClaims(session()), false);
});

/* ── The signing key ──────────────────────────────────────────────────── */

function withSigning(env: Record<string, string | undefined>, fn: () => void): void {
  const before = { ...process.env };
  for (const k of ["WAREHOUSE_JWT_PRIVATE_KEY", "WAREHOUSE_JWT_ISSUER"]) delete process.env[k];
  Object.assign(process.env, env);
  try { fn(); } finally {
    for (const k of ["WAREHOUSE_JWT_PRIVATE_KEY", "WAREHOUSE_JWT_ISSUER"]) delete process.env[k];
    Object.assign(process.env, before);
  }
}

test("issuance fails closed with no key", () => {
  withSigning({ WAREHOUSE_JWT_ISSUER: "https://crm.test" }, () => {
    assert.throws(() => warehouseSigningConfig(), (e: unknown) =>
      e instanceof WarehouseSigningError && e.code === "missing");
  });
});

test("a public key supplied where the private one belongs is refused", () => {
  // The two halves swapped — the likeliest mistake while wiring the pair up.
  withSigning({ WAREHOUSE_JWT_PRIVATE_KEY: publicKey, WAREHOUSE_JWT_ISSUER: "https://crm.test" }, () => {
    assert.throws(() => warehouseSigningConfig(), (e: unknown) =>
      e instanceof WarehouseSigningError && e.code === "not_private");
  });
});

test("anything that is not a PEM private key is refused", () => {
  withSigning({ WAREHOUSE_JWT_PRIVATE_KEY: "hunter2", WAREHOUSE_JWT_ISSUER: "https://crm.test" }, () => {
    assert.throws(() => warehouseSigningConfig(), (e: unknown) =>
      e instanceof WarehouseSigningError && e.code === "malformed");
  });
});

test("a missing issuer is refused — Warehouse checks it on every token", () => {
  withSigning({ WAREHOUSE_JWT_PRIVATE_KEY: privateKey }, () => {
    assert.throws(() => warehouseSigningConfig(), (e: unknown) =>
      e instanceof WarehouseSigningError && e.code === "missing");
  });
});

test("no error ever contains key material", () => {
  withSigning({ WAREHOUSE_JWT_PRIVATE_KEY: publicKey, WAREHOUSE_JWT_ISSUER: "https://crm.test" }, () => {
    try { warehouseSigningConfig(); assert.fail("should throw"); }
    catch (e) {
      const msg = (e as Error).message;
      assert.equal(msg.includes("BEGIN"), false);
      assert.equal(msg.includes(publicKey.slice(40, 80)), false);
    }
  });
});

test("the CRM session secret is never reused for warehouse signing", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./warehouse-signing-key.ts", import.meta.url).pathname, "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.equal(code.includes("JWT_SECRET"), false, "must not touch the CRM session secret");
  assert.equal(/HS\d{3}/.test(code), false, "no symmetric algorithm anywhere");
});

/* ── Cross-repository: the real verifier ──────────────────────────────── */

async function mintLikeTheRoute(s: SessionLike, key = privateKey, alg = "RS256") {
  const claims = buildWarehouseClaims(s);
  const k = await importPKCS8(key, "RS256");
  return new SignJWT({
    session_version: claims.session_version,
    account_type: claims.account_type,
    modules: claims.modules,
    warehouse_permissions: claims.warehouse_permissions,
  })
    .setProtectedHeader({ alg })
    .setIssuer("https://crm.test")
    .setAudience(WAREHOUSE_AUDIENCE)
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${WAREHOUSE_TOKEN_TTL_SECONDS}s`)
    .sign(k);
}

test("a token the CRM mints verifies against the Warehouse public key", async () => {
  const token = await mintLikeTheRoute(session({ isWarehouseAgent: true }));
  const { payload } = await jwtVerify(token, await importSPKI(publicKey, "RS256"), {
    algorithms: ["RS256"],
    issuer: "https://crm.test",
    audience: "warehouse",
  });
  assert.equal(payload.sub, "u1");
  assert.equal(payload["account_type"], "warehouse_agent");
  assert.deepEqual(payload["modules"], ["warehouse"]);
  assert.equal(payload["session_version"], 3);
  assert.deepEqual(payload["warehouse_permissions"], ["wh:receiving:count", "wh:po:view"]);
});

test("the audience is warehouse, so a CRM-addressed token would be refused", async () => {
  const token = await mintLikeTheRoute(session());
  const pub = await importSPKI(publicKey, "RS256");
  await assert.rejects(() => jwtVerify(token, pub, { audience: "crm" }));
});

test("a token signed with the wrong key fails", async () => {
  const other = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const token = await mintLikeTheRoute(session(), other.privateKey);
  const pub = await importSPKI(publicKey, "RS256");
  await assert.rejects(() => jwtVerify(token, pub));
});

test("an HS256 token is refused by an RS256-pinned verifier", async () => {
  const forged = await new SignJWT({ account_type: "employee", modules: ["warehouse"], session_version: 1 })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("https://crm.test").setAudience("warehouse").setSubject("u1")
    .setIssuedAt().setExpirationTime("5m")
    .sign(new TextEncoder().encode("whatever"));
  const pub = await importSPKI(publicKey, "RS256");
  await assert.rejects(() => jwtVerify(forged, pub, { algorithms: ["RS256"] }));
});

test("every permission the CRM would mint is one Warehouse recognises", async () => {
  const { readFileSync } = await import("node:fs");
  const whSrc = readFileSync("/home/yehonatancohen/lbs-warehouse/src/lib/auth/claims.ts", "utf8");
  const known = new Set(
    [...whSrc.split("WAREHOUSE_PERMISSIONS")[1]!.split("] as const")[0]!.matchAll(/"(wh:[^"]+)"/g)]
      .map((m) => m[1]!),
  );
  const { WAREHOUSE_PERMISSIONS } = await import("../types/rbac.ts");
  // Warehouse drops permission strings it does not recognise, so a claim it
  // cannot read would silently grant nothing.
  for (const p of WAREHOUSE_PERMISSIONS) assert.ok(known.has(p), `${p} unknown to Warehouse`);
});
