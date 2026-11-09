// Route-level: the REAL Next handlers (exchange, me, leaderboard, events, history, live)
// over a real MongoDB driver (in-memory server), a fake-dev verifier file and a stubbed
// Weekly Balance JWKS, with a running competition in the CURRENT week (real clock).
// Proves:
//   - GET /tech/live makes exactly ONE Weekly Balance account check per request
//     (the legacy me + events + leaderboard trio makes three);
//   - no HTTP body a technician can receive — success or error — carries another
//     person's account id; leaderboard rows carry anonymous row ids, isMe marks the caller;
//   - fail closed: no row-id secret → 503 arena_disabled; revoked → 503; verifier down → 503.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";

const REF = "liverouteref00000000"; // 20 chars, fictional
const WB = `https://${REF}.supabase.co`;
const ANN = "11111111-1111-4111-8111-111111111111";
const BO = "22222222-2222-4222-8222-222222222222";
const CY = "33333333-3333-4333-8333-333333333333";
const OWNER = "owner-live";
const SECRET = "live-routes-row-id-secret-0123456789";
const OFF_BODY = { error: "The Arena is not available right now", code: "arena_disabled" };
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ROW_ID = /^r_[A-Za-z0-9_-]{22}$/;

const prefix = `arena_wtlive_${process.pid}`;
let server: MongoMemoryServer;
let client: MongoClient;
let arena: Db, crm: Db;
const dir = fs.mkdtempSync(join(tmpdir(), "arena-wtlive-"));
const verifierFile = join(dir, "accounts.json");
const active = { active: true, approved: true, role: "technician" };
const accounts = (a: Record<string, typeof active>) => fs.writeFileSync(verifierFile, JSON.stringify({ accounts: a }));

// Measurement hook: every fake-dev verifier call reads its file once (verifier.ts FileFakeVerifier).
let verifyCalls = 0;
const realRead = fs.readFileSync;
(fs as { readFileSync: typeof fs.readFileSync }).readFileSync = ((p: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
  if (p === verifierFile) verifyCalls++;
  return (realRead as (...a: unknown[]) => unknown)(p, ...rest);
}) as typeof fs.readFileSync;
syncBuiltinESMExports();

const wb = await generateKeyPair("ES256");
const jwk = { ...(await exportJWK(wb.publicKey)), kid: "live1", alg: "ES256", use: "sig" };
const realFetch = globalThis.fetch;
const opened: MongoClient[] = [];
const realConnect = MongoClient.connect.bind(MongoClient);
MongoClient.connect = (async (...a: Parameters<typeof MongoClient.connect>) => {
  const c = await realConnect(...a);
  opened.push(c);
  return c;
}) as typeof MongoClient.connect;

type Handler = (r: Request) => Promise<Response>;
const routes: Record<string, Handler> = {};
let competitionId = "";
let rowId: (c: string, id: string) => string;

