// Route-level pilot drill: the REAL Next route handlers (POST /api/arena/auth/exchange,
// GET /api/arena/tech/me) over a real MongoDB driver, a fake-dev verifier file and a
// stubbed Weekly Balance JWKS. Proves, end to end:
//   - switch ON + empty allowlist → everyone gets the switch-OFF answer;
//   - owner grant → exchange + /me work; revoke → the SAME unexpired pass is refused
//     on the next request; revoke-all likewise;
//   - switch OFF (env) → the next request is refused even with an unexpired pass;
//   - verifier failure fails closed; a deactivated account is refused mid-session;
//   - nothing is written to the CRM database.
//
// MongoDB: an in-memory server by default. Set ARENA_WTPILOT_MONGO_URI (e.g. the
// local dev server mongodb://127.0.0.1:27031) to run against a real server instead;
// it then uses two fresh databases named arena_wtpilot_<pid>_{arena,crm} and drops
// them afterwards. It never opens any other database.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";

const REF = "pilotdrillrefaaaaaaa"; // 20 chars, fictional
const WB = `https://${REF}.supabase.co`;
const ANN = "11111111-1111-4111-8111-111111111111";
const BO = "22222222-2222-4222-8222-222222222222";
const OWNER = "owner-pilot";
const OFF_BODY = { error: "The Arena is not available right now", code: "arena_disabled" };

const external = process.env.ARENA_WTPILOT_MONGO_URI;
const prefix = `arena_wtpilot_${process.pid}`;
let server: MongoMemoryServer | null = null;
let client: MongoClient;
let arena: Db, crm: Db;
const dir = mkdtempSync(join(tmpdir(), "arena-wtpilot-"));
const verifierFile = join(dir, "accounts.json");
const accounts = (a: Record<string, { active: boolean; approved: boolean; role: string }>) =>
  writeFileSync(verifierFile, JSON.stringify({ accounts: a }));

const wb = await generateKeyPair("ES256");
const jwk = { ...(await exportJWK(wb.publicKey)), kid: "pilot1", alg: "ES256", use: "sig" };
const realFetch = globalThis.fetch;

// The route handlers open their own (dedicated, ARENA_MONGODB_URI) client and keep it,
// as in production; track it so the drill can close it and the process can exit.
const opened: MongoClient[] = [];
const realConnect = MongoClient.connect.bind(MongoClient);
MongoClient.connect = (async (...a: Parameters<typeof MongoClient.connect>) => {
  const c = await realConnect(...a);
  opened.push(c);
  return c;
}) as typeof MongoClient.connect;

let routes: {
  exchangePOST: (r: Request) => Promise<Response>;
  meGET: (r: Request) => Promise<Response>;
};
let lib: typeof import("./allowlist.ts");
let storeCtx: import("../config-store.ts").StoreContext;
let accessColl: import("./allowlist.ts").TechAccessCollection;
let crmFingerprintBefore: string;

async function fingerprint(db: Db) {
  const out: string[] = [];
  for (const c of (await db.listCollections().toArray()).map((x) => x.name).sort())
    out.push(c, JSON.stringify(await db.collection(c).find({}).sort({ _id: 1 }).toArray()));
  return createHash("sha256").update(out.join("|")).digest("hex");
}

