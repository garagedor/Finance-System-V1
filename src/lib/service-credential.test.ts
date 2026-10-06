// Run with:  node --test --import ./scripts/test-register.mjs src/lib/service-credential.test.ts
//
// The credential Warehouse presents when it asks the CRM about a session. It
// authenticates one application to another and carries no user identity.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SERVICE_TOKEN_ENV, authenticateService, hasServiceCredential } from "./service-credential.ts";

const GOOD = "a".repeat(48);

function withToken(value: string | undefined, fn: () => void): void {
  const before = process.env[SERVICE_TOKEN_ENV];
  if (value === undefined) delete process.env[SERVICE_TOKEN_ENV];
  else process.env[SERVICE_TOKEN_ENV] = value;
  try { fn(); } finally {
    if (before === undefined) delete process.env[SERVICE_TOKEN_ENV];
    else process.env[SERVICE_TOKEN_ENV] = before;
  }
}

const req = (headers: Record<string, string> = {}) =>
  new Request("https://crm.test/api/internal/auth/session-state", { method: "POST", headers });

/* ── Fails closed ─────────────────────────────────────────────────────── */

test("an unconfigured deployment refuses rather than accepting anything", () => {
  withToken(undefined, () => {
    const r = authenticateService(req({ authorization: `Bearer ${GOOD}` }));
    assert.deepEqual(r, { ok: false, status: 503, reason: "not_configured" });
  });
});

test("a credential too short to be a secret counts as unconfigured", () => {
  // Stops a placeholder like "changeme" from quietly becoming the credential.
  withToken("short", () => {
    assert.equal(authenticateService(req({ authorization: "Bearer short" })).ok, false);
  });
});

/* ── Rejects everything that is not the credential ────────────────────── */

test("no Authorization header is rejected", () => {
  withToken(GOOD, () => {
    assert.deepEqual(authenticateService(req()), { ok: false, status: 401, reason: "missing" });
  });
});

test("a wrong credential is rejected", () => {
  withToken(GOOD, () => {
    const r = authenticateService(req({ authorization: `Bearer ${"b".repeat(48)}` }));
    assert.deepEqual(r, { ok: false, status: 401, reason: "invalid" });
  });
});

test("a credential of the wrong length is rejected without throwing", () => {
  // timingSafeEqual throws on a length mismatch, and that throw would itself
  // be an oracle.
  withToken(GOOD, () => {
    assert.equal(authenticateService(req({ authorization: "Bearer short" })).ok, false);
    assert.equal(authenticateService(req({ authorization: `Bearer ${"a".repeat(200)}` })).ok, false);
  });
});

test("a session cookie is not a service credential", () => {
  // A user, however privileged, is not Warehouse.
  withToken(GOOD, () => {
    assert.equal(authenticateService(req({ cookie: `session=${GOOD}` })).ok, false);
  });
});

test("a non-Bearer scheme is rejected", () => {
  withToken(GOOD, () => {
    assert.equal(authenticateService(req({ authorization: `Basic ${GOOD}` })).ok, false);
  });
});

/* ── Accepts the credential ───────────────────────────────────────────── */

test("the right credential is accepted, and the scheme is case-insensitive", () => {
  withToken(GOOD, () => {
    assert.deepEqual(authenticateService(req({ authorization: `Bearer ${GOOD}` })), { ok: true });
    assert.deepEqual(authenticateService(req({ authorization: `bearer ${GOOD}` })), { ok: true });
  });
});

test("hasServiceCredential reports presence without authenticating anything", () => {
  withToken(undefined, () => assert.equal(hasServiceCredential(), false));
  withToken("tooshort", () => assert.equal(hasServiceCredential(), false));
  withToken(GOOD, () => assert.equal(hasServiceCredential(), true));
});

/* ── It is not any other secret ───────────────────────────────────────── */

test("the credential is dedicated — no other secret is reachable from here", () => {
  const src = readFileSync(new URL("./service-credential.ts", import.meta.url).pathname, "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const other of ["JWT_SECRET", "WAREHOUSE_JWT_PRIVATE_KEY", "AI_INGEST_TOKEN", "CRON_SECRET"]) {
    assert.equal(code.includes(other), false, `must not reference ${other}`);
  }
});

/* ── The endpoint says only what it must ──────────────────────────────── */

const ROUTE = readFileSync(
  new URL("../app/api/internal/auth/session-state/route.ts", import.meta.url).pathname,
  "utf8",
);

test("the response carries no user data beyond liveness", () => {
  const code = ROUTE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const leaky of ["permissions", "role_id", "password", "email", "name", "type"]) {
    assert.equal(
      new RegExp(`\\b${leaky}\\b`).test(code),
      false,
      `the endpoint must not mention ${leaky}`,
    );
  }
});

test("the credential is checked before the body is read", () => {
  const body = ROUTE.slice(ROUTE.indexOf("export async function POST"));
  const authAt = body.indexOf("authenticateService");
  const jsonAt = body.indexOf("req.json");
  assert.ok(authAt > -1 && jsonAt > authAt, "authenticate first, then parse");
});

test("only POST is answered", () => {
  assert.ok(/export function GET\(\)/.test(ROUTE));
  assert.ok(/method_not_allowed/.test(ROUTE));
});

test("middleware exempts the route, because it authenticates itself", () => {
  const mw = readFileSync(new URL("../middleware.ts", import.meta.url).pathname, "utf8");
  assert.ok(mw.includes("/api/internal/auth/session-state"),
    "without this the cookie gate would 401 Warehouse before the route ran");
});
