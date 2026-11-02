// Pilot allowlist: the store (owner-only, reasons, audit trail, revoke-all) and
// the access gate (default deny, identical to "Arena off", fail closed, checked
// on every request).
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from "jose";
import { exchange, authorizePass, type AccessDeps, type Lookup } from "./access.ts";
import { verifyWbAccessToken } from "./wb-token.ts";
import { MemoryVerifier, type AccountStatus } from "./verifier.ts";
import { issuePass, type PassKeys } from "./pass.ts";
import { MemoryRateLimiter } from "./rate-limit.ts";
import { PASS_TTL_DEFAULT_SECONDS } from "./config.ts";
import {
  canonicalCompetitorId, isAllowlisted, listTechAccess, revokeAllTechAccess, setTechAccess, type TechAccessDoc,
} from "./allowlist.ts";
import { MemoryCollection, memoryStore } from "../testing/memory-collection.ts";
import { initSettings, ArenaAuthorizationError, ArenaStateError, type StoreContext } from "../config-store.ts";
import { ArenaConfigError, SEED_SETTINGS_BUDGET_CEILING_CENTS } from "../config.ts";
import { KNOWN_STATUSES } from "../../status-canonical.ts";

const OWNER = "owner-1";
const ADMIN = "admin-2";
const ANN = "11111111-1111-4111-8111-111111111111";
const BO = "22222222-2222-4222-8222-222222222222";
const ISS = "https://abcdefghijklmnopqrst.supabase.co/auth/v1";
const NOW = new Date("2026-11-02T15:00:00Z");
const sec = (d: Date) => Math.floor(d.getTime() / 1000);

async function store(opts: { init?: boolean } = {}) {
  let t = NOW;
  let n = 0;
  const ctx: StoreContext = { store: memoryStore(), knownStatuses: KNOWN_STATUSES, now: () => t, newId: (p) => `${p}_${++n}` };
  if (opts.init !== false)
    await initSettings(ctx, { budgetCeilingCents: SEED_SETTINGS_BUDGET_CEILING_CENTS, ownerUserId: OWNER, approverUserIds: [OWNER] }, OWNER);
  const coll = new MemoryCollection<TechAccessDoc>();
  const audit = () => (ctx.store.audit as unknown as MemoryCollection<{ _id: string; action: string; target: string; by: string; at: string; reason: string; before: unknown; after: unknown }>).docs
    .filter((a) => a.action.startsWith("tech_access."));
  return { ctx, coll, audit, setNow: (iso: string) => (t = new Date(iso)) };
}

// ── store ──────────────────────────────────────────────────────────────────

test("allowlist: empty by default — nobody is allowed (default deny)", async () => {
  const { coll } = await store();
  assert.equal(await isAllowlisted(coll, ANN), false);
  assert.deepEqual(await listTechAccess(coll), []);
});

test("allowlist: only the owner can grant or revoke; admins and approvers cannot", async () => {
  const { ctx, coll, audit } = await store();
  await assert.rejects(setTechAccess(ctx, coll, ANN, true, ADMIN, "pilot cohort"), ArenaAuthorizationError);
  await assert.rejects(revokeAllTechAccess(ctx, coll, ADMIN, "emergency"), ArenaAuthorizationError);
  assert.equal(await isAllowlisted(coll, ANN), false);
  assert.equal(audit().length, 0, "a refused change leaves no trace in the list");
  const none = await store({ init: false });
  await assert.rejects(setTechAccess(none.ctx, none.coll, ANN, true, OWNER, "x"), ArenaStateError, "no settings → no owner → nothing");
});

test("allowlist: a grant needs a uuid and a reason; ids are stored lowercase", async () => {
  const { ctx, coll } = await store();
  for (const bad of ["", "Ann", "1111", `${ANN}x`, " ; drop "])
    await assert.rejects(setTechAccess(ctx, coll, bad, true, OWNER, "pilot"), ArenaConfigError, bad);
  await assert.rejects(setTechAccess(ctx, coll, ANN, true, OWNER, "   "), ArenaConfigError);
  await assert.rejects(setTechAccess(ctx, coll, ANN, true, OWNER, "x".repeat(501)), ArenaConfigError);
  const up = ANN.toUpperCase();
  const r = await setTechAccess(ctx, coll, ` ${up} `, true, OWNER, "pilot cohort");
  assert.equal(r.doc._id, ANN);
  assert.equal(await isAllowlisted(coll, ANN), true);
  assert.equal(await isAllowlisted(coll, up), true, "lookups are canonicalised too");
  assert.equal(canonicalCompetitorId(42), null);
});

