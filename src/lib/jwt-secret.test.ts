// Run with:  node --test --import ./scripts/test-register.mjs src/lib/jwt-secret.test.ts
//
// The session secret must fail closed. A default secret is a published secret,
// and one that silently substitutes itself turns a configuration mistake into
// an open door rather than an outage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MissingJwtSecretError, hasJwtSecret, jwtSecret, __resetJwtSecretCache } from "./jwt-secret.ts";

function withEnv(value: string | undefined, fn: () => void): void {
  const before = process.env.JWT_SECRET;
  if (value === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = value;
  __resetJwtSecretCache();
  try {
    fn();
  } finally {
    if (before === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = before;
    __resetJwtSecretCache();
  }
}

test("a configured secret is returned as key material", () => {
  withEnv("a-real-configured-secret", () => {
    const k = jwtSecret();
    assert.ok(k instanceof Uint8Array);
    assert.ok(k.length > 0);
  });
});

test("an absent secret throws rather than substituting one", () => {
  withEnv(undefined, () => {
    assert.throws(() => jwtSecret(), MissingJwtSecretError);
  });
});

test("a blank secret counts as absent", () => {
  withEnv("   ", () => {
    assert.throws(() => jwtSecret(), MissingJwtSecretError);
  });
});

test("the failure names the variable, so an operator knows what to set", () => {
  withEnv(undefined, () => {
    try {
      jwtSecret();
      assert.fail("should have thrown");
    } catch (e) {
      assert.match((e as Error).message, /JWT_SECRET/);
    }
  });
});

test("hasJwtSecret reports presence without throwing", () => {
  withEnv(undefined, () => assert.equal(hasJwtSecret(), false));
  withEnv("x", () => assert.equal(hasJwtSecret(), true));
});

/* ── The properties that keep this usable from the Edge runtime ───────── */

const SRC = readFileSync(join(import.meta.dirname, "jwt-secret.ts"), "utf8");

test("the module has no imports at all", () => {
  // middleware.ts runs on the Edge runtime and uses this. An import added here
  // — server-only, a Node built-in, anything reaching Mongo — would break
  // authentication for every request on the site.
  assert.equal(/^\s*import\s/m.test(SRC), false, "jwt-secret.ts must stay import-free");
});

test("no fallback value exists anywhere in the module", () => {
  assert.equal(/\?\?/.test(SRC), false, "no ?? fallback");
  assert.equal(/\|\|\s*["'`]/.test(SRC), false, "no || default string");
  assert.equal(SRC.includes("super-secret"), false);
});

/* ── Nothing else resolves the secret for itself ──────────────────────── */

test("rbac and middleware both resolve the secret through this module", () => {
  const dir = join(import.meta.dirname, "..");
  for (const rel of ["lib/rbac.ts", "middleware.ts"]) {
    const src = readFileSync(join(dir, rel), "utf8");
    assert.ok(/jwtSecret\(\)/.test(src), `${rel} must call jwtSecret()`);
    assert.equal(
      /process\.env\.JWT_SECRET\s*\?\?/.test(src),
      false,
      `${rel} must not keep a fallback`,
    );
    assert.equal(src.includes("super-secret"), false, `${rel} must not contain the old string`);
  }
});

test("middleware imports nothing that would leave the Edge runtime", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "middleware.ts"), "utf8");
  const imports = [...src.matchAll(/^import\s[\s\S]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  const allowed = new Set(["next/server", "jose", "@/lib/jwt-secret"]);
  for (const i of imports) {
    assert.ok(allowed.has(i!), `middleware must not import ${i} — Edge runtime`);
  }
});
