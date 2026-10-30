// Technician API: token exchange, Arena pass, per-request re-verification,
// configuration guards, data minimization and the event feed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, decodeJwt, type JWK } from "jose";
import { exchange, authorizePass, type AccessDeps, type Lookup } from "./access.ts";
import { verifyWbAccessToken } from "./wb-token.ts";
import { MemoryVerifier, VerifierUnavailableError, WbEdgeVerifier, verifierFromEnv, type AccountStatus } from "./verifier.ts";
import { issuePass, passKeysFromEnv, type PassKeys } from "./pass.ts";
import { MemoryRateLimiter } from "./rate-limit.ts";
import { readTechConfig, parseWbUrl, PASS_TTL_DEFAULT_SECONDS, PRODUCTION_WB_REF_SHA256, ArenaTechConfigError } from "./config.ts";
import { closesNeeded, decodeCursor, encodeCursor } from "./views.ts";
import { techEvents, techHistory, techLeaderboard, techMe, findCompetitor, type TechCtx } from "./service.ts";
import { approveResults, freezeCompetition, openReview, reviewSnapshot } from "../lifecycle.ts";
import { MemoryCollection } from "../testing/memory-collection.ts";
import { fixture, jobs, ADMIN, OWNER, PEOPLE } from "../testing/lifecycle-fixture.ts";
import { rulesFor, updateDraftRules } from "../config-store.ts";
import { cloneRules } from "../config.ts";

const ISS = "https://abcdefghijklmnopqrst.supabase.co/auth/v1";
const [ANN, BO, CY] = PEOPLE;
const NOW = new Date("2026-10-28T15:00:00Z");
const sec = (d: Date) => Math.floor(d.getTime() / 1000);

const wb = await generateKeyPair("ES256");
const other = await generateKeyPair("ES256");
const wbJwk: JWK = { ...(await exportJWK(wb.publicKey)), kid: "k1", alg: "ES256", use: "sig" };
const jwks = createLocalJWKSet({ keys: [wbJwk] });

function rsa(): PassKeys {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { privateKey, publicKey };
}
const passKeys = rsa();