test("allowlist: every change is audited — who, when, why, before → after; repeats are no-ops", async () => {
  const { ctx, coll, audit, setNow } = await store();
  await setTechAccess(ctx, coll, ANN, true, OWNER, "pilot cohort A");
  assert.equal((await setTechAccess(ctx, coll, ANN, true, OWNER, "again")).changed, false);
  setNow("2026-11-03T09:30:00Z");
  await setTechAccess(ctx, coll, ANN, false, OWNER, "asked to leave the pilot");
  setNow("2026-11-04T09:30:00Z");
  await setTechAccess(ctx, coll, ANN, true, OWNER, "back in");
  assert.deepEqual(
    audit().map((a) => [a.action, a.target, a.by, a.at, a.reason, a.before, a.after]),
    [
      ["tech_access.grant", `tech_access:${ANN}`, OWNER, "2026-11-02T15:00:00.000Z", "pilot cohort A", null, { allowed: true }],
      ["tech_access.revoke", `tech_access:${ANN}`, OWNER, "2026-11-03T09:30:00.000Z", "asked to leave the pilot", { allowed: true }, { allowed: false }],
      ["tech_access.grant", `tech_access:${ANN}`, OWNER, "2026-11-04T09:30:00.000Z", "back in", { allowed: false }, { allowed: true }],
    ],
  );
  const [row] = await listTechAccess(coll);
  assert.deepEqual(row, { _id: ANN, allowed: true, reason: "back in", by: OWNER, at: "2026-11-04T09:30:00.000Z" });
});

test("allowlist: revoke-all (emergency) turns everyone off, one audit row each", async () => {
  const { ctx, coll, audit } = await store();
  await setTechAccess(ctx, coll, ANN, true, OWNER, "pilot");
  await setTechAccess(ctx, coll, BO, true, OWNER, "pilot");
  const revoked = await revokeAllTechAccess(ctx, coll, OWNER, "kill switch drill");
  assert.deepEqual(revoked, [ANN, BO]);
  assert.equal(await isAllowlisted(coll, ANN), false);
  assert.equal(await isAllowlisted(coll, BO), false);
  assert.deepEqual(audit().filter((a) => a.action === "tech_access.revoke_all").map((a) => [a.target, a.reason]), [
    [`tech_access:${ANN}`, "kill switch drill"], [`tech_access:${BO}`, "kill switch drill"],
  ]);
  assert.deepEqual(await revokeAllTechAccess(ctx, coll, OWNER, "again"), [], "nothing left to revoke");
});

test("allowlist: only a literal `allowed: true` counts", async () => {
  const coll = new MemoryCollection<TechAccessDoc>();
  await coll.insertOne({ _id: ANN, allowed: "true" as never, reason: "", by: "", at: "" });
  await coll.insertOne({ _id: BO, allowed: 1 as never, reason: "", by: "", at: "" });
  assert.equal(await isAllowlisted(coll, ANN), false);
  assert.equal(await isAllowlisted(coll, BO), false);
});

// ── access gate ────────────────────────────────────────────────────────────

const wb = await generateKeyPair("ES256");
const wbJwk: JWK = { ...(await exportJWK(wb.publicKey)), kid: "k1", alg: "ES256", use: "sig" };
const jwks = createLocalJWKSet({ keys: [wbJwk] });
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const passKeys: PassKeys = { privateKey, publicKey };

const wbToken = (sub = ANN) =>
  new SignJWT({ role: "authenticated" }).setProtectedHeader({ alg: "ES256", kid: "k1" }).setSubject(sub).setIssuer(ISS)
    .setAudience("authenticated").setIssuedAt(sec(NOW) - 10).setExpirationTime(sec(NOW) + 3600).sign(wb.privateKey);

