/**
 * DEV ONLY — two-week DRESS REHEARSAL of the official shadow workflow on SYNTHETIC data.
 *
 *   node --no-warnings --import ./scripts/arena/transpile-register.mjs scripts/arena/shadow-rehearsal.e2e.ts <outRoot>
 *
 * Where everything lives (nothing else is touched):
 *   - the "CRM" is a synthetic database <prefix>_crm (ARENA_REHEARSAL_DB_PREFIX, default arena_wtshadow) on the local dev mongod 127.0.0.1:27031,
 *     read by the Arena through a database-scoped user with `find` only (created here, dropped at the end);
 *     27031 runs WITHOUT access control, so the server-side refusal (preflight F2) cannot pass here —
 *     the in-process write proxy is the only write barrier in this rehearsal;
 *   - Arena state: <prefix>_arena on the same mongod (dropped at the start; kept at the end for inspection);
 *   - outputs: <outRoot>/shadow (mode 700) — the same layout the real shadow uses in ~/317-live-arena/shadow.
 * Refuses any other host, port or database name. The password of the scoped user lives in this process
 * and the children's environment only (never written to a file, never printed).
 *
 * Every Arena command is run as a child process exactly as SHADOW-OFFICIAL-RUNBOOK-v2.md writes it
 * (the env file is replaced by environment variables), and the synthetic CRM is fingerprinted before
 * and after each command: the Arena must never change it. The "office" edits (late deletion, re-date,
 * re-assignment, post-approval correction) are made by this driver directly, between commands.
 *
 * Synthetic weeks (the past, so the real clock allows every step): W1 = 2026-10-05, W2 = 2026-10-12,
 * with four baseline weeks before W1 for Most Improved. All names are fictional.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { cloneRules, ruleSeed, rulesHash } from "../../src/lib/arena/config.ts";
import { addDays, previousWeekStarts } from "../../src/lib/arena/week.ts";
import { DECISIONS_SCHEMA, validateDecisions, type ShadowDecisions } from "./lib-shadow.ts";

const REPO = path.resolve(import.meta.dirname, "../..");
const HOST = "mongodb://127.0.0.1:27031";
// ARENA_REHEARSAL_DB_PREFIX picks the throwaway databases (default arena_wtshadow; e.g. arena_int_r1 for an integration run).
const PFX = process.env.ARENA_REHEARSAL_DB_PREFIX ?? "arena_wtshadow";
if (!/^arena_(wtshadow|int_[a-z0-9]+)$/.test(PFX)) throw new Error(`refusing database prefix ${PFX} (arena_wtshadow or arena_int_<name>)`);
const CRM_DB = `${PFX}_crm`;
const ARENA_DB = `${PFX}_arena`;
const RO_USER = `${PFX}_ro`;
const RO_ROLE = PFX === "arena_wtshadow" ? "arenaWtShadowRead" : `${PFX.replace(/_/g, "")}Read`;
for (const n of [CRM_DB, ARENA_DB]) if (!/^arena_(wtshadow|int_[a-z0-9]+)_[a-z]+$/.test(n)) throw new Error(`refusing database ${n}`);
const ROOT = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("usage: shadow-rehearsal.e2e.ts <outRoot>");
if (ROOT.startsWith(REPO)) throw new Error("outRoot must be outside the repository");
const OUT = path.join(ROOT, "shadow");
if (fs.existsSync(OUT)) throw new Error(`${OUT} exists: use a new <outRoot> (every run must start from an empty shadow folder)`);
fs.mkdirSync(OUT, { recursive: true, mode: 0o700 });
fs.chmodSync(ROOT, 0o700); fs.chmodSync(OUT, 0o700);

const W1 = "2026-10-05", W2 = "2026-10-12";
// The rules every official command names with --template (no default since the 2026-11 prize change).
const TEMPLATE = process.env.ARENA_REHEARSAL_TEMPLATE ?? "balanced-p2-2026-11";
const APPROVED_FP: Record<string, string> = {
  "balanced-p2-2026-11": "6ae3d1278fef64bf9e23bdc21bab865c91abae2a71c22efbd5443f7bc38a0d0c",
  "balanced-v1": "c122c43bae974c7aa73fc960b19ca921adf646c82b89d67f9eee3fdb21c7d2b4",
};
const SEED = ruleSeed(TEMPLATE);
if (!SEED || !APPROVED_FP[TEMPLATE]) throw new Error(`unknown rehearsal template ${TEMPLATE}`);
const RULES = cloneRules(SEED.rules);
const FP = rulesHash(RULES);
assert.equal(FP, APPROVED_FP[TEMPLATE], "the approved fingerprint");

// ── fictional roster ───────────────────────────────────────────────────────
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PEOPLE = [
  { id: uid(1), full: "Avery Stone", crm: ["Avery"], loc: "Chicago" },
  { id: uid(2), full: "Blake Rivera", crm: ["Blake"], loc: "Chicago" },
  { id: uid(3), full: "Casey Morgan", crm: ["Casey"], loc: "Indianapolis" },
  { id: uid(4), full: "Devon Price", crm: ["Devon"], loc: "Milwaukee" },
  { id: uid(5), full: "Emery Walsh", crm: ["Emery"], loc: "Ohio" },
  { id: uid(6), full: "Finley Brooks", crm: ["Finley"], loc: "Minneapolis" },
  { id: uid(7), full: "Gray Hollis", crm: ["Gray"], loc: "South Bend" },
  { id: uid(8), full: "Harper Quinn", crm: ["Harper"], loc: "St. Louis" },
  { id: uid(9), full: "Indigo Lane", crm: ["Indigo"], loc: "Chicago" },
  { id: uid(10), full: "Jules Bennett", crm: ["Jules"], loc: "Cleveland" },
  { id: uid(11), full: "Jules Benton", crm: ["JulesB"], loc: "Cleveland" },
  { id: uid(12), full: "Kai Sato", crm: ["Kai", "Kai S"], loc: "Indianapolis" },
  { id: uid(13), full: "נועם לוי", crm: ["Noam"], loc: "Milwaukee" },
];
const idOf = (crm: string) => PEOPLE.find((p) => p.crm.includes(crm))!.id;
const locOf = (crm: string) => PEOPLE.find((p) => p.crm.includes(crm))?.loc ?? "Chicago";

interface Spec { tech: string; closed: number; est: number; profit: number; other?: number; loc?: string }
const W1_SPEC: Spec[] = [
  { tech: "Avery", closed: 15, est: 5, profit: 800 }, { tech: "Blake", closed: 13, est: 7, profit: 1000 },
  { tech: "Casey", closed: 12, est: 8, profit: 900 }, { tech: "Devon", closed: 11, est: 9, profit: 1000 },
  { tech: "Emery", closed: 10, est: 10, profit: 1100 }, { tech: "Finley", closed: 9, est: 11, profit: 1200 },
  { tech: "Gray", closed: 9, est: 11, profit: 1000 }, { tech: "Harper", closed: 8, est: 12, profit: 1200 },
  { tech: "Indigo", closed: 6, est: 0, profit: 1500 }, { tech: "Jules", closed: 8, est: 12, profit: 500 },
  { tech: "JulesB", closed: 7, est: 13, profit: 450 }, { tech: "Kai", closed: 3, est: 2, profit: 700 }, { tech: "Kai S", closed: 3, est: 2, profit: 700 },
  { tech: "Noam", closed: 6, est: 10, profit: 300 },
  { tech: "CHICAGO", closed: 0, est: 0, other: 6, profit: 0, loc: "Chicago" }, { tech: "INDIANAPOLIS", closed: 0, est: 0, other: 4, profit: 0, loc: "Indianapolis" },
  { tech: "SUB ( TEST )", closed: 3, est: 0, profit: 400, loc: "Cleveland" }, { tech: "Johnny", closed: 5, est: 3, profit: 300, loc: "Chicago" },
];
const W2_SPEC: Spec[] = W1_SPEC.map((s) => ({ ...s, closed: s.tech === "Gray" ? s.closed + 2 : s.tech === "Avery" ? s.closed - 2 : s.closed, est: s.tech === "Avery" ? s.est + 2 : s.est }));
/** Baseline weeks: everyone close to their current level, Gray much weaker (the Most Improved candidate). */
const baselineSpec = (s: Spec): Spec => (s.tech === "Gray" ? { ...s, closed: 5, est: 10, profit: 600 } : { ...s, closed: Math.max(0, s.closed - 1), est: s.est + 1 });

