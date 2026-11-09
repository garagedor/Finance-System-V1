// Startup self-check: dangerous technician configurations refuse to start the
// technician endpoints (fail closed), and the safe production shape passes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { techEnvProblems, isDeployed } from "./self-check.ts";
import { readTechConfig, ArenaTechConfigError } from "./config.ts";

const URL_ = "https://abcdefghijklmnopqrst.supabase.co";
const PROD = {
  VERCEL: "1", VERCEL_ENV: "production", NODE_ENV: "production",
  ARENA_TECH_ENABLED: "1", ARENA_WB_SUPABASE_URL: URL_, ARENA_WB_VERIFIER_SECRET: "x".repeat(48),
  ARENA_PASS_PRIVATE_KEY: "pem", ARENA_TECH_ALLOWED_ORIGINS: "capacitor://localhost,https://app.example.com", ARENA_MONGODB_DB: "arena_prod",
  ARENA_ROW_ID_SECRET: "r".repeat(40),
} as NodeJS.ProcessEnv;

test("the documented production shape is safe", () => {
  assert.deepEqual(techEnvProblems(PROD), []);
  assert.equal(readTechConfig(PROD).passTtlSeconds, 300);
  assert.deepEqual(techEnvProblems({ ...PROD, ARENA_TECH_ENABLED: undefined }), [], "switched off is safe too");
});

const BAD: [string, Partial<NodeJS.ProcessEnv>, RegExp][] = [
  ["ARENA_DEV_STACK in production", { ARENA_DEV_STACK: "1" }, /ARENA_DEV_STACK/],
  ["ARENA_DEV_STACK=0 still refused (must be absent)", { ARENA_DEV_STACK: "0" }, /ARENA_DEV_STACK/],
  ["fake-dev verifier", { ARENA_VERIFIER: "fake-dev", ARENA_DEV_STACK: "1" }, /fake-dev/],
  ["fake verifier file", { ARENA_FAKE_VERIFIER_FILE: "/tmp/x.json" }, /FAKE_VERIFIER_FILE/],
  ["pass TTL above 300", { ARENA_PASS_TTL_SECONDS: "900" }, /ARENA_PASS_TTL_SECONDS/],
  ["local origin", { ARENA_TECH_ALLOWED_ORIGINS: "http://127.0.0.1:5173" }, /local\/wildcard/],
  ["wildcard origin", { ARENA_TECH_ALLOWED_ORIGINS: "*" }, /local\/wildcard/],
  ["plain http origin", { ARENA_TECH_ALLOWED_ORIGINS: "http://app.example.com" }, /https/],
  ["NODE_ENV not production", { NODE_ENV: "development" }, /NODE_ENV/],
  ["missing verifier secret", { ARENA_WB_VERIFIER_SECRET: "" }, /ARENA_WB_VERIFIER_SECRET/],
  ["short verifier secret", { ARENA_WB_VERIFIER_SECRET: "short" }, /ARENA_WB_VERIFIER_SECRET/],
  ["missing pass key", { ARENA_PASS_PRIVATE_KEY: "" }, /ARENA_PASS_PRIVATE_KEY/],
  ["missing row id secret", { ARENA_ROW_ID_SECRET: "" }, /ARENA_ROW_ID_SECRET/],
  ["short row id secret", { ARENA_ROW_ID_SECRET: "short" }, /ARENA_ROW_ID_SECRET/],
  ["missing origins", { ARENA_TECH_ALLOWED_ORIGINS: "" }, /ARENA_TECH_ALLOWED_ORIGINS/],
  ["missing arena db", { ARENA_MONGODB_DB: "" }, /ARENA_MONGODB_DB/],
  ["retired service-role key present", { ARENA_WB_VERIFIER_KEY: "eyJ..." }, /retired/],
];
for (const [name, over, re] of BAD) {
  test(`refused: ${name}`, () => {
    const env = { ...PROD, ...over } as NodeJS.ProcessEnv;
    assert.match(techEnvProblems(env).join("\n"), re);
    assert.throws(() => readTechConfig(env), (e: unknown) => e instanceof ArenaTechConfigError && /unsafe technician configuration/.test((e as Error).message));
  });
}

test("the local dev stack (not deployed) may use ARENA_DEV_STACK and local origins", () => {
  const dev = { NODE_ENV: "production", ARENA_DEV_STACK: "1", ARENA_TECH_ENABLED: "1", ARENA_WB_SUPABASE_URL: URL_, ARENA_WB_VERIFIER_SECRET: "x".repeat(40),
    ARENA_PASS_PRIVATE_KEY: "pem", ARENA_TECH_ALLOWED_ORIGINS: "http://127.0.0.1:5173,capacitor://localhost", ARENA_MONGODB_DB: "arena_dev", ARENA_ROW_ID_SECRET: "r".repeat(40) } as NodeJS.ProcessEnv;
  assert.equal(isDeployed(dev), false);
  assert.deepEqual(techEnvProblems(dev), []);
});

test("Vercel preview deployments are treated as deployed too", () => {
  assert.equal(isDeployed({ VERCEL_ENV: "preview" } as NodeJS.ProcessEnv), true);
  assert.match(techEnvProblems({ ...PROD, VERCEL: undefined, VERCEL_ENV: "preview", ARENA_DEV_STACK: "1" }).join(), /ARENA_DEV_STACK/);
});