function gate(over: Partial<AccessDeps> = {}, opts: { allowed?: Set<string>; accounts?: Map<string, AccountStatus>; mapped?: Set<string> } = {}) {
  const allowed = opts.allowed ?? new Set<string>();
  const mapped = opts.mapped ?? new Set([ANN, BO]);
  const verifier = new MemoryVerifier(opts.accounts ?? new Map([ANN, BO].map((id) => [id, { active: true, approved: true, role: "technician" }])));
  const calls = { verifier: 0, lookup: 0 };
  const counting = { verify: async (id: string) => (calls.verifier++, verifier.verify(id)) };
  const userIp = new MemoryRateLimiter(1000, 60_000);
  const d: AccessDeps = {
    enabled: true,
    isAllowlisted: async (id) => (calls.lookup++, allowed.has(id)),
    verifyWbToken: (t) => verifyWbAccessToken(t, { issuer: ISS, keys: jwks, now: NOW }),
    verifier: counting,
    findCompetitor: async (id): Promise<Lookup> => (mapped.has(id) ? { ok: true, competitor: { competitorId: id, displayName: "X" } } : { ok: false }),
    passKeys,
    passTtlSeconds: PASS_TTL_DEFAULT_SECONDS,
    limiters: { ip: new MemoryRateLimiter(1000, 60_000), userIp },
    now: () => NOW,
    ...over,
  };
  return { d, allowed, verifier, calls, mapped };
}

const OFF_BODY = { error: "The Arena is not available right now", code: "arena_disabled" };

test("gate: switch ON but not on the allowlist → exactly the switch-OFF answer (exchange and every request)", async () => {
  const off = await exchange(gate({ enabled: false }).d, `Bearer ${await wbToken()}`, "1.2.3.4");
  assert.deepEqual([off.status, off.body], [503, OFF_BODY]);
  const g = gate();
  const out = await exchange(g.d, `Bearer ${await wbToken()}`, "1.2.3.4");
  assert.deepEqual([out.status, out.body], [off.status, off.body], "indistinguishable from the switch being off");
  const { pass } = await issuePass(passKeys, ANN, 300, NOW); // e.g. a pass from before a revoke
  const r = await authorizePass(g.d, `Bearer ${pass}`);
  const rOff = await authorizePass(gate({ enabled: false }).d, `Bearer ${pass}`);
  assert.ok(!r.ok && !rOff.ok);
  assert.deepEqual([r.outcome.status, r.outcome.body], [rOff.outcome.status, rOff.outcome.body]);
});

test("gate: a non-allowlisted person never learns their account / mapping / rate-limit state, and the verifier is not asked", async () => {
  const accounts = new Map<string, AccountStatus>([[ANN, { active: false, approved: true, role: "technician" }], [BO, { active: true, approved: false, role: "technician" }]]);
  const g = gate({ limiters: { ip: new MemoryRateLimiter(1000, 60_000), userIp: new MemoryRateLimiter(1, 60_000) } }, { accounts, mapped: new Set() });
  for (const sub of [ANN, BO, "44444444-4444-4444-8444-444444444444"]) {
    for (let i = 0; i < 3; i++) {
      const out = await exchange(g.d, `Bearer ${await wbToken(sub)}`, "1.2.3.4");
      assert.deepEqual([out.status, out.body], [503, OFF_BODY], `${sub} #${i}`);
    }
  }
  assert.equal(g.calls.verifier, 0, "no Weekly Balance verification for someone outside the pilot");
});

test("gate: allowlisted → pass issued; the usual account/mapping checks still apply after the allowlist", async () => {
  const g = gate({}, { allowed: new Set([ANN, BO]), accounts: new Map([[ANN, { active: true, approved: true, role: "technician" }], [BO, { active: false, approved: true, role: "technician" }]]) });
  const ok = await exchange(g.d, `Bearer ${await wbToken(ANN)}`, "1.2.3.4");
  assert.equal(ok.status, 200);
  assert.equal((ok.body as { competitorId: string }).competitorId, ANN);
  const inactive = await exchange(g.d, `Bearer ${await wbToken(BO)}`, "1.2.3.4");
  assert.equal(inactive.status, 403, "an allowlisted but deactivated account is still refused");
  assert.equal((inactive.body as { code: string }).code, "account_inactive");
});