function todayIn(zone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

before(async () => {
  server = await MongoMemoryServer.create();
  const uri = server.getUri();
  client = await MongoClient.connect(uri, { serverSelectionTimeoutMS: 5000 });
  arena = client.db(`${prefix}_arena`);
  crm = client.db(`${prefix}_crm`);
  const { weekStartOf } = await import("../week.ts");
  const { SEED_BALANCED_PERFORMANCE_P3 } = await import("../config.ts");
  const week = weekStartOf(todayIn(SEED_BALANCED_PERFORMANCE_P3.timezone));
  await crm.collection("TechNameMapping").insertMany([
    { _id: "m1", supabaseUserId: ANN, supabaseFullName: "Ann Able", crmTechNames: ["Ann"] },
    { _id: "m2", supabaseUserId: BO, supabaseFullName: "Bo Baker", crmTechNames: ["Bo"] },
    { _id: "m3", supabaseUserId: CY, supabaseFullName: "Cy Cole", crmTechNames: ["Cy"] },
  ] as never);
  await crm.collection("Technician").insertMany([{ _id: "Ann", location: "Columbus" }, { _id: "Bo", location: "Chicago" }, { _id: "Cy", location: "Milwaukee" }] as never);
  let n = 0;
  const job = (tech: string, status: string, card: number) => ({
    tech, date: week, status, location: "Somewhere", totalPaidCard: card, techParts: 0, companyParts: 0,
    clientPhoneNumber: `555000${String(++n).padStart(4, "0")}`, address: `${n} Fictional Road`, invoiceNumber: `LR-${n}`,
  });
  await crm.collection("Job").insertMany([
    ...Array.from({ length: 6 }, () => job("Ann", "Closed", 1000)), ...Array.from({ length: 5 }, () => job("Ann", "Estimate", 0)),
    ...Array.from({ length: 5 }, () => job("Bo", "Closed", 900)), ...Array.from({ length: 6 }, () => job("Bo", "Pending", 0)),
    ...Array.from({ length: 4 }, () => job("Cy", "Closed", 700)), ...Array.from({ length: 6 }, () => job("Cy", "Estimate", 0)),
  ] as never);
  accounts({ [ANN]: active, [BO]: active, [CY]: active });

  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  Object.assign(process.env, {
    ARENA_TECH_ENABLED: "1",
    ARENA_WB_SUPABASE_URL: WB,
    ARENA_PASS_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    ARENA_TECH_ALLOWED_ORIGINS: "capacitor://localhost",
    ARENA_ROW_ID_SECRET: SECRET,
    ARENA_VERIFIER: "fake-dev",
    ARENA_FAKE_VERIFIER_FILE: verifierFile,
    ARENA_MONGODB_URI: uri,
    ARENA_MONGODB_DB: `${prefix}_arena`,
    MONGODB_DB: `${prefix}_crm`,
  });
  delete process.env.ARENA_PASS_TTL_SECONDS;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === `${WB}/auth/v1/.well-known/jwks.json`) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.startsWith(WB)) throw new TypeError("unexpected Weekly Balance call");
    return realFetch(input as never, init);
  }) as typeof fetch;

  routes.exchange = (await import("../../../app/api/arena/auth/exchange/route.ts")).POST;
  for (const ep of ["me", "leaderboard", "events", "history", "live"])
    routes[ep] = (await import(`../../../app/api/arena/tech/${ep}/route.ts`)).GET;
  const { buildArenaContexts } = await import("../admin-service.ts");
  const cs = await import("../config-store.ts");
  const { setTechAccess } = await import("./allowlist.ts");
  const { ARENA_COLLECTIONS } = await import("../mongo-store.ts");
  const { anonymousRowId } = await import("./row-id.ts");
  rowId = (c, id) => anonymousRowId(SECRET, c, id);
  const ctx = buildArenaContexts(arena, crm);
  await cs.initSettings(ctx.config, { budgetCeilingCents: 150_000, ownerUserId: OWNER, approverUserIds: [OWNER] }, OWNER);
  await cs.saveTemplate(ctx.config, { templateId: "balanced-p3-2026-11", name: "P3", rules: SEED_BALANCED_PERFORMANCE_P3 }, OWNER);
  const c = await cs.createCompetition(ctx.config, week, { template: "balanced-p3-2026-11" }, OWNER, { beta: true });
  await cs.scheduleCompetition(ctx.config, c._id, OWNER);
  await cs.activateCompetition(ctx.config, c._id, OWNER);
  competitionId = c._id;
  const access = arena.collection(ARENA_COLLECTIONS.techAccess) as never;
  await setTechAccess(ctx.config, access, ANN, true, OWNER, "live routes test");
  await setTechAccess(ctx.config, access, BO, true, OWNER, "live routes test");
});

after(async () => {
  globalThis.fetch = realFetch;
  (fs as { readFileSync: typeof fs.readFileSync }).readFileSync = realRead;
  syncBuiltinESMExports();
  await client.close();
  for (const c of opened) await c.close().catch(() => {});
  await server.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

const seen: { who: string; what: string; status: number; text: string }[] = [];
async function call(ep: string, bearer: string | null, query = "", who = "?") {
  const init = { method: ep === "exchange" ? "POST" : "GET", headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), origin: "capacitor://localhost" } };
  const path = ep === "exchange" ? "/api/arena/auth/exchange" : `/api/arena/tech/${ep}`;
  const res = await routes[ep](new Request(`https://app.test${path}${query}`, init));
  const text = await res.text();
  seen.push({ who, what: `${ep}${query}`, status: res.status, text });
  return { status: res.status, body: JSON.parse(text) as Record<string, any> };
}
const sec = () => Math.floor(Date.now() / 1000);
const wbToken = (sub: string) =>
  new SignJWT({ role: "authenticated" }).setProtectedHeader({ alg: "ES256", kid: "live1" }).setSubject(sub)
    .setIssuer(`${WB}/auth/v1`).setAudience("authenticated").setIssuedAt(sec() - 5).setExpirationTime(sec() + 3600).sign(wb.privateKey);
async function passFor(sub: string, who: string) {
  const r = await call("exchange", await wbToken(sub), "", who);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.capabilities, { live: true });
  return r.body.pass as string;
}

test("one Weekly Balance account check per /live request (three for the legacy me + events + leaderboard)", async () => {
  const pass = await passFor(ANN, "ann");
  const warm = await call("live", pass, "?view=national", "ann"); // first read builds the live snapshot (+ live account checks, reused 2 min)
  assert.equal(warm.status, 200, JSON.stringify(warm.body));
  let cursor = warm.body.events.cursor as string;
  for (let i = 0; i < 5; i++) {
    verifyCalls = 0;
    const r = await call("live", pass, `?view=national&since=${encodeURIComponent(cursor)}`, "ann");
    assert.equal(r.status, 200);
    cursor = r.body.events.cursor;
    assert.equal(verifyCalls, 1, `request ${i}: exactly one account check`);
  }
  verifyCalls = 0;
  await call("live", pass, `?since=${encodeURIComponent(cursor)}`, "ann");
  assert.equal(verifyCalls, 1, "without the board: one check");
  verifyCalls = 0;
  await call("me", pass, "", "ann");
  await call("events", pass, `?since=${encodeURIComponent(cursor)}`, "ann");
  await call("leaderboard", pass, "?view=national", "ann");
  assert.equal(verifyCalls, 3, "legacy trio: three checks");
});

