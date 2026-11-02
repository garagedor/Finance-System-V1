/**
 * DEV ONLY — end-to-end proof of the shadow preflight and the simulated approval
 * against the LOCAL access-controlled mongod (127.0.0.1:27032, fictional `ag`
 * copy, users from ~/arena-dev/shadow-ro-setup.mjs) and the local dev mongod
 * (127.0.0.1:27031) for Arena state. Not part of `npm test` (needs both servers).
 *
 *   node --test --import ./scripts/arena/transpile-register.mjs scripts/arena/shadow-tooling.e2e.test.ts
 *
 * Credentials are read from ~/arena-dev/shadow-ro.env (mode 600) into child
 * process environments only; nothing here prints them. Every URI must point at
 * 127.0.0.1:27032 or the suite refuses to run. Arena state goes to a throwaway
 * database (arena_shadow_e2e_<pid>) that is dropped at the end.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { MongoClient } from "mongodb";
import { SEED_BALANCED_PERFORMANCE, rulesHash } from "../../src/lib/arena/config.ts";
import { DECISIONS_SCHEMA } from "./lib-shadow.ts";
import { weekStartOf } from "../../src/lib/arena/week.ts";

const REPO = path.resolve(import.meta.dirname, "../..");
const ENV_FILE = path.join(os.homedir(), "arena-dev", "shadow-ro.env");
const LOCAL = "mongodb://127.0.0.1:27031";
// ARENA_E2E_DB_PREFIX renames the throwaway database (default arena_shadow_e2e; e.g. arena_int_tooling).
const DB_PREFIX = process.env.ARENA_E2E_DB_PREFIX ?? "arena_shadow_e2e";
if (!/^arena_[a-z0-9_]+$/.test(DB_PREFIX) || /^arena_(shadow|trial|preview|dev|wtshadow)(?!_e2e$)/.test(DB_PREFIX)) throw new Error(`refusing ARENA_E2E_DB_PREFIX ${DB_PREFIX}`);
const DB = `${DB_PREFIX}_${process.pid}`;
const env = Object.fromEntries(
  fs.readFileSync(ENV_FILE, "utf8").split("\n").map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l)).filter(Boolean).map((m) => [m![1], m![2]]),
) as Record<string, string>;
for (const k of ["ARENA_CRM_RO_URI", "ARENA_CRM_RO_URI_NOUSER", "ARENA_CRM_URI_LBS_OPS", "ARENA_CRM_URI_RW", "ARENA_CRM_URI_ROOT"])
  if (!/@127\.0\.0\.1:27032\//.test(env[k] ?? "")) throw new Error(`refusing: ${k} must point at the local 127.0.0.1:27032 test server`);

const tmp = (mode = 0o700) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "arena-shadow-e2e-")); fs.chmodSync(d, mode); return d; };
const SHADOW = tmp();
const OUT = tmp();
// The scenarios below were written for the 6-place prizes: they name that code seed explicitly.
const TEMPLATE = "balanced-v1";
const FP = rulesHash(SEED_BALANCED_PERFORMANCE);
const writeShadow = (files: Record<string, string | null>, dir = SHADOW) => {
  for (const [f, c] of Object.entries(files)) {
    const p = path.join(dir, f);
    if (c === null) fs.rmSync(p, { force: true });
    else fs.writeFileSync(p, c, { mode: 0o600 });
  }
};
const DECISIONS = {
  schema: DECISIONS_SCHEMA,
  exclusions: [
    { crmName: "CHICAGO", category: "location_pool", reason: "location pool (fictional)" },
    { crmName: "Sub Demo", category: "subcontractor", reason: "subcontractor (fictional)" },
  ],
  mappings: [{ crmName: "Benny", status: "pending_identification", competitorId: null, reason: "office to identify" }],
  countOnceDuplicateGroups: [{ technician: "Sofia R.", date: "2026-10-14", profit: null, status: "pending_office_confirmation", excludeJobIds: [], reason: "count once — pending office confirmation" }],
  displayNameOverrides: [{ fullName: "דנה לוי", competitorId: null, displayName: "Dana L.", reason: "English display name" }],
};

interface Run { code: number; out: string; err: string }
function run(script: string, args: string[], extra: Record<string, string> = {}): Promise<Run> {
  const childEnv = { PATH: process.env.PATH!, HOME: os.homedir(), ARENA_SHADOW_LOCAL_URI: LOCAL, ARENA_SHADOW_DB: DB, ARENA_CRM_RO_URI: env.ARENA_CRM_RO_URI, ...extra };
  return new Promise((resolve) => {
    execFile(process.execPath, ["--no-warnings", "--import", "./scripts/arena/transpile-register.mjs", `scripts/arena/${script}`, ...args],
      { cwd: REPO, env: childEnv, timeout: 120_000, maxBuffer: 16 << 20 }, (e, out, err) => {
        const code = e ? (typeof (e as { code?: unknown }).code === "number" ? (e as { code: number }).code : 1) : 0;
        resolve({ code, out: String(out), err: String(err) });
      });
  });
}
const preflight = (args: string[] = [], extra: Record<string, string> = {}) =>
  run("shadow-preflight.ts", ["--template", TEMPLATE, "--out", OUT, "--shadow-dir", SHADOW, "--no-clock-check", ...args], extra);
const failLines = (r: Run) => r.out.split("\n").filter((l) => l.startsWith("FAIL"));
const noSecrets = (r: Run) => {
  for (const k of Object.keys(env)) if (/URI/.test(k)) {
    const pw = /:\/\/[^:]+:([^@]+)@/.exec(env[k])?.[1];
    if (pw) assert.ok(!r.out.includes(pw) && !r.err.includes(pw), `output leaks the password of ${k}`);
  }
};

// Fingerprint of every collection of a database (count + sha256 of the documents in _id order).
async function fingerprint(uri: string, db: string): Promise<Record<string, string>> {
  const c = await MongoClient.connect(uri);
  try {
    const out: Record<string, string> = {};
    for (const { name } of await c.db(db).listCollections({}, { nameOnly: true }).toArray()) {
      const docs = await c.db(db).collection(name).find({}).sort({ _id: 1 }).toArray();
      out[name] = `${docs.length}:${createHash("sha256").update(JSON.stringify(docs)).digest("hex").slice(0, 16)}`;
    }
    return out;
  } finally {
    await c.close();
  }
}
const crmFingerprint = () => fingerprint(env.ARENA_CRM_URI_ROOT, "ag");
let crmBefore: Record<string, string>;
let localBefore: { ag: Record<string, string>; shadow: Record<string, string>; dbs: string[] };
const BUILTIN_USER = "arena_builtin_read_e2e";
const builtinPw = randomBytes(18).toString("base64url");
const builtinUri = env.ARENA_CRM_URI_ROOT.replace(/\/\/[^@]+@/, `//${BUILTIN_USER}:${builtinPw}@`);

before(async () => {
  writeShadow({ "decisions.json": JSON.stringify(DECISIONS, null, 1), "approved-rules.sha256": `${FP}\n` });
  crmBefore = await crmFingerprint();
  const local = await MongoClient.connect(LOCAL);
  localBefore = {
    ag: await fingerprint(LOCAL, "ag"), shadow: await fingerprint(LOCAL, "arena_shadow"),
    dbs: (await local.db().admin().listDatabases()).databases.map((d) => d.name).sort(),
  };
  await local.close();
  const root = await MongoClient.connect(env.ARENA_CRM_URI_ROOT);
  await root.db("admin").command({ dropUser: BUILTIN_USER }).catch(() => {});
  await root.db("admin").command({ createUser: BUILTIN_USER, pwd: builtinPw, roles: [{ role: "read", db: "ag" }] });
  await root.close();
});

after(async () => {
  const root = await MongoClient.connect(env.ARENA_CRM_URI_ROOT);
  await root.db("admin").command({ dropUser: BUILTIN_USER }).catch(() => {});
  await root.close();
  const local = await MongoClient.connect(LOCAL);
  await local.db(DB).dropDatabase();
  await local.close();
  for (const d of [SHADOW, OUT]) fs.rmSync(d, { recursive: true, force: true });
});

// ── preflight ──────────────────────────────────────────────────────────────

test("preflight: all PASS with the read-only user and the owner's files", async () => {
  const r = await preflight();
  noSecrets(r);
  assert.equal(r.code, 0, r.out + r.err);
  assert.deepEqual(failLines(r), []);
  for (const id of ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9"]) assert.match(r.out, new RegExp(`^PASS  ${id} `, "m"), `${id} missing`);
  assert.match(r.out, /PASS  F2  server refuses a write on Job — code 13 Unauthorized/);
  assert.match(r.out, /PASS  F2  server refuses find on a non-granted collection \(users\) — code 13/);
  for (const c of ["Job", "Technician", "Location", "Provider", "TechNameMapping"]) assert.match(r.out, new RegExp(`PASS  F3  readable: ${c}$`, "m"));
  assert.match(r.out, /NOTE  F3  User readable \(optional\)/);
  assert.match(r.out, new RegExp(`fingerprint \\(SHA-256 of the canonical JSON\\): ${FP}`));
  assert.match(r.out, /PREFLIGHT PASSED/);
});

test("preflight: User not granted → note only, still PASS", async () => {
  const r = await preflight([], { ARENA_CRM_RO_URI: env.ARENA_CRM_RO_URI_NOUSER });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /NOTE  F3  User not granted \(optional\)/);
});

test("preflight F1/F2/F3: read-write user, lbs_ops, a built-in `read` user and an unauthenticated server are refused", async () => {
  for (const [uri, re] of [
    [env.ARENA_CRM_URI_RW, /non-read action/],
    [env.ARENA_CRM_URI_LBS_OPS, /lbs_ops.*never allowed/],
    [builtinUri, /built-in role\(s\) read@ag/],
    ["mongodb://127.0.0.1:27031/", /not authenticated/],
  ] as const) {
    const r = await preflight([], { ARENA_CRM_RO_URI: uri });
    noSecrets(r);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /^FAIL  F1  read-only CRM user — REFUSED/m);
    assert.match(r.out, re);
    assert.match(r.out, /^FAIL  F2 .*not run/m);
    assert.match(r.out, /^FAIL  F3 .*not run/m);
  }
});

test("preflight F4: a non-127.0.0.1 or unreachable local state FAILs", async () => {
  let r = await preflight([], { ARENA_SHADOW_LOCAL_URI: "mongodb://localhost:27031" });
  assert.equal(r.code, 1);
  assert.match(r.out, /^FAIL  F4 .*127\.0\.0\.1 only/m);
  r = await preflight([], { ARENA_SHADOW_LOCAL_URI: "mongodb://127.0.0.1:1" });
  assert.equal(r.code, 1);
  assert.match(r.out, /^FAIL  F4 /m);
});

test("preflight F5: unconfirmed or changed rules FAIL; --print-only only prints", async () => {
  writeShadow({ "approved-rules.sha256": null });
  let r = await preflight();
  assert.equal(r.code, 1);
  assert.match(r.out, /^FAIL  F5  rules fingerprint — owner has not confirmed rules yet/m);
  r = await preflight(["--print-only"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^INFO  F5  rules fingerprint — owner has not confirmed rules yet/m);
  writeShadow({ "approved-rules.sha256": `${"0".repeat(64)}\n` });
  r = await preflight();
  assert.equal(r.code, 1);
  assert.match(r.out, /^FAIL  F5  rules fingerprint — DIFFERS/m);
  writeShadow({ "approved-rules.sha256": `${FP}\n` });
});

test("preflight F6: decisions file absent or invalid FAILs", async () => {
  writeShadow({ "decisions.json": null });
  let r = await preflight();
  assert.equal(r.code, 1);
  assert.match(r.out, /^FAIL  F6  data-review decisions — .*file not found/m);
  writeShadow({ "decisions.json": JSON.stringify({ ...DECISIONS, exclusions: [{ crmName: "X", category: "pool", reason: "r" }] }) });
  r = await preflight();
  assert.equal(r.code, 1);
  assert.match(r.out, /^FAIL  F6 .*category must be one of/m);
  writeShadow({ "decisions.json": JSON.stringify(DECISIONS, null, 1) });
});

test("preflight F7: technician switch / Supabase variables / a public listener on an Arena port FAIL", async () => {
  let r = await preflight([], { ARENA_TECH_ENABLED: "1" });
  assert.equal(r.code, 1);
  assert.match(r.out, /^FAIL  F7  no technician-access .* — set: ARENA_TECH_ENABLED/m);
  r = await preflight([], { VITE_SUPABASE_URL: "https://example.invalid" });
  assert.match(r.out, /^FAIL  F7 .*set: VITE_SUPABASE_URL/m);
  const srv = net.createServer();
  await new Promise<void>((ok) => srv.listen(0, "0.0.0.0", ok));
  const port = (srv.address() as net.AddressInfo).port;
  try {
    r = await preflight(["--arena-ports", String(port)]);
    assert.equal(r.code, 1);
    assert.match(r.out, new RegExp(`^FAIL  F7  nothing public on the Arena ports ${port} — listening publicly: 0\\.0\\.0\\.0:${port}`, "m"));
  } finally {
    srv.close();
  }
  const loop = net.createServer();
  await new Promise<void>((ok) => loop.listen(0, "127.0.0.1", ok));
  const lp = (loop.address() as net.AddressInfo).port;
  try {
    r = await preflight(["--arena-ports", String(lp)]);
    assert.match(r.out, new RegExp(`^PASS  F7  nothing public on the Arena ports ${lp} — loopback only: 127\\.0\\.0\\.1:${lp}`, "m"));
  } finally {
    loop.close();
  }
});

test("preflight F8/F9: open or in-repo output folder, too little disk FAIL", async () => {
  const open = tmp(0o755);
  let r = await preflight(["--out", open]);
  assert.equal(r.code, 1);
  assert.match(r.out, /^FAIL  F8 .*mode 755/m);
  const repo = tmp();
  fs.mkdirSync(path.join(repo, ".git"));
  fs.mkdirSync(path.join(repo, "out"), { mode: 0o700 });
  r = await preflight(["--out", path.join(repo, "out")]);
  assert.match(r.out, /^FAIL  F8 .*inside the git repository/m);
  r = await preflight(["--min-free-gb", "100000000"]);
  assert.match(r.out, /^FAIL  F9  free disk ≥ 100000000 GB/m);
  for (const d of [open, repo]) fs.rmSync(d, { recursive: true, force: true });
});

// ── simulated approval ─────────────────────────────────────────────────────

const approve = (week: string, args: string[] = [], extra: Record<string, string> = {}) =>
  run("shadow-approve.ts", [week, OUT, "--template", TEMPLATE, "--decisions", path.join(SHADOW, "decisions.json"), "--rules-confirmation", path.join(SHADOW, "approved-rules.sha256"), ...args], extra);
const report = (week: string) => fs.readFileSync(path.join(OUT, `${week}-simulated-approval`, "report.md"), "utf8");
const dataOf = (week: string) => JSON.parse(fs.readFileSync(path.join(OUT, `${week}-simulated-approval`, "data.json"), "utf8"));
async function localDb<T>(fn: (db: import("mongodb").Db) => Promise<T>): Promise<T> {
  const c = await MongoClient.connect(LOCAL);
  try { return await fn(c.db(DB)); } finally { await c.close(); }
}

test("approve: refuses an output folder inside a git repository before touching any database", async () => {
  const inRepo = await run("shadow-approve.ts", ["2026-10-12", path.join(REPO, "tmp-shadow-e2e")]);
  assert.equal(inRepo.code, 1);
  assert.match(inRepo.err, /inside the git repository/);
  assert.equal(fs.existsSync(path.join(REPO, "tmp-shadow-e2e")), false);
});

test("approve 2026-10-12: a pending duplicate that could change prizes blocks the real lifecycle; confirming it lets the simulation approve", async () => {
  let r = await approve("2026-10-12", ["--accept-unverified-for-simulation"]);
  noSecrets(r);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(report("2026-10-12"), /REFUSED — nothing approved/);
  assert.match(report("2026-10-12"), /suspected duplicate group\(s\) could change prizes/);
  const d = dataOf("2026-10-12");
  assert.equal(d.simulated, true);
  const labels = d.decisions.plan.apply.map((a: { label: string }) => a.label).join("\n");
  assert.match(labels, /exclude "CHICAGO" \(location_pool\)/);
  assert.match(labels, /exclude "Sub Demo" \(subcontractor\)/);
  assert.match(labels, /display name "Dana L\."/);
  const note = d.decisions.plan.notes.find((n: string) => /pending office confirmation Sofia R\./.test(n));
  assert.ok(note, JSON.stringify(d.decisions.plan.notes));
  assert.ok(d.decisions.plan.notes.some((n: string) => /"Benny" pending identification/.test(n)));
  const ids = /jobs (.+)$/.exec(note)![1].split(", ");
  assert.equal(ids.length, 2);
  assert.equal(await localDb((db) => db.collection("arena_result").countDocuments()), 0, "nothing approved");

  writeShadow({ "decisions.json": JSON.stringify({ ...DECISIONS, countOnceDuplicateGroups: [{ ...DECISIONS.countOnceDuplicateGroups[0], status: "confirmed", excludeJobIds: [ids[1]], reason: "office: one invoice" }] }, null, 1) });
  r = await approve("2026-10-12", ["--accept-unverified-for-simulation"]);
  assert.equal(r.code, 0, r.out + r.err);
  const d2 = dataOf("2026-10-12");
  assert.equal(d2.outcome, "approved");
  assert.ok(d2.decisions.plan.apply.some((a: { label: string }) => /count once Sofia R\./.test(a.label)));
  assert.equal(d2.decisions.plan.alreadyInForce.length, 3, "exclusions + display name from the first run are in force");
  const md = report("2026-10-12");
  assert.match(md, /^> \*\*SIMULATION/m);
  assert.match(md, /Unverified prize positions — ACCEPTED FOR SIMULATION ONLY:\*\* #1 /);
  assert.match(md, /## History integrity: IDENTICAL/);
});

test("approve 2026-10-19: unverified prize positions refuse; the owner's accounts file lets it approve; writes only to the local db; CRM unchanged", async () => {
  let r = await approve("2026-10-19");
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.out, /Weekly Balance account standing is unverified for prize position\(s\) #1 /);
  const snap = dataOf("2026-10-19").reviewedSnapshot.result;
  const holders = snap.results.filter((x: { prizePosition: number | null; wonMostImproved: boolean }) => x.prizePosition !== null || x.wonMostImproved);
  assert.ok(holders.length >= 1);
  const accounts = Object.fromEntries(holders.map((x: { competitorId: string }) => [x.competitorId, "eligible"]));
  const accFile = path.join(SHADOW, "accounts.json");
  fs.writeFileSync(accFile, JSON.stringify(accounts), { mode: 0o600 });

  r = await approve("2026-10-19", ["--accounts", accFile]);
  assert.equal(r.code, 0, r.out + r.err);
  const d = dataOf("2026-10-19");
  assert.equal(d.outcome, "approved");
  assert.deepEqual(d.accounts.unverifiedPrizePositions, []);
  assert.equal(d.result.approvedBy, "shadow-simulation");
  assert.match(d.result.note, /^SIMULATION/);
  assert.equal(d.safety.ok, true);
  assert.equal(d.safety.crmWriteAttemptsBlocked, 0);
  assert.deepEqual(d.safety.financeCollectionsOpened, []);
  assert.deepEqual(d.safety.nonArenaLocalWrites, []);
  for (const c of d.safety.crmCollectionsOpened) assert.ok(["Job", "Technician", "TechNameMapping"].includes(c), c);
  for (const w of d.safety.localWrites) assert.match(w, new RegExp(`^${DB}\\.arena_`));
  assert.equal(d.integrity.mismatched, 0);
  assert.ok(d.integrity.identical >= 2);
  // simulated: true on the records themselves
  const [res, appr, comp] = await localDb((db) => Promise.all([
    db.collection("arena_result").findOne({ _id: "arena_2026-10-19" as never }),
    db.collection("arena_approval").findOne({ competitionId: "arena_2026-10-19" }),
    db.collection("arena_competition").findOne({ _id: "arena_2026-10-19" as never }),
  ]));
  assert.equal(res?.simulated, true);
  assert.equal(appr?.simulated, true);
  assert.equal(comp?.simulated, true);
  assert.equal(comp?.status, "approved");
  // file modes
  for (const f of ["report.md", "data.json"]) assert.equal(fs.statSync(path.join(OUT, "2026-10-19-simulated-approval", f)).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(OUT, "2026-10-19-simulated-approval")).mode & 0o777, 0o700);

  // re-run: already approved, nothing changes
  const hash = res?.contentHash;
  r = await approve("2026-10-19", ["--accounts", accFile]);
  assert.equal(r.code, 0, r.out);
  assert.equal(dataOf("2026-10-19").outcome, "already_approved");
  assert.equal(await localDb((db) => db.collection("arena_result").countDocuments({ _id: "arena_2026-10-19" as never })), 1);
  assert.equal((await localDb((db) => db.collection("arena_result").findOne({ _id: "arena_2026-10-19" as never })))?.contentHash, hash);
});

const CURRENT_WEEK = weekStartOf(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()));
test(`approve the current week ${CURRENT_WEEK} (not ended): refused; --allow-early runs on a simulated clock with a loud warning`, async () => {
  let r = await approve(CURRENT_WEEK, ["--accept-unverified-for-simulation"]);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.out, /has not ended/);
  r = await approve(CURRENT_WEEK, ["--accept-unverified-for-simulation", "--allow-early"]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.err, /--allow-early: .*TESTING ONLY/s);
  assert.match(report(CURRENT_WEEK), /--allow-early \(TESTING ONLY\)/);
  assert.equal(dataOf(CURRENT_WEEK).clock.simulated, true);
});

test("after every run: the CRM (27032) is byte-identical and the local dev databases other than the e2e one are untouched", async () => {
  assert.deepEqual(await crmFingerprint(), crmBefore, "CRM fingerprint changed");
  assert.ok(Object.keys(crmBefore).some((k) => k.startsWith("finance_")), "the fingerprint covers the finance_* collections");
  assert.deepEqual(await fingerprint(LOCAL, "ag"), localBefore.ag);
  assert.deepEqual(await fingerprint(LOCAL, "arena_shadow"), localBefore.shadow);
  const c = await MongoClient.connect(LOCAL);
  const dbs = (await c.db().admin().listDatabases()).databases.map((d) => d.name).sort();
  await c.close();
  assert.deepEqual(dbs.filter((d) => d !== DB), localBefore.dbs.filter((d) => d !== DB));
  // Final integrity over every approved simulation in the e2e database.
  const r = await approve("2026-10-19");
  assert.match(r.out, /integrity IDENTICAL \(\d+ identical, 0 mismatched\)/);
});