type JobDoc = { _id: ObjectId; tech: string; date: string; status: string; location: string; clientPhoneNumber: string; invoiceNumber: string; totalPaidCompanyCash?: number };
let seq = 0;
const mkJob = (tech: string, date: string, status: string, profit: number | null, loc = locOf(tech), phone?: string): JobDoc => {
  seq++;
  return { _id: new ObjectId(), tech, date, status, location: loc, clientPhoneNumber: phone ?? `555${String(1000000 + seq)}`, invoiceNumber: `SYN-${seq}`, ...(profit !== null ? { totalPaidCompanyCash: profit } : {}) };
};
/** A spec's jobs for one week, spread over the 7 days (job i on day i mod 7). */
function weekJobs(specs: Spec[], weekStart: string): JobDoc[] {
  const out: JobDoc[] = [];
  for (const s of specs) {
    const list: [string, number | null][] = [
      ...Array.from({ length: s.closed }, () => ["Closed", s.profit] as [string, number]),
      ...Array.from({ length: s.est }, () => ["Estimate", null] as [string, null]),
      ...Array.from({ length: s.other ?? 0 }, () => ["OOA", null] as [string, null]),
    ];
    list.forEach(([st, p], i) => out.push(mkJob(s.tech, addDays(weekStart, i % 7), st, p, s.loc)));
  }
  return out;
}