before(async () => {
  let uri = external;
  if (!uri) {
    server = await MongoMemoryServer.create();
    uri = server.getUri();
  }
  client = await MongoClient.connect(uri, { serverSelectionTimeoutMS: 5000 });
  arena = client.db(`${prefix}_arena`);
  crm = client.db(`${prefix}_crm`);
  await crm.collection("TechNameMapping").insertMany([
    { _id: "m1", supabaseUserId: ANN, supabaseFullName: "Ann Able", crmTechNames: ["Ann"] },
    { _id: "m2", supabaseUserId: BO, supabaseFullName: "Bo Baker", crmTechNames: ["Bo"] },
  ] as never);
  await crm.collection("Technician").insertMany([{ _id: "Ann", location: "Columbus" }, { _id: "Bo", location: "Chicago" }] as never);
  crmFingerprintBefore = await fingerprint(crm);
  accounts({ [ANN]: { active: true, approved: true, role: "technician" }, [BO]: { active: true, approved: true, role: "technician" } });

  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  Object.assign(process.env, {
    ARENA_TECH_ENABLED: "1",
    ARENA_WB_SUPABASE_URL: WB,
    ARENA_PASS_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    ARENA_TECH_ALLOWED_ORIGINS: "capacitor://localhost",
    ARENA_ROW_ID_SECRET: "pilot-routes-row-id-secret-0123456789",
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
    if (url.startsWith(WB)) throw new TypeError("unexpected Weekly Balance call in the drill");
    return realFetch(input as never, init);
  }) as typeof fetch;

  const ex = await import("../../../app/api/arena/auth/exchange/route.ts");
  const me = await import("../../../app/api/arena/tech/me/route.ts");
  routes = { exchangePOST: ex.POST, meGET: me.GET };
  lib = await import("./allowlist.ts");
  const { buildArenaContexts } = await import("../admin-service.ts");
  const { initSettings } = await import("../config-store.ts");
  const { ARENA_COLLECTIONS } = await import("../mongo-store.ts");
  const ctx = buildArenaContexts(arena, crm);
  storeCtx = ctx.config;
  accessColl = arena.collection(ARENA_COLLECTIONS.techAccess) as never;
  await initSettings(storeCtx, { budgetCeilingCents: 150_000, ownerUserId: OWNER, approverUserIds: [OWNER] }, OWNER);
});

