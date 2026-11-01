// Shadow tooling (scripts/arena/lib-shadow.ts, shadow-preflight.ts, shadow-approve.ts):
// decisions schema and plan, accounts file, rules fingerprint, private output folders,
// technician-access checks, write tracking — and the STRUCTURAL proof that the Arena
// code path cannot create a financial record. The end-to-end run against the local
// access-controlled mongod is scripts/arena/shadow-tooling.e2e.test.ts (dev only).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  DECISIONS_SCHEMA, clockSkew, ensurePrivateDir, gitRootOf, markSimulated, outputDirProblems, parseAccountsFile, parseListeners,
  planDecisions, publicArenaListeners, readDecisionsFile, readFingerprintFile, rulesFingerprint, rulesSummary, simulationAccounts,
  techAccessEnvVars, trackWrites, validateDecisions, type ShadowDecisions,
} from "../../../scripts/arena/lib-shadow.ts";
import { SEED_BALANCED_PERFORMANCE, canonicalJson, cloneRules } from "./config.ts";
import type { ReviewCaseDoc } from "./review.ts";

const REPO = path.resolve(import.meta.dirname, "../../..");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "arena-shadow-test-"));

const decisions = (over: Partial<ShadowDecisions> = {}): ShadowDecisions => ({
  schema: DECISIONS_SCHEMA,
  exclusions: [
    { crmName: "NORTH POOL", category: "location_pool", reason: "location pool" },
    { crmName: "Sub Zed", category: "subcontractor", reason: "subcontractor" },
    { crmName: "Old Timer", category: "former_technician", reason: "1 job in August" },
  ],
  mappings: [
    { crmName: "Kim", status: "pending_identification", competitorId: null, reason: "office to identify" },
    { crmName: "J. Doe", status: "attach", competitorId: "p-1", reason: "second CRM name of Jane Doe" },
  ],
  countOnceDuplicateGroups: [
    { technician: "Jane", date: "2026-10-20", profit: 300, status: "confirmed", excludeJobIds: ["j2"], reason: "one invoice" },
    { technician: "Rob", date: "2026-10-21", profit: 99.5, status: "pending_office_confirmation", excludeJobIds: [], reason: "count once — pending office confirmation" },
  ],
  displayNameOverrides: [{ fullName: "יוסי כהן", competitorId: null, displayName: "Yossi C.", reason: "English name" }],
  ...over,
});

const kase = (kind: ReviewCaseDoc["kind"], key: string, data: unknown, status: ReviewCaseDoc["status"] = "open", resolution: ReviewCaseDoc["resolution"] = null): ReviewCaseDoc => ({
  _id: `${kind}:${key}`, kind, key, status, data: data as never, weeks: ["2026-10-19"], firstSeenAt: "", lastSeenAt: "",
  resolution, reason: null, decidedBy: null, decidedAt: null, confirmedBy: null, confirmedAt: null, version: 1,
});
const identityCase = (crmName: string, jobs = 3) => kase("identity_name", crmName, { issue: "unmapped_name", crmName, candidates: [], jobs, locations: [], suggestedCategory: null });
const dupCase = (who: string, date: string, jobs: { id: string; profit: number }[]) =>
  kase("duplicate_group", jobs.map((j) => j.id).join(","), {
    weekStart: "2026-10-19", date, competitorId: "x", competitorName: who, likely: true, mayAffectPrizes: true,
    jobs: jobs.map((j) => ({ id: j.id, tech: who, status: "Closed", profit: j.profit })),
  });

// ── decisions schema ───────────────────────────────────────────────────────

test("decisions: a complete file validates", () => {
  const r = validateDecisions(decisions());
  assert.deepEqual(r.problems, []);
  assert.ok(r.decisions);
});