test("/live answers me + events + the board in one body; rows are anonymous; isMe marks the caller", async () => {
  const pass = await passFor(BO, "bo");
  const r = await call("live", pass, "?view=national", "bo");
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ["apiVersion", "events", "leaderboard", "me"]);
  assert.equal(r.body.me.competitor.id, BO, "the caller's own id (only)");
  assert.equal(r.body.me.competition.beta, true);
  assert.equal(r.body.me.rules.jobCountBasis, "assigned");
  const rows = r.body.leaderboard.rows as { competitorId: string; isMe: boolean; displayName: string }[];
  assert.equal(rows.length, 3);
  for (const row of rows) assert.match(row.competitorId, ROW_ID);
  assert.deepEqual(rows.filter((x) => x.isMe).map((x) => x.competitorId), [rowId(competitionId, BO)]);
  const again = await call("live", pass, "?view=national", "bo");
  assert.deepEqual(again.body.leaderboard.rows.map((x: { competitorId: string }) => x.competitorId), rows.map((x) => x.competitorId), "stable across polls");
  const bare = await call("live", pass, "", "bo");
  assert.equal(bare.body.leaderboard, null);
  const lb = await call("leaderboard", pass, "?view=eligible", "bo");
  for (const row of lb.body.rows) assert.match(row.competitorId, ROW_ID);
});

test("errors are generic and carry no ids; fail closed", async () => {
  const pass = await passFor(ANN, "ann");
  assert.equal((await call("live", pass, "?view=everyone", "ann")).status, 400);
  assert.equal((await call("live", pass, "?since=nope", "ann")).status, 400);
  assert.equal((await call("leaderboard", pass, "?view=everyone", "ann")).status, 400);
  assert.equal((await call("leaderboard", pass, "?week=2020-01-06", "ann")).status, 404);
  assert.equal((await call("history", pass, "?limit=999", "ann")).status, 400);
  assert.equal((await call("live", null, "?view=national", "anon")).status, 401);
  assert.equal((await call("live", "a.b.c", "?view=national", "anon")).status, 401);
  // not on the allowlist → the switch-off answer, same body
  const cy = await call("exchange", await wbToken(CY), "", "cy");
  assert.deepEqual([cy.status, cy.body], [503, OFF_BODY]);
  // deactivated mid-session
  accounts({ [ANN]: { ...active, active: false }, [BO]: active, [CY]: active });
  const inactive = await call("live", pass, "?view=national", "ann");
  assert.deepEqual([inactive.status, inactive.body.code], [403, "account_inactive"]);
  // verifier unreadable → fail closed
  fs.writeFileSync(verifierFile, "{not json");
  assert.deepEqual((await call("live", pass, "?view=national", "ann")).body, OFF_BODY);
  accounts({ [ANN]: active, [BO]: active, [CY]: active });
  assert.equal((await call("live", pass, "?view=national", "ann")).status, 200);
  // no row-id secret → the whole technician API is off (no raw-id fallback)
  const saved = process.env.ARENA_ROW_ID_SECRET;
  process.env.ARENA_ROW_ID_SECRET = "short";
  try {
    // An unreadable configuration allows no browser origin (403 forbidden, as for any other
    // configuration problem); either way nothing is served.
    const FORBIDDEN = { error: "Origin not allowed", code: "forbidden" };
    const r = await call("live", pass, "?view=national", "ann");
    assert.deepEqual([r.status, r.body], [403, FORBIDDEN]);
    assert.deepEqual((await call("leaderboard", pass, "?view=national", "ann")).body, FORBIDDEN);
    assert.equal((await call("exchange", await wbToken(ANN), "", "ann")).status, 403);
  } finally {
    process.env.ARENA_ROW_ID_SECRET = saved;
  }
});

test("privacy scan: every body seen in this file carries no account id but the caller's own", () => {
  const own: Record<string, string | null> = { ann: ANN, bo: BO, cy: CY, anon: null };
  assert.ok(seen.length >= 25, `scanned ${seen.length}`);
  for (const s of seen) {
    const found = [...new Set(s.text.match(UUID) ?? [])].map((x) => x.toLowerCase());
    assert.deepEqual(found.filter((x) => x !== own[s.who]), [], `${s.who} ${s.what} (${s.status}) carries another account id`);
    assert.doesNotMatch(s.text, /Fictional Road|LR-\d|555000|"Ann"|"Bo"|"Cy"|"(totalPaid\w*|techParts|companyParts|profit\w*|commission\w*|payout\w*)"\s*:/i, `${s.what}: CRM/customer/financial field`);
  }
  assert.ok(seen.some((s) => s.status >= 400), "error bodies were scanned too");
});