after(async () => {
  globalThis.fetch = realFetch;
  try {
    if (await crm.collection("TechNameMapping").countDocuments()) assert.equal(await fingerprint(crm), crmFingerprintBefore, "the CRM database was not changed");
  } finally {
    await arena.dropDatabase();
    await crm.dropDatabase();
    await client.close();
    for (const c of opened) await c.close();
    await server?.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

const sec = () => Math.floor(Date.now() / 1000);
const wbToken = (sub: string) =>
  new SignJWT({ role: "authenticated" }).setProtectedHeader({ alg: "ES256", kid: "pilot1" }).setSubject(sub)
    .setIssuer(`${WB}/auth/v1`).setAudience("authenticated").setIssuedAt(sec() - 5).setExpirationTime(sec() + 3600).sign(wb.privateKey);

async function call(kind: "exchange" | "me", bearer: string) {
  const init = { method: kind === "exchange" ? "POST" : "GET", headers: { authorization: `Bearer ${bearer}`, origin: "capacitor://localhost" } };
  const res = kind === "exchange"
    ? await routes.exchangePOST(new Request("https://app.test/api/arena/auth/exchange", init))
    : await routes.meGET(new Request("https://app.test/api/arena/tech/me", init));
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, cache: res.headers.get("cache-control") };
}

async function passFor(sub: string) {
  const r = await call("exchange", await wbToken(sub));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.pass as string;
}

test("drill: switch ON, empty allowlist → exchange answers exactly like switch OFF", async () => {
  const on = await call("exchange", await wbToken(ANN));
  process.env.ARENA_TECH_ENABLED = "0";
  const off = await call("exchange", await wbToken(ANN));
  process.env.ARENA_TECH_ENABLED = "1";
  assert.deepEqual([on.status, on.body], [503, OFF_BODY]);
  assert.deepEqual([on.status, on.body, on.cache], [off.status, off.body, off.cache]);
});

test("drill: owner grant → exchange + /me work; a non-owner grant is refused", async () => {
  await assert.rejects(lib.setTechAccess(storeCtx, accessColl, ANN, true, "admin-x", "pilot"), /only the owner/);
  await lib.setTechAccess(storeCtx, accessColl, ANN, true, OWNER, "pilot cohort");
  const pass = await passFor(ANN);
  const me = await call("me", pass);
  assert.equal(me.status, 200, JSON.stringify(me.body));
  assert.equal((me.body.competitor as { id: string }).id, ANN);
  // Bo is mapped and active but not allowlisted: switch-off answer.
  assert.deepEqual((await call("exchange", await wbToken(BO))).body, OFF_BODY);
});

test("drill: allowlist revoke → the SAME unexpired pass is refused on the next request (immediate)", async () => {
  await lib.setTechAccess(storeCtx, accessColl, ANN, true, OWNER, "pilot cohort");
  const pass = await passFor(ANN);
  assert.equal((await call("me", pass)).status, 200);
  const t0 = Date.now();
  await lib.setTechAccess(storeCtx, accessColl, ANN, false, OWNER, "drill: removed mid-session");
  const r = await call("me", pass);
  assert.deepEqual([r.status, r.body], [503, OFF_BODY]);
  assert.ok(Date.now() - t0 < 5_000);
  assert.deepEqual((await call("exchange", await wbToken(ANN))).body, OFF_BODY, "no new pass either");
});

test("drill: emergency revoke-all → every live pass refused on the next request", async () => {
  await lib.setTechAccess(storeCtx, accessColl, ANN, true, OWNER, "pilot");
  await lib.setTechAccess(storeCtx, accessColl, BO, true, OWNER, "pilot");
  const [pa, pb] = [await passFor(ANN), await passFor(BO)];
  assert.equal((await call("me", pa)).status, 200);
  assert.equal((await call("me", pb)).status, 200);
  const revoked = await lib.revokeAllTechAccess(storeCtx, accessColl, OWNER, "drill: kill");
  assert.deepEqual(revoked.sort(), [ANN, BO].sort());
  for (const p of [pa, pb]) assert.deepEqual((await call("me", p)).body, OFF_BODY);
  const audit = await arena.collection("arena_audit").find({ action: "tech_access.revoke_all" }).toArray();
  assert.equal(audit.length, 2);
  assert.ok(audit.every((a) => a.by === OWNER && a.reason === "drill: kill" && typeof a.at === "string"));
});

test("drill: master switch OFF (env) → an already-issued, unexpired pass is refused on the next request", async () => {
  await lib.setTechAccess(storeCtx, accessColl, ANN, true, OWNER, "pilot");
  const pass = await passFor(ANN);
  assert.equal((await call("me", pass)).status, 200);
  process.env.ARENA_TECH_ENABLED = "0";
  try {
    const r = await call("me", pass);
    assert.deepEqual([r.status, r.body], [503, OFF_BODY]);
    assert.deepEqual((await call("exchange", await wbToken(ANN))).body, OFF_BODY);
  } finally {
    process.env.ARENA_TECH_ENABLED = "1";
  }
  assert.equal((await call("me", pass)).status, 200, "switching back on restores the still-valid pass (it is not revoked)");
});

test("drill: deactivated mid-session → 403 account_inactive; verifier unreadable → fail closed (503)", async () => {
  await lib.setTechAccess(storeCtx, accessColl, ANN, true, OWNER, "pilot");
  const pass = await passFor(ANN);
  accounts({ [ANN]: { active: false, approved: true, role: "technician" } });
  const r = await call("me", pass);
  assert.deepEqual([r.status, r.body.code], [403, "account_inactive"]);
  writeFileSync(verifierFile, "{not json");
  const down = await call("me", pass);
  assert.deepEqual([down.status, down.body], [503, OFF_BODY]);
  assert.equal((await call("exchange", await wbToken(ANN))).status, 503, "no pass while the verifier is unavailable");
  accounts({ [ANN]: { active: true, approved: true, role: "technician" }, [BO]: { active: true, approved: true, role: "technician" } });
  assert.equal((await call("me", pass)).status, 200);
});

test("drill: the allowlist and its audit live only in the Arena database", async () => {
  const names = (await arena.listCollections().toArray()).map((c) => c.name);
  assert.ok(names.includes("arena_tech_access"));
  assert.ok(names.every((n) => n.startsWith("arena_")), names.join(","));
  const crmNames = (await crm.listCollections().toArray()).map((c) => c.name).sort();
  assert.deepEqual(crmNames, ["TechNameMapping", "Technician"]);
});