test("decisions: every malformed entry is reported", () => {
  const bad = (over: Partial<ShadowDecisions> | Record<string, unknown>, re: RegExp) => {
    const r = validateDecisions({ ...decisions(), ...over });
    assert.equal(r.decisions, null);
    assert.ok(r.problems.some((p) => re.test(p)), `${re} not in ${JSON.stringify(r.problems)}`);
  };
  bad({ schema: "v0" } as never, /schema/);
  bad({ exclusions: "x" } as never, /exclusions" must be a list/);
  bad({ exclusions: [{ crmName: "A", category: "pool", reason: "r" }] } as never, /category must be one of/);
  bad({ exclusions: [{ crmName: "A", category: "subcontractor", reason: "" }] } as never, /reason is required/);
  bad({ mappings: [{ crmName: "A", status: "attach", competitorId: null, reason: "r" }] } as never, /attach needs competitorId/);
  bad({ mappings: [{ crmName: "A", status: "pending_identification", competitorId: "p", reason: "r" }] } as never, /pending name has competitorId null/);
  bad({ mappings: [{ crmName: "NORTH POOL", status: "pending_identification", competitorId: null, reason: "r" }] } as never, /decided twice/);
  bad({ countOnceDuplicateGroups: [{ technician: "A", date: "2026-10-20", profit: 1, status: "confirmed", excludeJobIds: [], reason: "r" }] } as never, /needs excludeJobIds/);
  bad({ countOnceDuplicateGroups: [{ technician: "A", date: "20/10/2026", profit: 1, status: "pending_office_confirmation", excludeJobIds: [], reason: "r" }] } as never, /YYYY-MM-DD/);
  bad({ displayNameOverrides: [{ fullName: "x", competitorId: null, displayName: "יובל", reason: "r" }] } as never, /Latin letters/);
  assert.match(validateDecisions(null).problems[0], /not a JSON object/);
});

test("decisions file: missing / not JSON / valid", () => {
  const d = tmp();
  assert.deepEqual(readDecisionsFile(path.join(d, "decisions.json")).problems, ["file not found"]);
  fs.writeFileSync(path.join(d, "bad.json"), "{nope");
  assert.match(readDecisionsFile(path.join(d, "bad.json")).problems[0], /not valid JSON/);
  fs.writeFileSync(path.join(d, "ok.json"), JSON.stringify(decisions()));
  assert.ok(readDecisionsFile(path.join(d, "ok.json")).decisions);
});

// ── decisions → review resolutions ─────────────────────────────────────────

test("plan: exclusions, attach, confirmed duplicates and display names become Arena review resolutions; pending ones change nothing", () => {
  const cases = [
    identityCase("NORTH POOL", 40), identityCase("Sub Zed"), identityCase("Kim", 4), identityCase("J. Doe"),
    dupCase("Jane", "2026-10-20", [{ id: "j1", profit: 300 }, { id: "j2", profit: 300 }]),
    dupCase("Rob", "2026-10-21", [{ id: "r1", profit: 99.5 }, { id: "r2", profit: 99.5 }]),
    kase("display_name", "p-9", { competitorId: "p-9", currentName: "יוסי כ.", crmNames: ["Yossi"], reason: "needs_english", fullName: "יוסי כהן" }),
  ];
  const plan = planDecisions(cases, decisions());
  const by = Object.fromEntries(plan.apply.map((a) => [a.caseId, a.resolution]));
  assert.deepEqual(by["identity_name:NORTH POOL"], { kind: "identity_not_competitor", category: "location_pool" });
  assert.deepEqual(by["identity_name:Sub Zed"], { kind: "identity_not_competitor", category: "subcontractor" });
  assert.deepEqual(by["identity_name:J. Doe"], { kind: "identity_attach", competitorId: "p-1" });
  assert.deepEqual(by["duplicate_group:j1,j2"], { kind: "duplicate_confirmed", excludeJobIds: ["j2"] });
  assert.deepEqual(by["display_name:p-9"], { kind: "display_name", displayName: "Yossi C." });
  assert.equal(by["identity_name:Kim"], undefined, "pending identification is never credited");
  assert.equal(by["duplicate_group:r1,r2"], undefined, "pending office confirmation counts both ways");
  assert.ok(plan.notes.some((n) => /Kim.*pending identification: 4 job/.test(n)));
  assert.ok(plan.notes.some((n) => /pending office confirmation Rob .*r1, r2/.test(n)));
  assert.ok(plan.notes.some((n) => /Old Timer.*no case this week/.test(n)));
  assert.ok(plan.apply.every((a) => a.reason.startsWith("decisions.json: ")));
  assert.deepEqual(plan.conflicts, []);
});

test("plan: an identical local decision is 'in force'; a different one is a conflict (refuses)", () => {
  const same = kase("identity_name", "NORTH POOL", { crmName: "NORTH POOL" }, "resolved", { kind: "identity_not_competitor", category: "location_pool" });
  const diff = kase("identity_name", "Sub Zed", { crmName: "Sub Zed" }, "resolved", { kind: "identity_attach", competitorId: "p-2" });
  const plan = planDecisions([same, diff], decisions());
  assert.equal(plan.apply.length, 0);
  assert.equal(plan.alreadyInForce.length, 1);
  assert.equal(plan.conflicts.length, 1);
  assert.match(plan.conflicts[0], /Sub Zed.*different resolved decision/);
});

test("plan: a confirmed duplicate whose jobs are not a group this week is only noted", () => {
  const plan = planDecisions([dupCase("Jane", "2026-10-20", [{ id: "j7", profit: 1 }, { id: "j8", profit: 1 }])], decisions());
  assert.equal(plan.apply.length, 0);
  assert.ok(plan.notes.some((n) => /count once Jane .*not a suspected group/.test(n)));
});

// ── accounts ───────────────────────────────────────────────────────────────

test("accounts file: states validated; missing = unverified, recorded as eligible (assumed) for the practice run only", () => {
  assert.match(parseAccountsFile([]).problems[0], /JSON object/);
  assert.match(parseAccountsFile({ a: "approved" }).problems[0], /not one of/);
  const { states } = parseAccountsFile({ a: "eligible", b: "pending" });
  const acc = simulationAccounts(states, "2026-11-01T00:00:00Z");
  const r = acc.lookup(["a", "b", "c"]);
  assert.deepEqual(r.a, { state: "eligible", checkedAt: "2026-11-01T00:00:00Z" });
  assert.deepEqual(r.b, { state: "pending", checkedAt: "2026-11-01T00:00:00Z" });
  assert.deepEqual(r.c, { state: "eligible", checkedAt: null });
  assert.deepEqual([...acc.assumed], ["c"]);
  assert.equal(acc.rawState("c"), "unverified");
  assert.equal(acc.rawState("b"), "pending");
});

// ── rules fingerprint ──────────────────────────────────────────────────────

test("rules fingerprint: SHA-256 of the canonical JSON, key-order independent, changes with any value", () => {
  const r = cloneRules(SEED_BALANCED_PERFORMANCE);
  const fp = rulesFingerprint(r);
  assert.equal(fp, createHash("sha256").update(canonicalJson(r)).digest("hex"));
  const reordered = Object.fromEntries(Object.entries(r).reverse()) as typeof r;
  assert.equal(rulesFingerprint(reordered), fp);
  const changed = cloneRules(r);
  changed.eligibility.minQualifyingJobs += 1;
  assert.notEqual(rulesFingerprint(changed), fp);
  const s = rulesSummary(r).join("\n");
  for (const want of [/BALANCED_PERFORMANCE_V1/, /minimums:/, /targets:/, /prizes:/, /budget/, /Most Improved:/, /qualifying statuses:/, /review window:/]) assert.match(s, want);
});

test("fingerprint file: absent → null, junk → empty, `sha256sum` style accepted", () => {
  const d = tmp();
  const f = path.join(d, "approved-rules.sha256");
  assert.equal(readFingerprintFile(f), null);
  fs.writeFileSync(f, "owner says ok\n");
  assert.equal(readFingerprintFile(f), "");
  fs.writeFileSync(f, `${"AB".repeat(32)}  rules.json\n`);
  assert.equal(readFingerprintFile(f), "ab".repeat(32));
});

// ── output folders ─────────────────────────────────────────────────────────

test("output folder: must exist, mode 700, outside any git repository", () => {
  const d = tmp();
  fs.chmodSync(d, 0o755);
  assert.ok(outputDirProblems(d).some((p) => /mode 755/.test(p)));
  fs.chmodSync(d, 0o700);
  assert.deepEqual(outputDirProblems(d), []);
  assert.ok(outputDirProblems(path.join(d, "missing")).some((p) => /does not exist/.test(p)));
  fs.mkdirSync(path.join(d, "repo", ".git"), { recursive: true });
  fs.mkdirSync(path.join(d, "repo", "out"), { mode: 0o700 });
  assert.ok(outputDirProblems(path.join(d, "repo", "out")).some((p) => /inside the git repository/.test(p)));
  assert.equal(gitRootOf(path.join(REPO, "scripts", "nope")), REPO);
  assert.throws(() => ensurePrivateDir(path.join(REPO, "tmp-shadow-out")), /inside the git repository/);
  assert.equal(fs.existsSync(path.join(REPO, "tmp-shadow-out")), false);
  const made = ensurePrivateDir(path.join(d, "new", "deeper"));
  assert.equal(fs.statSync(made).mode & 0o777, 0o700);
});

// ── technician access OFF ──────────────────────────────────────────────────

test("technician access: switch, Weekly Balance and Supabase variables are detected", () => {
  assert.deepEqual(techAccessEnvVars({ PATH: "/bin", ARENA_CRM_RO_URI: "x", ARENA_SHADOW_DB: "arena_shadow" }), []);
  assert.deepEqual(
    techAccessEnvVars({ ARENA_TECH_ENABLED: "1", ARENA_WB_SUPABASE_URL: "u", NEXT_PUBLIC_SUPABASE_URL: "u", VITE_SUPABASE_PUBLISHABLE_KEY: "k", ARENA_WB_VERIFIER_SECRET: "s", ARENA_VERIFIER: "fake" }),
    ["ARENA_TECH_ENABLED", "ARENA_VERIFIER", "ARENA_WB_SUPABASE_URL", "ARENA_WB_VERIFIER_SECRET", "NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"],
  );
});

test("listeners: loopback is fine; 0.0.0.0 / :: / * / a LAN address on an Arena port is public", () => {
  const ss = [
    `LISTEN 0 511 127.0.0.1:3999 0.0.0.0:* users:(("next-server (v1",pid=1,fd=21))`,
    `LISTEN 0 511 [::1]:5173 [::]:*`,
    `LISTEN 0 511 *:4311 *:* users:(("next-server",pid=2,fd=22))`,
    `LISTEN 0 511 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=3,fd=3))`,
    `LISTEN 0 511 [::]:5173 [::]:*`,
    `LISTEN 0 511 192.168.1.5:3999 0.0.0.0:*`,
    `LISTEN 0 4096 127.0.0.53%lo:53 0.0.0.0:*`,
  ].join("\n");
  const ls = parseListeners(ss);
  assert.equal(ls.length, 7);
  const pub = publicArenaListeners(ls, [3000, 3999, 5173]);
  assert.deepEqual(pub.map((l) => `${l.address}:${l.port}`), ["0.0.0.0:3000", ":::5173", "192.168.1.5:3999"]);
  assert.equal(pub[0].process, "node");
  assert.deepEqual(publicArenaListeners(ls.slice(0, 3), [3000, 3999, 5173]), [], "the warehouse on *:4311 is not an Arena port");
});

test("clock skew from an HTTPS Date header", () => {
  const t = Date.parse("Sun, 01 Nov 2026 14:00:00 GMT");
  assert.equal(clockSkew(t + 30_000, "Sun, 01 Nov 2026 14:00:00 GMT"), 30_000);
  assert.equal(clockSkew(t, null), null);
  assert.equal(clockSkew(t, "garbage"), null);
});

// ── local write tracking / simulated marker ────────────────────────────────

test("trackWrites records every write as db.collection.method; reads are not recorded", async () => {
  const calls: string[] = [];
  const coll = (name: string) => ({
    insertOne: async (d: unknown) => { calls.push(`${name}.insertOne:${JSON.stringify(d)}`); },
    updateOne: async () => ({ matchedCount: 1 }),
    findOne: async () => null,
  });
  const fake = { databaseName: "arena_shadow", collection: (n: string) => coll(n) } as never;
  const log: string[] = [];
  const db = trackWrites(fake, log) as unknown as { collection(n: string): ReturnType<typeof coll> };
  await db.collection("arena_result").insertOne({ a: 1 });
  await db.collection("arena_competition").updateOne();
  await db.collection("arena_result").findOne();
  assert.deepEqual(log, ["arena_shadow.arena_result.insertOne", "arena_shadow.arena_competition.updateOne"]);
  const marked = markSimulated(coll("arena_approval"));
  await marked.insertOne({ b: 2 });
  assert.equal(calls.at(-1), `arena_approval.insertOne:{"b":2,"simulated":true}`);
});

// ── structural proof: no financial record can be created ───────────────────

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "");
function arenaCodeFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|mjs|js)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
    }
  };
  for (const d of ["src/lib/arena", "src/app/api/arena", "scripts/arena"]) walk(path.join(REPO, d));
  return out;
}