async function wbToken(o: { sub?: string; iss?: string; aud?: string; exp?: number; iat?: number; key?: CryptoKey; extra?: Record<string, unknown> } = {}) {
  return new SignJWT({ role: "authenticated", ...(o.extra ?? {}) })
    .setProtectedHeader({ alg: "ES256", kid: "k1" })
    .setSubject(o.sub ?? ANN.id)
    .setIssuer(o.iss ?? ISS)
    .setAudience(o.aud ?? "authenticated")
    .setIssuedAt(o.iat ?? sec(NOW) - 10)
    .setExpirationTime(o.exp ?? sec(NOW) + 3600)
    .sign(o.key ?? wb.privateKey);
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

function deps(over: Partial<AccessDeps> = {}, accounts?: Map<string, AccountStatus>, mapped = new Set([ANN.id, BO.id, CY.id])) {
  const verifier = new MemoryVerifier(
    accounts ?? new Map(PEOPLE.map((p) => [p.id, { active: true, approved: true, role: "technician" }])),
  );
  const d: AccessDeps = {
    enabled: true,
    verifyWbToken: (t) => verifyWbAccessToken(t, { issuer: ISS, keys: jwks, now: NOW }),
    verifier,
    findCompetitor: async (id): Promise<Lookup> =>
      mapped.has(id) ? { ok: true, competitor: { competitorId: id, displayName: PEOPLE.find((p) => p.id === id)!.name } } : { ok: false },
    passKeys,
    passTtlSeconds: PASS_TTL_DEFAULT_SECONDS,
    limiters: { ip: new MemoryRateLimiter(1000, 60_000), userIp: new MemoryRateLimiter(1000, 60_000) },
    now: () => NOW,
    ...over,
  };
  return { d, verifier, mapped };
}

const code = (o: { body: unknown }) => (o.body as { code?: string }).code;

// ── exchange ───────────────────────────────────────────────────────────────

test("exchange: a valid Weekly Balance token yields a 5-minute RS256 pass for that competitor", async () => {
  const { d } = deps();
  const out = await exchange(d, `Bearer ${await wbToken()}`, "1.2.3.4");
  assert.equal(out.status, 200);
  const body = out.body as { pass: string; competitorId: string; displayName: string; expiresAt: string };
  assert.equal(body.competitorId, ANN.id);
  assert.equal(body.displayName, "Ann Able");
  const claims = decodeJwt(body.pass);
  assert.equal(claims.aud, "arena");
  assert.equal(claims.iss, "lbs-crm-arena");
  assert.equal(claims.sub, ANN.id);
  assert.equal(claims.exp! - claims.iat!, 300);
  assert.equal(JSON.parse(Buffer.from(body.pass.split(".")[0], "base64url").toString()).alg, "RS256");
  assert.deepEqual(Object.keys(claims).sort(), ["aud", "exp", "iat", "iss", "jti", "sub"], "the pass carries nothing else");
});

test("exchange rejects bad signature, expiry, wrong iss/aud, alg none, HS256 confusion, garbage", async () => {
  const { d } = deps();
  const pubPem = Buffer.from(JSON.stringify(wbJwk));
  const hs = await new SignJWT({ role: "authenticated" }).setProtectedHeader({ alg: "HS256", kid: "k1" }).setSubject(ANN.id)
    .setIssuer(ISS).setAudience("authenticated").setIssuedAt(sec(NOW)).setExpirationTime(sec(NOW) + 600).sign(pubPem);
  const none = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: ANN.id, iss: ISS, aud: "authenticated", iat: sec(NOW), exp: sec(NOW) + 600 })}.`;
  const cases: [string, string | null][] = [
    ["other key", await wbToken({ key: other.privateKey })],
    ["expired beyond skew", await wbToken({ exp: sec(NOW) - 61, iat: sec(NOW) - 3600 })],
    ["wrong issuer", await wbToken({ iss: "https://zzzzzzzzzzzzzzzzzzzz.supabase.co/auth/v1" })],
    ["wrong audience", await wbToken({ aud: "anon" })],
    ["anon role", await wbToken({ extra: { role: "anon" } })],
    ["service role", await wbToken({ extra: { role: "service_role" } })],
    ["anonymous sign-in", await wbToken({ extra: { is_anonymous: true } })],
    ["subject not a uuid", await wbToken({ sub: "Ann" })],
    ["alg none", none],
    ["HS256 with the public key", hs],
    ["no header", null],
    ["not a jwt", "abc"],
  ];
  for (const [name, tok] of cases) {
    const out = await exchange(d, tok === null ? null : `Bearer ${tok}`, "1.2.3.4");
    assert.equal(out.status, 401, name);
    assert.equal(code(out), "invalid_token", name);
  }
  // inside the 60 s skew is still accepted
  assert.equal((await exchange(d, `Bearer ${await wbToken({ exp: sec(NOW) - 30, iat: sec(NOW) - 600 })}`, "1.2.3.4")).status, 200);
});

test("exchange: inactive, pending, wrong role, unknown account → account_inactive; unmapped → not_a_competitor", async () => {
  const accounts = new Map<string, AccountStatus>([
    [ANN.id, { active: false, approved: true, role: "technician" }],
    [BO.id, { active: true, approved: false, role: "technician" }],
    [CY.id, { active: true, approved: true, role: "office_staff" }],
  ]);
  const { d } = deps({}, accounts);
  for (const p of [ANN, BO, CY]) {
    const out = await exchange(d, `Bearer ${await wbToken({ sub: p.id })}`, "1.2.3.4");
    assert.equal(out.status, 403, p.name);
    assert.equal(code(out), "account_inactive", p.name);
  }
  const unknown = "44444444-4444-4444-8444-444444444444";
  assert.equal(code(await exchange(d, `Bearer ${await wbToken({ sub: unknown })}`, "1.2.3.4")), "account_inactive");
  const am = deps({}, new Map([[ANN.id, { active: true, approved: true, role: "area_manager" }]]), new Set());
  const out = await exchange(am.d, `Bearer ${await wbToken()}`, "1.2.3.4");
  assert.equal(out.status, 403);
  assert.equal(code(out), "not_a_competitor");
});

test("exchange: master switch off → arena_disabled; verifier failure fails closed", async () => {
  const off = deps({ enabled: false }).d;
  const out = await exchange(off, `Bearer ${await wbToken()}`, "1.2.3.4");
  assert.equal(out.status, 503);
  assert.equal(code(out), "arena_disabled");
  const broken = deps({ verifier: { verify: async () => { throw new Error("down"); } } }).d;
  const b = await exchange(broken, `Bearer ${await wbToken()}`, "1.2.3.4");
  assert.equal(b.status, 503);
  assert.ok(!("pass" in (b.body as object)));
});

test("exchange is rate limited per user+IP and per IP", async () => {
  const { d } = deps({ limiters: { ip: new MemoryRateLimiter(100, 60_000), userIp: new MemoryRateLimiter(2, 60_000) } });
  const t = `Bearer ${await wbToken()}`;
  assert.equal((await exchange(d, t, "9.9.9.9")).status, 200);
  assert.equal((await exchange(d, t, "9.9.9.9")).status, 200);
  const third = await exchange(d, t, "9.9.9.9");
  assert.equal(third.status, 429);
  assert.equal(code(third), "rate_limited");
  assert.equal((await exchange(d, t, "8.8.8.8")).status, 200, "another IP has its own budget");
  const ip = deps({ limiters: { ip: new MemoryRateLimiter(1, 60_000), userIp: new MemoryRateLimiter(100, 60_000) } }).d;
  await exchange(ip, "Bearer x.y.z", "7.7.7.7");
  assert.equal((await exchange(ip, t, "7.7.7.7")).status, 429, "bad tokens burn the IP budget too");
});

// ── pass on every request ──────────────────────────────────────────────────

test("tech requests accept only a valid Arena pass", async () => {
  const { d } = deps();
  const { pass } = await issuePass(passKeys, ANN.id, 300, NOW);
  assert.deepEqual(await authorizePass(d, `Bearer ${pass}`), { ok: true, competitorId: ANN.id });
  const reject = async (auth: string | null, why: string) => {
    const r = await authorizePass(d, auth);
    assert.equal(r.ok, false, why);
    if (!r.ok) assert.equal(r.outcome.status, 401, why);
  };
  await reject(null, "no credential (a CRM cookie alone is never read)");
  await reject(`Bearer ${await wbToken()}`, "a Weekly Balance token is not a pass");
  await reject(`Bearer ${(await issuePass(rsa(), ANN.id, 300, NOW)).pass}`, "signed by another key");
  await reject(`Bearer ${(await issuePass(passKeys, ANN.id, 300, new Date(NOW.getTime() - 400_000))).pass}`, "expired");
  const [h, p, s] = pass.split(".");
  const forged = { ...JSON.parse(Buffer.from(p, "base64url").toString()), sub: BO.id };
  await reject(`Bearer ${h}.${b64(forged)}.${s}`, "tampered subject");
  const wrongAud = await new SignJWT({}).setProtectedHeader({ alg: "RS256" }).setIssuer("lbs-crm-arena").setAudience("crm")
    .setSubject(ANN.id).setIssuedAt(sec(NOW)).setExpirationTime(sec(NOW) + 300).sign(passKeys.privateKey);
  await reject(`Bearer ${wrongAud}`, "wrong audience");
  const hs = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setIssuer("lbs-crm-arena").setAudience("arena")
    .setSubject(ANN.id).setIssuedAt(sec(NOW)).setExpirationTime(sec(NOW) + 300)
    .sign(Buffer.from(passKeys.publicKey.export({ type: "spki", format: "pem" })));
  await reject(`Bearer ${hs}`, "HS256 with the public key");
});

test("an unexpired pass is refused as soon as the account is deactivated, unmapped, or the Arena is switched off", async () => {
  const { d, verifier, mapped } = deps();
  const { pass } = await issuePass(passKeys, ANN.id, 300, NOW);
  const auth = `Bearer ${pass}`;
  assert.equal((await authorizePass(d, auth)).ok, true);

  verifier.accounts.set(ANN.id, { active: false, approved: true, role: "technician" });
  let r = await authorizePass(d, auth);
  assert.ok(!r.ok && r.outcome.status === 403 && code(r.outcome) === "account_inactive", "deactivated mid-session");

  verifier.accounts.set(ANN.id, { active: true, approved: false, role: "technician" });
  r = await authorizePass(d, auth);
  assert.ok(!r.ok && code(r.outcome) === "account_inactive", "approval withdrawn");

  verifier.accounts.set(ANN.id, { active: true, approved: true, role: "technician" });
  mapped.delete(ANN.id);
  r = await authorizePass(d, auth);
  assert.ok(!r.ok && r.outcome.status === 403 && code(r.outcome) === "not_a_competitor", "unmapped mid-session");

  mapped.add(ANN.id);
  assert.equal((await authorizePass(d, auth)).ok, true);
  r = await authorizePass({ ...d, enabled: false }, auth);
  assert.ok(!r.ok && r.outcome.status === 503, "switch off");
});

// ── configuration guards ───────────────────────────────────────────────────

test("config: technician API is off unless ARENA_TECH_ENABLED=1; pass lifetime defaults to 300 s", () => {
  const base = { NODE_ENV: "production", ARENA_WB_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" } as NodeJS.ProcessEnv;
  const c = readTechConfig(base);
  assert.equal(c.enabled, false);
  assert.equal(c.passTtlSeconds, 300);
  assert.equal(c.wb.issuer, ISS);
  const complete = { ARENA_WB_VERIFIER_SECRET: "s".repeat(40), ARENA_PASS_PRIVATE_KEY: "pem", ARENA_TECH_ALLOWED_ORIGINS: "capacitor://localhost", ARENA_MONGODB_DB: "arena" };
  assert.equal(readTechConfig({ ...base, ...complete, ARENA_TECH_ENABLED: "1", ARENA_PASS_TTL_SECONDS: "600" }).passTtlSeconds, 600);
  assert.throws(() => readTechConfig({ ...base, ARENA_PASS_TTL_SECONDS: "86400" }), ArenaTechConfigError);
  assert.throws(() => readTechConfig({ ...base, ARENA_WB_SUPABASE_URL: "http://abcdefghijklmnopqrst.supabase.co" }), ArenaTechConfigError);
  assert.throws(() => readTechConfig({ ...base, ARENA_WB_SUPABASE_URL: "https://evil.example.com" }), ArenaTechConfigError);
});

test("config: the production Weekly Balance project is refused in a dev configuration", () => {
  assert.match(PRODUCTION_WB_REF_SHA256, /^[0-9a-f]{64}$/);
  const dev = { NODE_ENV: "production", ARENA_DEV_STACK: "1", ARENA_WB_DENY_REFS: "zzzzzzzzzzzzzzzzzzzz" } as NodeJS.ProcessEnv;
  assert.throws(() => parseWbUrl("https://zzzzzzzzzzzzzzzzzzzz.supabase.co", dev), /PRODUCTION/);
  assert.throws(() => parseWbUrl("https://zzzzzzzzzzzzzzzzzzzz.supabase.co", { NODE_ENV: "development", ARENA_WB_DENY_REFS: "zzzzzzzzzzzzzzzzzzzz" }), /PRODUCTION/);
  assert.equal(parseWbUrl("https://abcdefghijklmnopqrst.supabase.co", dev).ref, "abcdefghijklmnopqrst");
  // the pinned hash is checked even without a deny list
  assert.notEqual(createHash("sha256").update("abcdefghijklmnopqrst").digest("hex"), PRODUCTION_WB_REF_SHA256);
});

test("config: ARENA_VERIFIER=fake-dev is refused in production unless ARENA_DEV_STACK=1", () => {
  const url = "https://abcdefghijklmnopqrst.supabase.co";
  assert.throws(() => verifierFromEnv(url, { NODE_ENV: "production", ARENA_VERIFIER: "fake-dev", ARENA_FAKE_VERIFIER_FILE: "/x" }), /refused in production/);
  assert.ok(verifierFromEnv(url, { NODE_ENV: "production", ARENA_DEV_STACK: "1", ARENA_VERIFIER: "fake-dev", ARENA_FAKE_VERIFIER_FILE: "/x" }));
  assert.throws(() => verifierFromEnv(url, { NODE_ENV: "production" }), /ARENA_WB_VERIFIER_SECRET/);
  assert.throws(() => verifierFromEnv(url, { NODE_ENV: "production", ARENA_WB_VERIFIER_SECRET: "short" }), /too short/);
  assert.ok(verifierFromEnv(url, { NODE_ENV: "production", ARENA_WB_VERIFIER_SECRET: "k".repeat(40) }) instanceof WbEdgeVerifier);
  assert.throws(() => verifierFromEnv(url, { NODE_ENV: "production", ARENA_VERIFIER: "supabase-rpc", ARENA_WB_VERIFIER_SECRET: "k".repeat(40) }), /unknown ARENA_VERIFIER/,
    "the service-role RPC path no longer exists");
});

test("pass keys load from a PEM or its base64; non-RSA keys are refused", () => {
  const pem = passKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  assert.equal(passKeysFromEnv({ ARENA_PASS_PRIVATE_KEY: pem } as NodeJS.ProcessEnv).privateKey.asymmetricKeyType, "rsa");
  assert.equal(passKeysFromEnv({ ARENA_PASS_PRIVATE_KEY: Buffer.from(pem).toString("base64") } as NodeJS.ProcessEnv).privateKey.asymmetricKeyType, "rsa");
  const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  assert.throws(() => passKeysFromEnv({ ARENA_PASS_PRIVATE_KEY: ec } as NodeJS.ProcessEnv), /RSA/);
  assert.throws(() => passKeysFromEnv({} as NodeJS.ProcessEnv), /not set/);
});

test("the Edge verifier sends only the user id + dedicated key, reads only {active, approved, role}, and fails closed", async () => {
  let sent: { url: string; body: string; headers: Record<string, string> } | null = null;
  const reply = (status: number, body: unknown) => (async (url: string, init: RequestInit) => {
    sent = { url, body: String(init.body), headers: init.headers as Record<string, string> };
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as never;
  const base = "https://abcdefghijklmnopqrst.supabase.co";
  const ok = new WbEdgeVerifier(base, "s".repeat(40), reply(200, { account: { active: true, approved: true, role: "technician", full_name: "x" } }));
  assert.deepEqual(await ok.verify(ANN.id), { active: true, approved: true, role: "technician" });
  assert.equal(sent!.url, `${base}/functions/v1/arena-verify`);
  assert.deepEqual(JSON.parse(sent!.body), { user_id: ANN.id });
  assert.equal(sent!.headers["x-arena-verify-key"], "s".repeat(40));
  assert.ok(!("Authorization" in sent!.headers) && !("apikey" in sent!.headers), "no Supabase key is ever sent");
  assert.equal(await new WbEdgeVerifier(base, "k", reply(200, { account: null })).verify(ANN.id), null);
  for (const [st, b] of [[401, { error: "unauthorized" }], [503, { error: "x" }], [500, "no"], [200, { active: true }], [200, { account: { active: "yes" } }], [200, "not json"]] as const)
    await assert.rejects(new WbEdgeVerifier(base, "k", reply(st, b)).verify(ANN.id), VerifierUnavailableError, `${st} ${JSON.stringify(b)}`);
  const down = new WbEdgeVerifier(base, "k", (async () => { throw new TypeError("fetch failed"); }) as never);
  await assert.rejects(down.verify(ANN.id), VerifierUnavailableError);
  const slow = new WbEdgeVerifier(base, "k", ((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(new Error("aborted"))))) as never, 20);
  await assert.rejects(slow.verify(ANN.id), VerifierUnavailableError);
});

// ── read models: data minimization ─────────────────────────────────────────

/** Minimal stand-in for the read-only CRM handle (TechNameMapping + Technician). */
function fakeCrm(mappings: { supabaseUserId: string; supabaseFullName: string; crmTechNames: string[] }[]) {
  return {
    collection(name: string) {
      const rows: Record<string, unknown>[] =
        name === "TechNameMapping" ? (mappings as never) : name === "Technician" ? PEOPLE.map((p) => ({ _id: p.crm, location: p.location })) : [];
      return {
        findOne: async (f: Record<string, unknown>) => rows.find((r) => Object.entries(f).every(([k, v]) => r[k] === v)) ?? null,
        find: () => ({ toArray: async () => rows }),
      };
    },
  } as never;
}

async function techWorld() {
  const f = await fixture();
  f.data.jobs = [
    ...jobs(6, "Ann", "Closed", 1000), ...jobs(4, "Ann", "Estimate", 0),
    ...jobs(5, "Bo", "Closed", 900), ...jobs(5, "Bo", "Estimate", 0),
    ...jobs(4, "Cy", "Closed", 1000), ...jobs(4, "Cy", "Estimate", 0),
  ];
  const id = await f.startWeek();
  const mappings = PEOPLE.map((p) => ({ supabaseUserId: p.id, supabaseFullName: p.name, crmTechNames: [p.crm] }));
  const review = {
    store: { cases: new MemoryCollection(), events: new MemoryCollection(), audit: new MemoryCollection() },
    ownerUserId: async () => OWNER, verifiedCompetitorIds: async () => new Set(PEOPLE.map((p) => p.id)),
    now: () => f.ctx.config.now(), newId: (p: string) => `${p}_x`,
  };
  const ctx: TechCtx = { lifecycle: f.ctx, review: review as never, crmDb: fakeCrm(mappings) };
  return { ...f, id, ctx, mappings };
}

const CONTRACT_KEYS = new Set([
  // MeResponse
  "apiVersion", "serverTime", "competitor", "competition", "rules", "standing", "award", "notices",
  "id", "displayName", "location", "weekStart", "weekEnd", "phase", "endsAt", "reviewOpensAt", "dataAsOf",
  "timezone", "minQualifyingJobs", "minAvgTicketCents", "minClosingRateBp", "closingRateWeight", "avgTicketWeight",
  "closingRateTargetBp", "avgTicketTargetCents", "cap", "capC", "capA", "methodology", "closingScore", "avgScore", "limitingMetric", "prizesCents", "mostImprovedCents", "showPotentialPrize", "refreshSeconds",
  "rank", "score", "eligible", "gates", "jobs", "avgTicket", "closingRate", "met", "actual", "required", "closingRateBp",
  "avgTicketCents", "assignedJobs", "closedJobs", "qualifyingJobs", "closingIndex", "avgIndex", "potentialPrizeCents",
  "nextSteps", "kind", "text", "amount", "pointsToNextRank", "mostImproved", "baselineScore", "improvement", "validWeeks",
  "prizeCents", "position", "message", "at",
  // leaderboard
  "view", "rows", "eligibleCount", "participantCount", "prizePoolCents", "competitorId", "gatesMet", "isMe",
  // history
  "weeks", "myRank", "myScore", "winners", "mostImprovedWinner",
  // events
  "cursor", "events", "from", "to", "gate",
]);
function keysOf(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (out.add(k), keysOf(x, out));
  return out;
}
function assertMinimal(name: string, body: unknown, jobIds: string[]) {
  const s = JSON.stringify(body);
  for (const k of keysOf(body)) assert.ok(CONTRACT_KEYS.has(k), `${name}: field "${k}" is not in the contract`);
  for (const j of jobIds) assert.ok(!s.includes(j), `${name}: leaks job id ${j}`);
  for (const p of PEOPLE) assert.ok(!s.includes(`"${p.crm}"`), `${name}: leaks CRM name ${p.crm}`);
  assert.doesNotMatch(s, /profitMicro|jobIds|crmNames|dupKeys|phone|address|invoice|supabase/i, name);
}

test("data minimization: /me, /leaderboard, /history and /events expose only contract fields", async () => {
  const w = await techWorld();
  const ids = w.data.jobs.map((j) => j.id);
  const me = await techMe(w.ctx, ANN.id);
  assertMinimal("me", me, ids);
  assert.equal(me.competition!.phase, "live");
  assert.equal(me.standing!.rank, 1);
  assert.equal(me.standing!.eligible, true);
  assert.equal(me.standing!.potentialPrizeCents, 45_000);
  assert.equal(me.standing!.gates.closingRate.actual, 6000);
  assert.equal(me.standing!.gates.avgTicket.actual, 60_000);
  assert.equal(me.award, null, "no award before approval");
  const cy = await techMe(w.ctx, CY.id);
  assert.equal(cy.standing!.eligible, false);
  assert.deepEqual(cy.standing!.nextSteps.map((s) => [s.kind, s.amount]).slice(0, 1), [["jobs", 2]]);

  const lb = await techLeaderboard(w.ctx, BO.id, null, null);
  assertMinimal("leaderboard", lb, ids);
  assert.equal(lb.rows.length, 3);
  assert.deepEqual(lb.rows.map((r) => r.isMe), [false, false, true], "Cy out-scores Bo but is not eligible");
  assert.equal(lb.rows[1].prizeCents, 0, "an ineligible row never holds a prize");
  assert.equal((await techLeaderboard(w.ctx, BO.id, "eligible", null)).rows.length, 2);

  const ev = await techEvents(w.ctx, ANN.id, null);
  assertMinimal("events", ev, ids);

  // approve the week, then history
  w.setNow("2026-11-02T06:00:00Z");
  await freezeCompetition(w.ctx.lifecycle, w.id, ADMIN);
  await openReview(w.ctx.lifecycle, w.id, ADMIN);
  w.setNow("2026-11-03T17:00:00Z");
  await approveResults(w.ctx.lifecycle, w.id, OWNER, { snapshotId: (await reviewSnapshot(w.ctx.lifecycle, w.id))!._id });
  const hist = await techHistory(w.ctx, ANN.id, null);
  assertMinimal("history", hist, ids);
  assert.equal(hist.weeks[0].myRank, 1);
  assert.equal(hist.weeks[0].winners[0].displayName, "Ann Able");
  const after = await techMe(w.ctx, ANN.id);
  assert.equal(after.competition!.phase, "approved");
  assert.deepEqual(after.award, { prizeCents: 45_000, position: 1, mostImproved: false });
  const evs = await techEvents(w.ctx, ANN.id, ev.cursor);
  assertMinimal("events after approval", evs, ids);
  const kinds = evs.events.map((e) => e.kind);
  assert.deepEqual(kinds.filter((k) => k === "result_approved").length, 1);
  assert.ok(kinds.includes("phase_changed"));
});

test("ineligible metrics are hidden when the rules say so; potential prizes hidden when configured", async () => {
  const f = await fixture();
  f.data.jobs = [...jobs(6, "Ann", "Closed", 1000), ...jobs(4, "Ann", "Estimate", 0), ...jobs(2, "Cy", "Closed", 100)];
  const c = await (await import("../config-store.ts")).createCompetition(f.config, "2026-10-26", { template: "standard" }, ADMIN);
  const rules = cloneRules((await rulesFor(f.config, c._id)).rules);
  rules.display.showIneligibleMetrics = false;
  rules.display.showPotentialPrize = false;
  await updateDraftRules(f.config, c._id, rules, ADMIN);
  const cs = await import("../config-store.ts");
  await cs.scheduleCompetition(f.config, c._id, ADMIN);
  await cs.activateCompetition(f.config, c._id, OWNER);
  const ctx: TechCtx = { lifecycle: f.ctx, review: { store: { cases: new MemoryCollection() } } as never, crmDb: fakeCrm([]) };
  const lb = await techLeaderboard(ctx, ANN.id, "national", null);
  const cyRow = lb.rows.find((r) => r.competitorId === CY.id)!;
  assert.deepEqual([cyRow.closingRateBp, cyRow.avgTicketCents, cyRow.qualifyingJobs], [null, null, null]);
  assert.equal(lb.rows.find((r) => r.competitorId === ANN.id)!.prizeCents, 0);
});

test("findCompetitor: unmapped and rule-excluded people are not competitors", async () => {
  const w = await techWorld();
  assert.equal((await findCompetitor(w.ctx, ANN.id)).ok, true);
  assert.equal((await findCompetitor({ ...w.ctx, crmDb: fakeCrm(w.mappings.slice(1)) }, ANN.id)).ok, false);
  const rules = cloneRules((await rulesFor(w.config, w.id)).rules);
  rules.participants.excludeCompetitorIds = [ANN.id];
  await (await import("../config-store.ts")).amendActiveRules(w.config, w.id, rules, OWNER, "Excluded for review");
  assert.equal((await findCompetitor(w.ctx, ANN.id)).ok, false);
  const me = await techMe(w.ctx, BO.id);
  assert.deepEqual(me.notices.map((n) => [n.kind, n.message]), [["rules_amended", "Excluded for review"]]);
});

test("events: the feed advances with an opaque cursor and only shows the caller's events", async () => {
  const w = await techWorld();
  const first = await techEvents(w.ctx, CY.id, null);
  assert.deepEqual(first.events, []);
  // Cy gets two more closed jobs → qualifies on the next recompute
  w.data.jobs.push(...jobs(2, "Cy", "Closed", 1000));
  w.setNow("2026-10-28T15:01:00Z");
  const next = await techEvents(w.ctx, CY.id, first.cursor);
  const kinds = next.events.map((e) => e.kind + ("gate" in e ? `:${e.gate}` : ""));
  assert.ok(kinds.includes("qualified:all"), kinds.join(","));
  assert.ok(kinds.includes("entered_prize_zone"));
  assert.ok(!next.events.some((e) => e.kind === "result_approved"));
  const again = await techEvents(w.ctx, CY.id, next.cursor);
  assert.deepEqual(again.events, [], "nothing new");
  await assert.rejects(techEvents(w.ctx, CY.id, "garbage"), /cursor/);
  assert.equal(decodeCursor(encodeCursor("2026-10-28T15:01:00.000Z#000001")), "2026-10-28T15:01:00.000Z#000001");
});

test("next steps: closes needed to reach the minimum closing rate", () => {
  assert.equal(closesNeeded(3, 10, 4000), 2); // 5/12 = 41.7%
  assert.equal(closesNeeded(4, 10, 4000), 0);
  assert.equal(closesNeeded(0, 0, 4000), 1);
});

test("events: a fresh open (no cursor) replays only the caller's recent winning result_approved", async () => {
  const w = await techWorld();
  const before = await techEvents(w.ctx, ANN.id, null);
  assert.deepEqual(before.events, [], "nothing to replay before any approval");
  w.setNow("2026-11-02T06:00:00Z");
  await freezeCompetition(w.ctx.lifecycle, w.id, ADMIN);
  await openReview(w.ctx.lifecycle, w.id, ADMIN);
  w.setNow("2026-11-03T17:00:00Z");
  await approveResults(w.ctx.lifecycle, w.id, OWNER, { snapshotId: (await reviewSnapshot(w.ctx.lifecycle, w.id))!._id });

  const fresh = await techEvents(w.ctx, ANN.id, null);
  assert.deepEqual(fresh.events, [
    { kind: "result_approved", at: "2026-11-03T17:00:00.000Z", weekStart: "2026-10-26", prizeCents: 45_000, position: 1, mostImproved: false },
  ]);
  // The cursor already sits after it: polling on does not deliver it twice.
  const next = await techEvents(w.ctx, ANN.id, fresh.cursor);
  assert.ok(!next.events.some((e) => e.kind === "result_approved"));
  // A fresh open again (new device / app restart) replays it again; the app dedupes per week.
  assert.equal((await techEvents(w.ctx, ANN.id, null)).events.length, 1);
  // Nobody else's result, and nothing for someone who won nothing.
  assert.deepEqual((await techEvents(w.ctx, CY.id, null)).events, [], "ineligible: no prize, no replay");
  // Only for a week after approval.
  w.setNow("2026-11-10T17:00:01Z");
  assert.deepEqual((await techEvents(w.ctx, ANN.id, null)).events, []);
});