// ── infrastructure ─────────────────────────────────────────────────────────
const PW = randomBytes(18).toString("base64url");
const RO_URI = `mongodb://${RO_USER}:${PW}@127.0.0.1:27031/?authSource=${CRM_DB}`;
const admin = await MongoClient.connect(HOST);
const crm = admin.db(CRM_DB);
const arena = admin.db(ARENA_DB);
const log: string[] = [];
const say = (s: string) => { log.push(s); console.log(s); };

async function crmFingerprint(): Promise<string> {
  const h = createHash("sha256");
  for (const { name } of (await crm.listCollections({}, { nameOnly: true }).toArray()).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const docs = await crm.collection(name).find({}).sort({ _id: 1 }).toArray();
    h.update(name).update(JSON.stringify(docs));
  }
  return h.digest("hex");
}

interface Run { code: number; out: string; err: string }
const childEnv = {
  PATH: process.env.PATH!, HOME: process.env.HOME!, ARENA_CRM_RO_URI: RO_URI, ARENA_CRM_DB: CRM_DB,
  ARENA_SHADOW_LOCAL_URI: "mongodb://127.0.0.1:27031", ARENA_SHADOW_DB: ARENA_DB,
} as unknown as NodeJS.ProcessEnv;
/** Run one runbook command; the synthetic CRM must be byte-identical afterwards. */
async function arenaCmd(label: string, loader: "test" | "transpile", script: string, args: string[]): Promise<Run> {
  const before = await crmFingerprint();
  const r = await new Promise<Run>((resolve) => {
    execFile(process.execPath, ["--no-warnings", "--import", loader === "test" ? "./scripts/test-register.mjs" : "./scripts/arena/transpile-register.mjs", `scripts/arena/${script}`, ...args],
      { cwd: REPO, env: childEnv, timeout: 180_000, maxBuffer: 32 << 20 }, (e, out, err) => {
        const code = e ? (typeof (e as { code?: unknown }).code === "number" ? (e as { code: number }).code : 1) : 0;
        resolve({ code, out: String(out), err: String(err) });
      });
  });
  const after = await crmFingerprint();
  assert.equal(after, before, `${label}: the Arena changed the CRM`);
  assert.ok(!r.out.includes(PW) && !r.err.includes(PW), `${label}: output leaks the password`);
  say(`- **${label}** → exit ${r.code} · ${(r.out.trim().split("\n").pop() ?? "").slice(0, 300)}${r.code && r.err.trim() ? ` · stderr: ${r.err.trim().split("\n").slice(-2).join(" / ").slice(0, 300)}` : ""}`);
  return r;
}
const daily = (week: string, day: string) => arenaCmd(`daily ${week} as ${day}`, "transpile", "shadow-week.ts", [week, OUT, "--template", TEMPLATE, "--snapshot", "--strict", "--day-label", day]);
const approveArgs = (week: string, extra: string[]) => [week, OUT, "--template", TEMPLATE, "--decisions", path.join(OUT, "decisions.json"), "--rules-confirmation", path.join(OUT, "approved-rules.sha256"), "--accounts", path.join(OUT, "accounts.json"), ...extra];
const approve = (label: string, week: string, extra: string[] = []) => arenaCmd(label, "transpile", "shadow-approve.ts", approveArgs(week, extra));
const reconcile = (week: string) => arenaCmd(`weekly reconciliation ${week}`, "transpile", "shadow-reconcile.ts", [week, OUT]);
const dailyData = (week: string) => JSON.parse(fs.readFileSync(path.join(OUT, week, "data.json"), "utf8"));
const approvalData = (week: string) => JSON.parse(fs.readFileSync(path.join(OUT, `${week}-simulated-approval`, "data.json"), "utf8"));
const reconData = (week: string) => JSON.parse(fs.readFileSync(path.join(OUT, `${week}-reconciliation`, "data.json"), "utf8"));