test("gate: removed from the allowlist mid-session → the very next request is refused, unexpired pass or not", async () => {
  const g = gate({}, { allowed: new Set([ANN]) });
  const out = await exchange(g.d, `Bearer ${await wbToken()}`, "1.2.3.4");
  const pass = (out.body as { pass: string }).pass;
  assert.deepEqual(await authorizePass(g.d, `Bearer ${pass}`), { ok: true, competitorId: ANN });
  const before = g.calls.lookup;
  await authorizePass(g.d, `Bearer ${pass}`);
  assert.equal(g.calls.lookup, before + 1, "looked up on every request (no cache)");
  g.allowed.delete(ANN);
  const r = await authorizePass(g.d, `Bearer ${pass}`);
  assert.ok(!r.ok);
  assert.deepEqual([r.outcome.status, r.outcome.body], [503, OFF_BODY]);
  // and a fresh exchange (what the app does after a refusal or expiry) is refused too
  assert.deepEqual((await exchange(g.d, `Bearer ${await wbToken()}`, "1.2.3.4")).body, OFF_BODY);
  g.allowed.add(ANN);
  assert.equal((await authorizePass(g.d, `Bearer ${pass}`)).ok, true, "re-granting restores access");
});

test("gate: an allowlist failure fails closed (switch-off answer, never a pass)", async () => {
  const g = gate({ isAllowlisted: async () => { throw new Error("db down"); } }, { allowed: new Set([ANN]) });
  const out = await exchange(g.d, `Bearer ${await wbToken()}`, "1.2.3.4");
  assert.deepEqual([out.status, out.body], [503, OFF_BODY]);
  const { pass } = await issuePass(passKeys, ANN, 300, NOW);
  const r = await authorizePass(g.d, `Bearer ${pass}`);
  assert.ok(!r.ok && r.outcome.status === 503);
  const odd = gate({ isAllowlisted: async () => "yes" as never });
  assert.equal((await exchange(odd.d, `Bearer ${await wbToken()}`, "1.2.3.4")).status, 503, "only a literal true lets anyone in");
});

test("gate: the master switch still wins — allowlisted people get nothing while it is off", async () => {
  const g = gate({ enabled: false }, { allowed: new Set([ANN]) });
  assert.deepEqual((await exchange(g.d, `Bearer ${await wbToken()}`, "1.2.3.4")).body, OFF_BODY);
  const { pass } = await issuePass(passKeys, ANN, 300, NOW);
  const r = await authorizePass(g.d, `Bearer ${pass}`);
  assert.ok(!r.ok && r.outcome.status === 503);
  assert.equal(g.calls.lookup, 0, "the switch is checked first");
});

// ── wiring (asserted on source, the repo's usual pattern) ─────────────────

test("wiring: the technician glue reads the allowlist from the Arena database on every request", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const http = readFileSync(join(import.meta.dirname, "http.ts"), "utf8");
  assert.match(http, /a\.arenaDb\.collection\(ARENA_COLLECTIONS\.techAccess\)/);
  assert.match(http, /isAllowlisted: \(id\) => isAllowlisted\(access, id\)/);
});

test("wiring: the admin route changes access only through the owner-checked store, as the signed-in account", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const src = readFileSync(join(import.meta.dirname, "..", "..", "..", "app", "api", "arena", "admin", "tech-access", "route.ts"), "utf8");
  const post = src.slice(src.indexOf("export async function POST"));
  assert.match(post, /return arenaRoute\("arena:rules:edit"/);
  assert.match(post, /revokeAllTechAccess\(ctx\.config, coll, session\.userId, reason\)/);
  assert.match(post, /setTechAccess\(ctx\.config, coll, id, b\.allowed, session\.userId, reason\)/);
  assert.match(post, /str\(b\.reason, "reason"\)/, "a reason is always required");
  assert.doesNotMatch(post, /\.(insertOne|updateOne|updateMany|deleteOne|deleteMany)\(/, "no direct writes around the store");
});
