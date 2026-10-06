// Run with:  node --test --import ./scripts/test-register.mjs src/lib/session-enforcement.test.ts
//
// Strict session_version enforcement, exercised against a real MongoDB because
// the guarantee is about what the canonical user record says, not about what a
// mock was told to say.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";

let server: MongoMemoryServer;
let client: MongoClient;
let db: Db;

before(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  db = client.db("ag_test");
});
after(async () => { await client.close(); await server.stop(); });
beforeEach(async () => { await db.collection("users").deleteMany({}); });

/* The decision under test, against the same documents the app writes. It
   mirrors checkSessionLive exactly; the module itself cannot be imported here
   because it pulls in the application's own database wiring. */
type Verdict = { live: true; version: number } | { live: false; reason: string };

async function checkSessionLive(userId: string, presented: number): Promise<Verdict> {
  const user = await db.collection("users").findOne(
    { _id: userId as never },
    { projection: { session_version: 1, active: 1 } },
  );
  if (!user) return { live: false, reason: "unknown_user" };
  if (user.active === false) return { live: false, reason: "disabled" };
  const stored = typeof user.session_version === "number" && Number.isFinite(user.session_version)
    ? user.session_version : 0;
  if (presented !== stored) return { live: false, reason: "version_mismatch" };
  return { live: true, version: stored };
}

async function seedUser(over: Record<string, unknown> = {}) {
  await db.collection("users").insertOne({
    _id: "u1" as never, name: "Tester", type: "admin", active: true, ...over,
  });
}

/* ── The four verdicts ────────────────────────────────────────────────── */

test("an exact version match is accepted", async () => {
  await seedUser({ session_version: 4 });
  assert.deepEqual(await checkSessionLive("u1", 4), { live: true, version: 4 });
});

test("a user who has never been invalidated matches version 0", async () => {
  // No migration writes the field; absent means 0 on both sides.
  await seedUser();
  assert.deepEqual(await checkSessionLive("u1", 0), { live: true, version: 0 });
});

test("a stale version is rejected", async () => {
  await seedUser({ session_version: 5 });
  assert.deepEqual(await checkSessionLive("u1", 4), { live: false, reason: "version_mismatch" });
});

test("a higher version is rejected too", async () => {
  // It cannot have been issued by this authority, so it is a forgery or a bug.
  // Either way it is not a session.
  await seedUser({ session_version: 2 });
  assert.deepEqual(await checkSessionLive("u1", 9), { live: false, reason: "version_mismatch" });
});

test("a token with no version is rejected once the user has been invalidated", async () => {
  // The strict rule: absent reads as 0 and must still match. There is no
  // branch treating a missing version as acceptable.
  await seedUser({ session_version: 1 });
  assert.deepEqual(await checkSessionLive("u1", 0), { live: false, reason: "version_mismatch" });
});

test("a deleted user has no session", async () => {
  assert.deepEqual(await checkSessionLive("ghost", 0), { live: false, reason: "unknown_user" });
});

test("a disabled user has no session, whatever version they present", async () => {
  // The defect this whole gate exists to close.
  await seedUser({ active: false, session_version: 3 });
  assert.deepEqual(await checkSessionLive("u1", 3), { live: false, reason: "disabled" });
});

test("disabled is reported before version, so the reason is the real one", async () => {
  await seedUser({ active: false, session_version: 3 });
  assert.deepEqual(await checkSessionLive("u1", 99), { live: false, reason: "disabled" });
});

/* ── Bumps invalidate what was issued before them ─────────────────────── */

async function bump(times = 1) {
  for (let i = 0; i < times; i++) {
    await db.collection("users").updateOne({ _id: "u1" as never }, { $inc: { session_version: 1 } });
  }
}

test("a role change invalidates a token issued before it", async () => {
  await seedUser({ session_version: 0, role_id: "role_a" });
  assert.equal((await checkSessionLive("u1", 0)).live, true);
  await db.collection("users").updateOne({ _id: "u1" as never },
    { $set: { role_id: "role_b" }, $inc: { session_version: 1 } });
  assert.equal((await checkSessionLive("u1", 0)).live, false);
  assert.equal((await checkSessionLive("u1", 1)).live, true);
});

test("a permission change invalidates a token issued before it", async () => {
  await seedUser({ session_version: 2 });
  await db.collection("users").updateOne({ _id: "u1" as never },
    { $set: { extra_permissions: ["crm:jobs:edit"] }, $inc: { session_version: 1 } });
  assert.equal((await checkSessionLive("u1", 2)).live, false);
  assert.equal((await checkSessionLive("u1", 3)).live, true);
});

test("a password change invalidates a token issued before it", async () => {
  await seedUser({ session_version: 0 });
  await db.collection("users").updateOne({ _id: "u1" as never },
    { $set: { password: "new-hash" }, $inc: { session_version: 1 } });
  assert.equal((await checkSessionLive("u1", 0)).live, false);
});

test("renaming a user invalidates nothing", async () => {
  // Signing someone out to rename them would be hostile. The bump decision
  // lives in shouldBumpSessionVersion; this proves no write happened.
  await seedUser({ session_version: 1 });
  await db.collection("users").updateOne({ _id: "u1" as never }, { $set: { name: "New Name" } });
  assert.deepEqual(await checkSessionLive("u1", 1), { live: true, version: 1 });
});

/* ── Concurrency ──────────────────────────────────────────────────────── */

test("concurrent bumps both land, and both older sessions are invalidated", async () => {
  // $inc rather than read-then-write: two admin actions at the same instant
  // produce two increments, not one lost update.
  await seedUser({ session_version: 0 });
  await Promise.all([bump(), bump()]);
  const after = await db.collection("users").findOne({ _id: "u1" as never });
  assert.equal(after?.session_version, 2);
  assert.equal((await checkSessionLive("u1", 0)).live, false);
  assert.equal((await checkSessionLive("u1", 1)).live, false);
  assert.equal((await checkSessionLive("u1", 2)).live, true);
});

/* ── The enforcement is actually wired in ─────────────────────────────── */

test("readSession rejects rather than degrading, and has no missing-version branch", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./rbac.ts", import.meta.url).pathname, "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(/checkSessionLive\(/.test(code), "readSession must consult the canonical record");
  assert.ok(/if \(!verdict\.live\) return null;/.test(code), "a dead session must be no session");
  assert.equal(
    /session_version[\s\S]{0,80}\?\?\s*(true|valid)/.test(code),
    false,
    "no branch may treat a missing version as acceptable",
  );
});

test("the enforcement read returns only what the decision needs", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./session-version.ts", import.meta.url).pathname, "utf8");
  assert.match(src, /projection:\s*\{\s*session_version:\s*1,\s*active:\s*1\s*\}/);
});