let decisions: ShadowDecisions;
function writeDecisions(note: string) {
  decisions.note = note;
  const v = validateDecisions(decisions);
  assert.deepEqual(v.problems, [], "decisions.json validates");
  fs.writeFileSync(path.join(OUT, "decisions.json"), JSON.stringify(decisions, null, 1), { mode: 0o600 });
  say(`- decisions.json updated: ${note}`);
}

try {
  // ── 0. setup ─────────────────────────────────────────────────────────────
  say(`# Dress rehearsal log (synthetic data) · ${new Date().toISOString()}`);
  say(`CRM: ${CRM_DB} · Arena: ${ARENA_DB} · host 127.0.0.1:27031 · out ${OUT} · rules ${FP.slice(0, 12)}…`);
  await crm.dropDatabase(); await arena.dropDatabase();
  await crm.command({ dropAllUsersFromDatabase: 1 }); await crm.command({ dropAllRolesFromDatabase: 1 });
  const find = (c: string) => ({ resource: { db: CRM_DB, collection: c }, actions: ["find"] });
  await crm.command({ createRole: RO_ROLE, privileges: ["Job", "Technician", "Location", "Provider", "TechNameMapping"].map(find), roles: [] });
  await crm.command({ createUser: RO_USER, pwd: PW, roles: [{ role: RO_ROLE, db: CRM_DB }] });
  await crm.collection("TechNameMapping").insertMany(PEOPLE.map((p) => ({ supabaseUserId: p.id, supabaseFullName: p.full, crmTechNames: p.crm })) as never[]);
  await crm.collection("Technician").insertMany(PEOPLE.flatMap((p) => p.crm.map((n) => ({ _id: n, location: p.loc }))) as never[]);
  const LOCS = ["Chicago", "Indianapolis", "Milwaukee", "Ohio", "Minneapolis", "South Bend", "St. Louis", "Cleveland"];
  await crm.collection("Location").insertMany(LOCS.map((l) => ({ _id: l, name: l, managerProfitPercent: 0 })) as never[]);
  await crm.collection("Provider").insertOne({ _id: "SYN-PROVIDER", name: "Synthetic provider", profitPercent: 0 } as never);
  const base = previousWeekStarts(W1, 4).flatMap((w) => weekJobs(W1_SPEC.filter((s) => PEOPLE.some((p) => p.crm.includes(s.tech))).map(baselineSpec), w));
  await crm.collection("Job").insertMany(base as never[]);
  say(`- seeded ${PEOPLE.length} fictional people, ${base.length} baseline jobs (${previousWeekStarts(W1, 4).join(", ")})`);

  fs.writeFileSync(path.join(OUT, "approved-rules.sha256"), `${FP}  ${SEED.label} (rehearsal copy of the owner-approved fingerprint)\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(OUT, "accounts.json"), JSON.stringify(Object.fromEntries(PEOPLE.map((p) => [p.id, "eligible"])), null, 1), { mode: 0o600 });
  decisions = {
    schema: DECISIONS_SCHEMA, exclusions: [
      { crmName: "CHICAGO", category: "location_pool", reason: "D3 pool" }, { crmName: "INDIANAPOLIS", category: "location_pool", reason: "D3 pool" },
      { crmName: "SUB ( TEST )", category: "subcontractor", reason: "D3 subcontractor" },
    ],
    mappings: [{ crmName: "Johnny", status: "pending_identification", competitorId: null, reason: "D4 office to identify" }],
    countOnceDuplicateGroups: [], displayNameOverrides: [{ fullName: "נועם לוי", competitorId: null, displayName: "Noam L.", reason: "D6 English name" }],
    duplicatePolicy: { closedPlusXClose: "keep_both", zeroDollar: "keep_both" },
  };
  writeDecisions("start: pools/sub excluded, Johnny pending, D2 policy keep both");

  // Preflight (runbook step 0). 27031 has no access control: F2 is EXPECTED to fail here.
  const pf = await arenaCmd("preflight", "transpile", "shadow-preflight.ts", ["--template", TEMPLATE, "--out", OUT, "--shadow-dir", OUT, "--no-clock-check"]);
  fs.writeFileSync(path.join(ROOT, "preflight-rehearsal.txt"), pf.out, { mode: 0o600 });
  assert.match(pf.out, /FAIL\s+F2\s+server refuses a write on Job/, "rehearsal server has no access control → F2 FAIL (expected)");
  for (const id of ["F1", "F3", "F4", "F5", "F6", "F7", "F8"]) assert.match(pf.out, new RegExp(`PASS\\s+${id} `), `preflight ${id} PASS`);

  // ── W1 ───────────────────────────────────────────────────────────────────
  say(`\n## Week 1 · ${W1}`);
  const w1 = weekJobs(W1_SPEC, W1);
  // Duplicates on Wednesday: Casey exact Closed+Closed (same phone), Devon Closed+X close, Emery $0 pair.
  const wed = addDays(W1, 2);
  const caseyDup = [mkJob("Casey", wed, "Closed", 900, undefined, "5559990001"), mkJob("Casey", wed, "Closed", 900, undefined, "5559990001")];
  const devonPair = [mkJob("Devon", wed, "Closed", 50, undefined, "5559990002"), mkJob("Devon", wed, "X close", 250, undefined, "5559990002")];
  const emeryZero = [mkJob("Emery", wed, "Estimate", null, undefined, "5559990003"), mkJob("Emery", wed, "Estimate", null, undefined, "5559990003")];
  const newname = [mkJob("Newname", wed, "Closed", 300, "Ohio"), mkJob("Newname", wed, "Estimate", null, "Ohio")];
  w1.push(...caseyDup, ...devonPair, ...emeryZero, ...newname);
  for (let d = 0; d < 7; d++) {
    const day = addDays(W1, d);
    await crm.collection("Job").insertMany(w1.filter((j) => j.date === day) as never[]);
    if (d === 3) {
      decisions.exclusions.push({ crmName: "Newname", category: "former_technician", reason: "office: one-off former worker (rehearsal)" });
      writeDecisions("Thu: office says Newname was a one-off former worker → excluded");
    }
    if (d === 4) { // a status edit during the week (normal, shows in the day-over-day diff)
      const est = w1.find((j) => j.tech === "Blake" && j.status === "Estimate" && j.date <= day)!;
      await crm.collection("Job").updateOne({ _id: est._id }, { $set: { status: "Closed", totalPaidCompanyCash: 1000 } });
      est.status = "Closed"; est.totalPaidCompanyCash = 1000;
      say(`- office: Blake job ${est._id} Estimate → Closed (during the week)`);
    }
    const r = await daily(W1, day);
    const dd = dailyData(W1);
    if (d === 2) {
      assert.equal(r.code, 2, "Wednesday: the unknown name Newname is a STOP condition");
      assert.ok(dd.stops.some((s: string) => /Newname/.test(s)));
      assert.ok(dd.decisions.plan.pending.names.some((s: string) => /Johnny/.test(s)));
      assert.equal(dd.decisions.plan.undecided.duplicates.length, 1, "Casey's exact pair is undecided (the D2 policy covers the other two)");
    } else assert.equal(r.code, 0, `${day}: no STOP`);
    assert.equal(dd.parity.mismatches.length, 0, `${day}: parity`);
    if (d > 0) assert.ok(dd.snapshot.diff, `${day}: day-over-day diff`);
  }
  // Monday after W1: a late Sunday entry arrives, then the final run, a rerun (determinism) and the freeze.
  const mon1 = addDays(W1, 7);
  const lateSunday = mkJob("Harper", addDays(W1, 6), "Estimate", null);
  await crm.collection("Job").insertOne(lateSunday as never);
  say(`- office: late Sunday entry ${lateSunday._id} (Harper, Estimate) entered Monday morning`);
  await daily(W1, mon1);
  const fin1 = dailyData(W1);
  assert.equal(fin1.weekEnded, true);
  assert.ok(fin1.snapshot.diff.added.some((j: { id: string }) => j.id === String(lateSunday._id)), "the late Sunday entry shows as added");
  await daily(W1, mon1);
  assert.equal(dailyData(W1).hashes.result, fin1.hashes.result, "rerun on the same data: identical result");
  const fz = await approve(`Monday freeze ${W1}`, W1, ["--stop-after", "freeze"]);
  assert.equal(fz.code, 0); assert.equal(approvalData(W1).outcome, "frozen");
  const fz2 = await approve(`Monday freeze ${W1} again (idempotent)`, W1, ["--stop-after", "freeze"]);
  assert.equal(fz2.code, 0); assert.ok(approvalData(W1).steps.some((s: string) => /already provisional/.test(s)));

  // Office edits AFTER the freeze: a deletion, a Blake Estimate re-dated out of the week, a re-assignment.
  //   6-place prizes: delete one Emery Closed (Emery #6 → #7 loses $50), re-assign a Finley Estimate to Gray.
  //   3-place prizes (P2): #4–#6 carry no cash, so the material edit hits the Most Improved winner instead:
  //   delete one Gray Closed and re-assign another Gray Closed to Finley (Gray 7/18 = 38.9% < 40%: loses Most Improved).
  const p2 = SEED.rules.prizes.positionsCents.length === 3;
  const [delTech, fromTech, toTech, moved] = p2 ? ["Gray", "Gray", "Finley", "Closed"] : ["Emery", "Finley", "Gray", "Estimate"];
  const del = w1.find((j) => j.tech === delTech && j.status === "Closed")!;
  const redate = w1.find((j) => j.tech === "Blake" && j.status === "Estimate" && j.date === addDays(W1, 6))!;
  const reassign = w1.find((j) => j.tech === fromTech && j.status === moved && j._id !== del._id)!;
  await crm.collection("Job").deleteOne({ _id: del._id });
  await crm.collection("Job").updateOne({ _id: redate._id }, { $set: { date: mon1 } });
  await crm.collection("Job").updateOne({ _id: reassign._id }, { $set: { tech: toTech } });
  say(`- office AFTER freeze: deleted ${del._id} (${delTech} Closed), re-dated ${redate._id} (Blake) to ${mon1}, re-assigned ${reassign._id} ${fromTech} ${moved} → ${toTech}`);

  // Tuesday 12:00 ET onward: review + re-check (stops in review)
  const tue = await approve(`Tuesday review ${W1}`, W1, ["--stop-after", "review"]);
  const tueD = approvalData(W1);
  assert.equal(tue.code, 0); assert.equal(tueD.outcome, "in_review");
  const listed = tueD.lateChanges.changes.map((c: { jobId: string; kind: string }) => `${c.jobId}:${c.kind}`);
  assert.ok(listed.includes(`${del._id}:removed`) && listed.includes(`${redate._id}:redated_out`) && listed.includes(`${reassign._id}:reassigned`), `late changes listed: ${listed.join(", ")}`);
  assert.equal(tueD.lateChanges.impact.material, true, `the late changes change a prize: ${JSON.stringify(tueD.lateChanges.impact.reasons)}`);
  assert.ok(tueD.decisions.plan.undecided.duplicates.length === 1, "Casey's pair still undecided");

  // Thursday: office confirms Casey's pair (one invoice) → count once; approval still blocked by the material late change.
  const caseyIds = caseyDup.map((j) => String(j._id)).sort();
  decisions.countOnceDuplicateGroups.push({ technician: "Casey", date: wed, profit: 900, status: "confirmed", excludeJobIds: [caseyIds[1]], jobIds: caseyIds, reason: "office: one invoice, one payment (same phone, entered twice)" });
  writeDecisions("Thu: office confirms Casey's pair → count once");
  const thu = await approve(`Thursday approve ${W1} (no late decision)`, W1);
  assert.equal(thu.code, 2, "refused: late change affects prizes and the owner has not chosen");
  assert.match(approvalData(W1).refusedReason, /keep freeze snapshot|accept correction/);
  const thu2 = await approve(`Thursday approve ${W1} with owner choice KEEP FREEZE`, W1, ["--late-decision", "keep-freeze", "--late-reason", "Rehearsal: changes after the freeze not explained by the office; keep the Monday snapshot"]);
  const a1 = approvalData(W1);
  assert.equal(thu2.code, 0, a1.refusedReason ?? ""); assert.equal(a1.outcome, "approved");
  assert.equal(a1.safety.ok, true); assert.equal(a1.integrity.mismatched, 0);
  const r1 = await reconcile(W1);
  const rc1 = reconData(W1);
  const v1 = Object.fromEntries(rc1.acceptance.map((l: { id: string; verdict: string }) => [l.id, l.verdict]));
  say(`- W1 acceptance: ${JSON.stringify(v1)}`);
  assert.equal(r1.code, 0);
  for (const k of ["A1", "A2", "A3", "A4", "A6", "A7"]) assert.equal(v1[k], "PASS", `W1 ${k}: ${rc1.acceptance.find((l: { id: string }) => l.id === k).detail}`);
  assert.equal(v1.A5, "PENDING", "A5 pending: no preflight PASS log (rehearsal server has no access control)");

  // ── W2 ───────────────────────────────────────────────────────────────────
  say(`\n## Week 2 · ${W2}`);
  const w2 = weekJobs(W2_SPEC, W2);
  const tue2 = addDays(W2, 1);
  const averyDup = [mkJob("Avery", tue2, "Closed", 800, undefined, "5559990011"), mkJob("Avery", tue2, "Closed", 800, undefined, "5559990011")];
  const harperPair = [mkJob("Harper", tue2, "Closed", 40, undefined, "5559990012"), mkJob("Harper", tue2, "X close", 240, undefined, "5559990012")];
  w2.push(...averyDup, ...harperPair);
  for (let d = 0; d < 7; d++) {
    const day = addDays(W2, d);
    await crm.collection("Job").insertMany(w2.filter((j) => j.date === day) as never[]);
    if (d === 1) {
      decisions.mappings = [{ crmName: "Johnny", status: "attach", competitorId: idOf("Avery"), reason: "office: Johnny is Avery Stone's second CRM name" }];
      writeDecisions("Tue: office identifies Johnny = Avery Stone → attach");
    }
    if (d === 3) {
      // a post-approval correction to an approved W1 job, then the W1 re-read logs it (never applied)
      const j = w1.find((x) => x.tech === "Avery" && x.status === "Closed")!;
      await crm.collection("Job").updateOne({ _id: j._id }, { $set: { totalPaidCompanyCash: 900 } });
      say(`- office: post-approval correction on W1 job ${j._id} (Avery profit 800 → 900)`);
      const pa = await approve(`W1 post-approval re-read`, W1);
      const pd = approvalData(W1);
      assert.equal(pa.code, 0); assert.equal(pd.outcome, "already_approved");
      assert.equal(pd.lateCorrection.status, "logged");
      assert.equal(pd.integrity.mismatched, 0, "the approved W1 record is unchanged by the later CRM edit");
    }
    const r = await daily(W2, day);
    const dd = dailyData(W2);
    assert.equal(r.code, 0, `${day}: no STOP (${dd.stops.join("; ")})`);
    assert.equal(dd.parity.mismatches.length, 0);
    if (d >= 1) {
      const avery = dd.v1.results.find((x: { competitorId: string }) => x.competitorId === idOf("Avery"));
      assert.ok(avery.jobIds.some((id: string) => w2.some((j) => String(j._id) === id && j.tech === "Johnny")), "Johnny's jobs are credited to Avery once attached");
    }
  }
  const mon2 = addDays(W2, 7);
  await daily(W2, mon2);
  await daily(W2, mon2);
  const averyIds = averyDup.map((j) => String(j._id)).sort();
  decisions.countOnceDuplicateGroups.push({ technician: "Avery", date: tue2, profit: 800, status: "confirmed", excludeJobIds: [averyIds[1]], jobIds: averyIds, reason: "office: one invoice" });
  writeDecisions("Mon: office confirms Avery's pair → count once");
  assert.equal((await approve(`Monday freeze ${W2}`, W2, ["--stop-after", "freeze"])).code, 0);
  // a non-material edit after the freeze (an ineligible technician's profit)
  const minor = w2.find((j) => j.tech === "Jules" && j.status === "Closed")!;
  await crm.collection("Job").updateOne({ _id: minor._id }, { $set: { totalPaidCompanyCash: 520 } });
  say(`- office AFTER freeze: ${minor._id} Jules profit 500 → 520 (no prize effect)`);
  assert.equal((await approve(`Tuesday review ${W2}`, W2, ["--stop-after", "review"])).code, 0);
  const a2r = approvalData(W2);
  assert.equal(a2r.lateChanges.changes.length, 1); assert.equal(a2r.lateChanges.impact.material, false);
  const t2 = await approve(`Thursday approve ${W2}`, W2);
  const a2 = approvalData(W2);
  assert.equal(t2.code, 0, a2.refusedReason ?? ""); assert.equal(a2.outcome, "approved");
  assert.equal(a2.integrity.mismatched, 0);
  assert.ok(a2.integrity.identical >= 2, "both approved weeks verified");

  // Owner sign-off (rehearsal) and the final reconciliation of both weeks.
  for (const w of [W1, W2]) fs.writeFileSync(path.join(OUT, w, "owner-signoff.txt"), `REHEARSAL ONLY — synthetic data, signed by the rehearsal driver ${new Date().toISOString()}\n`, { mode: 0o600 });
  for (const w of [W1, W2]) {
    await reconcile(w);
    const rc = reconData(w);
    const v = Object.fromEntries(rc.acceptance.map((l: { id: string; verdict: string }) => [l.id, l.verdict]));
    say(`- ${w} final acceptance: ${JSON.stringify(v)} · overall ${rc.overall}`);
    for (const k of ["A1", "A2", "A3", "A4", "A6", "A7", "A8"]) assert.equal(v[k], "PASS", `${w} ${k}: ${rc.acceptance.find((l: { id: string }) => l.id === k).detail}`);
  }
  const post = reconData(W1).late.postApproval;
  assert.equal(post, 1, "W1 shows the logged post-approval correction");
  say(`\nREHEARSAL PASSED · CRM unchanged by every Arena command (fingerprinted before/after each) · out ${OUT}`);
} finally {
  fs.writeFileSync(path.join(ROOT, "REHEARSAL-LOG.md"), log.join("\n") + "\n", { mode: 0o600 });
  await crm.command({ dropAllUsersFromDatabase: 1 }).catch(() => {});
  await crm.command({ dropAllRolesFromDatabase: 1 }).catch(() => {});
  await admin.close();
}