test("no Arena lib, API or script references a Ledger / Payout / finance_* write", () => {
  const files = arenaCodeFiles();
  assert.ok(files.length > 30, `found ${files.length} files`);
  const imports = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'`]([^"'`]+)["'`]/g;
  for (const f of files) {
    const rel = path.relative(REPO, f);
    const s = strip(fs.readFileSync(f, "utf8"));
    // 1. no collection opened under a financial name
    assert.ok(!/collection\s*(<[^>]*>)?\s*\(\s*["'`][^"'`]*(ledger|payout|finance)/i.test(s), `${rel} opens a financial collection`);
    // 2. no financial collection name as a value
    assert.ok(!/["'`](finance_[a-z_]+|[A-Za-z_]*[Ll]edger[A-Za-z_]*|[A-Za-z_]*[Pp]ayout[A-Za-z_]*)["'`]/.test(s), `${rel} names a financial collection`);
    // 3. no ledger/payout write helpers
    assert.ok(!/\b(post|create|sync|insert|write|record|add|mark)\w*(Ledger|Payout)\w*\s*\(/i.test(s), `${rel} calls a ledger/payout write helper`);
    assert.ok(!/\b\w*[Ll]edger\w*\s*\(/.test(s), `${rel} calls a ledger function`);
    // 4. no finance/ledger/payout module, except the CRM database accessor (read side) in admin-service
    for (const m of s.matchAll(imports)) {
      if (!/ledger|payout|finance/i.test(m[1])) continue;
      assert.ok(rel === path.join("src", "lib", "arena", "admin-service.ts") && m[1] === "@/lib/finance-db", `${rel} imports ${m[1]}`);
    }
  }
  const admin = strip(fs.readFileSync(path.join(REPO, "src/lib/arena/admin-service.ts"), "utf8"));
  assert.match(admin, /import \{ getDb as getCrmDb, newId \} from "@\/lib\/finance-db";/, "admin-service takes only the CRM db accessor and the id helper");
});

test("shadow-approve reads the CRM only through the guard and connects to nothing but the local 127.0.0.1 state", () => {
  const s = strip(fs.readFileSync(path.join(REPO, "scripts/arena/shadow-approve.ts"), "utf8"));
  assert.match(s, /const crm = await openGuardedCrm\(\);/);
  assert.ok(!/crm\.raw/.test(s), "the unproxied CRM client is never used");
  const clients = [...s.matchAll(/new MongoClient\(\s*([A-Za-z_.]+)/g)].map((m) => m[1]);
  assert.deepEqual(clients, ["localUri"], "the only direct connection is the local state");
  assert.match(s, /assertLocalMongoUri\(localUri\);/);
  assert.match(s, /trackWrites\(rawArena, localWrites\)/);
  assert.match(s, /startsWith\(`\$\{dbName\}\.arena_`\)/, "any write outside the local arena_* collections fails the run");
  assert.match(s, /devStack: false/, "never the dev-stack early freeze");
  // The CRM handed to CRM-side loaders is the guarded db, never a raw client.
  for (const m of s.matchAll(/load(Jobs|Mappings|Technicians)\(\s*([A-Za-z_.]+)/g)) assert.ok(["crmDb"].includes(m[2]), `load${m[1]}(${m[2]})`);
});

test("access probes: a server that ACCEPTS the write probe or the ungranted read FAILs (e.g. no access control)", async () => {
  const { accessProbes, readOnly } = await import("../../../scripts/arena/lib-ro-guard.ts");
  const openColl = { updateOne: async () => ({ matchedCount: 0, modifiedCount: 0 }), findOne: async () => null };
  const raw = { db: () => ({ collection: () => openColl }) };
  const blocked: string[] = [];
  const guardedDb = readOnly({ databaseName: "ag", collection: () => openColl } as never, "db:ag", blocked) as never;
  const lines = await accessProbes({ raw, db: guardedDb, blocked } as never);
  assert.deepEqual(lines.map((l) => l.ok), [false, false, true]);
  assert.match(lines[0].detail, /ACCEPTED/);
  assert.match(lines[1].detail, /ALLOWED/);
  assert.deepEqual(blocked, [], "the deliberate proxy probe is not counted as a CRM write attempt");
  const refusing = { updateOne: async () => { throw Object.assign(new Error("x"), { code: 13, codeName: "Unauthorized" }); }, findOne: async () => { throw Object.assign(new Error("x"), { code: 13, codeName: "Unauthorized" }); } };
  const ok = await accessProbes({ raw: { db: () => ({ collection: () => refusing }) }, db: guardedDb, blocked } as never);
  assert.deepEqual(ok.map((l) => l.ok), [true, true, true]);
});
