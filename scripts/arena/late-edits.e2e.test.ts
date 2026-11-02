/**
 * DEV ONLY — end-to-end proof of the "late CRM edits" protection with the REAL
 * lifecycle and the REAL shadow script (shadow-approve.ts), on fictional data:
 *
 *   - the CRM is the local access-controlled copy on 127.0.0.1:27032 (users
 *     from ~/arena-dev/shadow-ro-setup.mjs; URIs in ~/arena-dev/shadow-ro.env,
 *     never printed). The Arena reads it as the read-only user only;
 *   - the "office" edits are made by this test as the local root user, on a
 *     fictional week (2026-07-20) it inserts first and removes at the end:
 *     the CRM copy is byte-identical afterwards (asserted);
 *   - Arena state goes to two throwaway databases on 127.0.0.1:27031
 *     (WEIGHTED_V0 and BALANCED_PERFORMANCE_V1), dropped at the end.
 *
 *   node --test --test-concurrency=1 --import ./scripts/arena/transpile-register.mjs scripts/arena/late-edits.e2e.test.ts
 *
 * Do not run it at the same time as shadow-tooling.e2e.test.ts (both assert the
 * CRM copy is unchanged). Set ARENA_LATE_EDITS_KEEP=<dir> to keep every report
 * (mode 700 folder) for the owner demo. Set ARENA_LATE_EDITS_UI_DB=arena_<name>
 * to also leave a third local database stopped at the BLOCKED review (V0), for
 * screenshots of the admin review screen; it is not dropped.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { MongoClient, ObjectId } from "mongodb";
import { SEED_BALANCED_PERFORMANCE, SEED_STANDARD_WEEK, cloneRules, rulesHash } from "../../src/lib/arena/config.ts";
import { DECISIONS_SCHEMA } from "./lib-shadow.ts";

const REPO = path.resolve(import.meta.dirname, "../..");
const ENV_FILE = path.join(os.homedir(), "arena-dev", "shadow-ro.env");
const LOCAL = "mongodb://127.0.0.1:27031";
const WEEK = "2026-07-20";
const UI_DB = process.env.ARENA_LATE_EDITS_UI_DB ?? null;
if (UI_DB && !/^arena_[A-Za-z0-9_]+$/.test(UI_DB)) throw new Error("ARENA_LATE_EDITS_UI_DB must be an arena_* database name");
// ARENA_E2E_DB_PREFIX renames the throwaway databases (default arena_late_e2e; e.g. arena_int_late).
const DB_PREFIX = process.env.ARENA_E2E_DB_PREFIX ?? "arena_late_e2e";
if (!/^arena_[a-z0-9_]+$/.test(DB_PREFIX) || /^arena_(shadow|trial|preview|dev|wtshadow)/.test(DB_PREFIX)) throw new Error(`refusing ARENA_E2E_DB_PREFIX ${DB_PREFIX}`);
const DB = { v0: `${DB_PREFIX}_v0_${process.pid}`, v1: `${DB_PREFIX}_v1_${process.pid}`, ui: UI_DB ?? "" };
type Which = "v0" | "v1" | "ui";
/** The databases a step runs on: v0 and v1, plus the UI-state one (v0 rules) while it is wanted. */
const withUi = (upTo: boolean): Which[] => (UI_DB && upTo ? ["v0", "v1", "ui"] : ["v0", "v1"]);
const env = Object.fromEntries(
  fs.readFileSync(ENV_FILE, "utf8").split("\n").map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l)).filter(Boolean).map((m) => [m![1], m![2]]),
) as Record<string, string>;
for (const k of ["ARENA_CRM_RO_URI", "ARENA_CRM_URI_ROOT"])
  if (!/@127\.0\.0\.1:27032\//.test(env[k] ?? "")) throw new Error(`refusing: ${k} must point at the local 127.0.0.1:27032 test server`);

const KEEP = process.env.ARENA_LATE_EDITS_KEEP ? path.resolve(process.env.ARENA_LATE_EDITS_KEEP) : null;
const mk = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "arena-late-e2e-")); fs.chmodSync(d, 0o700); return d; };
const SHADOW = mk();
const OUT = KEEP ?? mk();
if (KEEP) { fs.mkdirSync(KEEP, { recursive: true, mode: 0o700 }); fs.chmodSync(KEEP, 0o700); }

const V0_RULES = cloneRules(SEED_STANDARD_WEEK); // methodology absent = WEIGHTED_V0
const V1_RULES = cloneRules(SEED_BALANCED_PERFORMANCE);
const TEMPLATE = { v0: "late-demo-weighted-v0", v1: "late-demo-balanced-v1", ui: "late-demo-weighted-v0" };

// ── fictional week (mapped fictional technicians of the dev CRM) ───────────
interface Spec { tech: string; location: string; closed: number; estimates: number; noAnswer?: number; profitEach: number }
const ROSTER: Spec[] = [
  { tech: "Marcus", location: "Columbus", closed: 21, estimates: 9, profitEach: 1500 },
  { tech: "Ava", location: "Indianapolis", closed: 19, estimates: 11, profitEach: 1500 },
  { tech: "Jordan", location: "Chicago", closed: 21, estimates: 15, profitEach: 1500 },
  // The trial's technician: 35 assigned / 20 closed / 30 qualifying / $30,741.55.
  { tech: "Ethan", location: "South Bend", closed: 20, estimates: 10, noAnswer: 5, profitEach: 1537.08 },
  { tech: "Maya", location: "Chicago", closed: 16, estimates: 14, profitEach: 1500 },
  { tech: "Diego", location: "Cleveland", closed: 15, estimates: 15, profitEach: 1500 },
  { tech: "Liam", location: "Cincinnati", closed: 13, estimates: 17, profitEach: 1500 },
];
const DAYS = ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25", "2026-07-26"];
type JobDoc = { _id: ObjectId; tech: string; location: string; date: string; status: string; totalPaidCompanyCash?: number; invoiceNumber: string };
function weekDocs(): JobDoc[] {
  const out: JobDoc[] = [];
  let n = 0;
  for (const s of ROSTER) {
    const add = (status: string, profit: number | null) => {
      n++;
      out.push({ _id: new ObjectId(), tech: s.tech, location: s.location, date: DAYS[n % 7], status, invoiceNumber: `LATE-DEMO-${n}`, ...(profit !== null ? { totalPaidCompanyCash: profit } : {}) });
    };
    for (let i = 0; i < s.closed; i++) add("Closed", s.tech === "Ethan" && i === s.closed - 1 ? 1537.03 : s.profitEach); // Ethan: 19 × 1537.08 + 1537.03 = 30,741.55
    for (let i = 0; i < s.estimates; i++) add("Estimate", null);
    for (let i = 0; i < (s.noAnswer ?? 0); i++) add("No answer", null);
  }
  return out;
}
const DOCS = weekDocs();
const pick = (tech: string, status: string, i = 0) => DOCS.filter((d) => d.tech === tech && d.status === status)[i]._id;
const EDIT = {
  liamRedated: pick("Liam", "Estimate"),
  marcusReassigned: pick("Marcus", "Estimate"),
  mayaStatus: pick("Maya", "Estimate"),
  diegoProfit: pick("Diego", "Closed"),
  ethanZeroEstimate: pick("Ethan", "Estimate"),
  postApproval: pick("Jordan", "Closed", 3),
};

// ── helpers ────────────────────────────────────────────────────────────────
interface Run { code: number; out: string; err: string }
function approve(which: Which, args: string[] = []): Promise<Run> {
  const rules = which === "v1" ? V1_RULES : V0_RULES;
  fs.writeFileSync(path.join(SHADOW, `rules-${which}.sha256`), `${rulesHash(rules)}\n`, { mode: 0o600 });
  const childEnv = { PATH: process.env.PATH!, HOME: os.homedir(), ARENA_SHADOW_LOCAL_URI: LOCAL, ARENA_SHADOW_DB: DB[which], ARENA_CRM_RO_URI: env.ARENA_CRM_RO_URI };
  const outDir = path.join(OUT, which);
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(outDir, 0o700);
  return new Promise((resolve) => {
    execFile(process.execPath, [
      "--no-warnings", "--import", "./scripts/arena/transpile-register.mjs", "scripts/arena/shadow-approve.ts", WEEK, outDir,
      "--template", TEMPLATE[which], "--decisions", path.join(SHADOW, "decisions.json"), "--accounts", path.join(SHADOW, "accounts.json"),
      "--rules-confirmation", path.join(SHADOW, `rules-${which}.sha256`), ...args,
    ], { cwd: REPO, env: childEnv, timeout: 120_000, maxBuffer: 16 << 20 }, (e, out, err) => {
      const code = e ? (typeof (e as { code?: unknown }).code === "number" ? (e as { code: number }).code : 1) : 0;
      resolve({ code, out: String(out), err: String(err) });
    });
  });
}
const reportDir = (which: Which) => path.join(OUT, which, `${WEEK}-simulated-approval`);
let step = 0;
/** Read the run's report/data; with KEEP, also keep a numbered copy of each step. */
function outputs(which: Which, label: string) {
  const md = fs.readFileSync(path.join(reportDir(which), "report.md"), "utf8");
  const data = JSON.parse(fs.readFileSync(path.join(reportDir(which), "data.json"), "utf8"));
  if (KEEP) {
    step++;
    const n = String(step).padStart(2, "0");
    fs.writeFileSync(path.join(KEEP, `${n}-${which}-${label}.md`), md, { mode: 0o600 });
    fs.writeFileSync(path.join(KEEP, `${n}-${which}-${label}.json`), JSON.stringify(data, null, 1), { mode: 0o600 });
  }
  return { md, data };
}
const noSecrets = (r: Run) => {
  for (const k of Object.keys(env)) if (/URI/.test(k)) {
    const pw = /:\/\/[^:]+:([^@]+)@/.exec(env[k])?.[1];
    if (pw) assert.ok(!r.out.includes(pw) && !r.err.includes(pw), `output leaks the password of ${k}`);
  }
};
async function crm<T>(fn: (db: import("mongodb").Db) => Promise<T>): Promise<T> {
  const c = await MongoClient.connect(env.ARENA_CRM_URI_ROOT);
  try { return await fn(c.db("ag")); } finally { await c.close(); }
}
async function local<T>(which: Which, fn: (db: import("mongodb").Db) => Promise<T>): Promise<T> {
  const c = await MongoClient.connect(LOCAL);
  try { return await fn(c.db(DB[which])); } finally { await c.close(); }
}
async function crmFingerprint(): Promise<Record<string, string>> {
  return crm(async (db) => {
    const out: Record<string, string> = {};
    for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
      const docs = await db.collection(name).find({}).sort({ _id: 1 }).toArray();
      out[name] = `${docs.length}:${createHash("sha256").update(JSON.stringify(docs)).digest("hex").slice(0, 16)}`;
    }
    return out;
  });
}
type Row = { competitorId: string; displayName: string; rank: number; prizePosition: number | null; assignedJobs: number; closedJobs: number; qualifyingJobs: number };
/** A technician's row, by the CRM name of the fictional roster (display names differ). */
const byName = (rows: Row[], crmName: string) => rows.find((r) => r.competitorId === ids[crmName])!;

let crmBefore: Record<string, string>;
let ids: Record<string, string> = {};

before(async () => {
  crmBefore = await crmFingerprint();
  const already = await crm((db) => db.collection("Job").countDocuments({ date: { $gte: "2026-06-01", $lt: "2026-07-27" } }));
  assert.equal(already, 0, "the fictional CRM must have no jobs in June/July 2026 (the demo week and its baseline)");
  const maps = await crm((db) => db.collection("TechNameMapping").find({}).toArray());
  ids = Object.fromEntries(ROSTER.map((s) => [s.tech, String(maps.find((m) => (m.crmTechNames as string[]).includes(s.tech))!.supabaseUserId)]));
  fs.writeFileSync(path.join(SHADOW, "decisions.json"), JSON.stringify({ schema: DECISIONS_SCHEMA, note: "late-edits demo: nothing to decide", exclusions: [], mappings: [], countOnceDuplicateGroups: [], displayNameOverrides: [] }), { mode: 0o600 });
  fs.writeFileSync(path.join(SHADOW, "accounts.json"), JSON.stringify(Object.fromEntries(Object.values(ids).map((id) => [id, "eligible"]))), { mode: 0o600 });
  if (UI_DB) await local("ui", (db) => db.dropDatabase());
  for (const which of withUi(true)) {
    const rules = which === "v1" ? V1_RULES : V0_RULES;
    await local(which, (db) => db.collection("arena_config_template").insertOne({
      _id: `${TEMPLATE[which]}:v1` as never, templateId: TEMPLATE[which], name: which === "v1" ? "Late-edits demo (Balanced V1)" : "Late-edits demo (Weighted V0)",
      version: 1, current: true, rules, rulesHash: rulesHash(rules), by: "late-edits-e2e", at: new Date().toISOString(),
    }));
  }
  await crm((db) => db.collection("Job").insertMany(DOCS as never[]));
});

after(async () => {
  await crm((db) => db.collection("Job").deleteMany({ _id: { $in: DOCS.map((d) => d._id) } }));
  if (!process.env.ARENA_LATE_EDITS_KEEP_DB) {
    const c = await MongoClient.connect(LOCAL);
    for (const d of [DB.v0, DB.v1]) await c.db(d).dropDatabase();
    await c.close();
  }
  fs.rmSync(SHADOW, { recursive: true, force: true });
  if (!KEEP) fs.rmSync(OUT, { recursive: true, force: true });
});

// ── the story ──────────────────────────────────────────────────────────────

test("1. freeze stores the exact job set (hashes, read time, CRM user) and recomputing from it reproduces the result", async () => {
  for (const which of withUi(true)) {
    const r = await approve(which, ["--stop-after", "freeze"]);
    noSecrets(r);
    assert.equal(r.code, 0, r.out + r.err);
    const { md, data } = outputs(which, "freeze");
    assert.equal(data.outcome, "frozen");
    const s = data.freezeSnapshot;
    assert.equal(s.source.jobs.length, DOCS.length);
    assert.equal(s.source.identity.user, "arena_shadow_ro@admin");
    assert.equal(s.source.identity.database, "ag");
    assert.equal(s.source.identity.collection, "Job");
    assert.equal(s.source.updateTimestamps.field, null, "the fictional CRM (like the real CRM API) records no edit time");
    assert.equal(s.reproducible, true);
    assert.match(md, /recomputed from the stored input: \*\*identical\*\*/);
    const rows: Row[] = s.result.results;
    assert.deepEqual([byName(rows, "Jordan").rank, byName(rows, "Ethan").rank], [3, 4], `${which}: Jordan #3, Ethan #4 at freeze`);
    const e = byName(rows, "Ethan");
    assert.deepEqual([e.assignedJobs, e.closedJobs, e.qualifyingJobs], [35, 20, 30]);
    assert.equal(s.result.results.find((x: Row) => x.competitorId === ids.Ethan).profitMicro, 30_741_550_000);
    const integ = data.integrity.lines.find((l: { label: string }) => /provisional/.test(l.label));
    assert.equal(integ.verdict, "IDENTICAL");
    assert.match(integ.detail, /recomputed from the STORED source snapshot/);
  }
});

test("2/3. immaterial late edits (re-dated out, re-assigned, status, profit) are detected and listed; approval is not blocked by them", async () => {
  await crm(async (db) => {
    const J = db.collection("Job");
    await J.updateOne({ _id: EDIT.liamRedated }, { $set: { date: "2026-07-29" } });
    await J.updateOne({ _id: EDIT.marcusReassigned }, { $set: { tech: "Ava", location: "Indianapolis" } });
    await J.updateOne({ _id: EDIT.mayaStatus }, { $set: { status: "Price Issue" } });
    await J.updateOne({ _id: EDIT.diegoProfit }, { $set: { totalPaidCompanyCash: 1200 } });
  });
  for (const which of withUi(true)) {
    const r = await approve(which, ["--stop-after", "review"]);
    assert.equal(r.code, 0, r.out + r.err);
    const { md, data } = outputs(which, "review-immaterial");
    assert.equal(data.outcome, "in_review");
    const ch = data.lateChanges.changes as { jobId: string; kind: string; detectedAt: string; crmUpdatedAt: string | null }[];
    const kinds = Object.fromEntries(ch.map((c) => [c.jobId, c.kind]));
    assert.equal(kinds[String(EDIT.liamRedated)], "redated_out");
    assert.equal(kinds[String(EDIT.marcusReassigned)], "reassigned");
    assert.ok(ch.some((c) => c.jobId === String(EDIT.marcusReassigned) && c.kind === "location"));
    assert.equal(kinds[String(EDIT.mayaStatus)], "status");
    assert.equal(kinds[String(EDIT.diegoProfit)], "profit");
    assert.ok(ch.every((c) => c.detectedAt && c.crmUpdatedAt === null));
    assert.equal(data.lateChanges.impact.material, false);
    assert.match(md, /not recorded\*\* — the CRM job documents carry no update-timestamp field/);
    assert.match(md, /not blocked by late changes \(listed only\)/);
  }
});

test("4/6. the trial's edit — Ethan's $0 Estimate deleted after the freeze — flips #3/#4 under V0 (and V1) and BLOCKS approval", async () => {
  await crm((db) => db.collection("Job").deleteOne({ _id: EDIT.ethanZeroEstimate }));
  for (const which of withUi(true)) {
    const r = await approve(which);
    assert.equal(r.code, 2, r.out + r.err);
    const { md, data } = outputs(which, "blocked");
    assert.equal(data.outcome, "refused");
    assert.match(data.refusedReason, /CRM jobs changed after the freeze and this changes prizes/);
    const removed = data.lateChanges.changes.find((c: { jobId: string }) => c.jobId === String(EDIT.ethanZeroEstimate));
    assert.equal(removed.kind, "removed");
    assert.equal(removed.detail, "deleted from the CRM");
    assert.equal(data.lateChanges.impact.material, true);
    assert.match(data.lateChanges.impact.reasons.join("; "), /Ethan C\.: prize #4 \(\$150\) → #3 \(\$200\)/);
    assert.match(data.lateChanges.impact.reasons.join("; "), /Arena D\. C\.|Jordan|prize #3 \(\$200\) → #4 \(\$150\)/);
    const rows: Row[] = data.reviewedSnapshot.result.results;
    const e = byName(rows, "Ethan");
    assert.deepEqual([e.rank, e.assignedJobs, e.closedJobs, e.qualifyingJobs], [3, 34, 20, 29]);
    assert.match(md, /\*\*BLOCKED\*\* until the owner chooses keep freeze snapshot \/ accept correction/);
    assert.equal(await local(which, (db) => db.collection("arena_result").countDocuments()), 0, "nothing approved");
  }
});

test("4. the owner decides with a reason: V0 keeps the freeze snapshot, V1 accepts the correction; both approve", async () => {
  let r = await approve("v0", ["--late-decision", "keep-freeze", "--late-reason", "Estimate deleted after the week closed; the freeze stands"]);
  assert.equal(r.code, 0, r.out + r.err);
  let o = outputs("v0", "approved-keep-freeze");
  assert.equal(o.data.outcome, "approved");
  assert.equal(o.data.lateDecision.choice, "keep_freeze");
  assert.equal(o.data.basis, "freeze_jobs");
  let st: Row[] = o.data.result.standings;
  assert.deepEqual([byName(st, "Ethan").prizePosition, byName(st, "Ethan").assignedJobs], [4, 35], "V0: the freeze job set is approved (Ethan #4)");
  assert.match(o.md, /owner decided \*\*KEEP FREEZE SNAPSHOT\*\* — “Estimate deleted after the week closed; the freeze stands”/);
  assert.match(o.md, /## History integrity: IDENTICAL/);

  r = await approve("v1", ["--late-decision", "accept-correction", "--late-reason", "the estimate was a data-entry mistake; use the corrected CRM"]);
  assert.equal(r.code, 0, r.out + r.err);
  o = outputs("v1", "approved-accept-correction");
  assert.equal(o.data.lateDecision.choice, "accept_correction");
  st = o.data.result.standings;
  assert.deepEqual([byName(st, "Ethan").prizePosition, byName(st, "Ethan").assignedJobs], [3, 34], "V1: the corrected read is approved (Ethan #3)");
  assert.match(o.md, /## History integrity: IDENTICAL/);
  for (const which of ["v0", "v1"] as const) {
    const audit = await local(which, (db) => db.collection("arena_audit").find({ action: /^competition\.late_changes\./ }).toArray());
    assert.ok(audit.some((a) => a.action === (which === "v0" ? "competition.late_changes.keep_freeze" : "competition.late_changes.accept_correction") && a.reason));
  }
});

test("5. a CRM edit after approval is detected and logged for the owner; the approved result, snapshot and prize list stay byte-identical (integrity IDENTICAL)", async () => {
  const snapshotOf = (which: Which) => local(which, async (db) => ({
    result: await db.collection("arena_result").findOne({}),
    approval: await db.collection("arena_approval").find({}).toArray(),
    snapshots: await db.collection("arena_snapshot").find({ kind: { $ne: "live" } }).sort({ _id: 1 }).toArray(),
    events: await db.collection("arena_tech_event").countDocuments(),
  }));
  const before = { v0: await snapshotOf("v0"), v1: await snapshotOf("v1") };
  // Post-approval office edit: one of Jordan's closed jobs re-assigned to Marcus.
  await crm((db) => db.collection("Job").updateOne({ _id: EDIT.postApproval }, { $set: { tech: "Marcus", location: "Columbus" } }));
  for (const which of ["v0", "v1"] as const) {
    let r = await approve(which);
    assert.equal(r.code, 0, r.out + r.err);
    const { md, data } = outputs(which, "post-approval-correction");
    assert.equal(data.outcome, "already_approved");
    assert.equal(data.lateCorrection.status, "logged");
    const kinds = data.lateCorrection.report.changes.filter((c: { jobId: string }) => c.jobId === String(EDIT.postApproval)).map((c: { kind: string }) => c.kind).sort();
    assert.deepEqual(kinds, ["location", "reassigned"]);
    assert.equal(data.lateCorrection.record.approvedContentHash, before[which].result!.contentHash);
    assert.match(md, /The approved result .* are NOT changed; the owner handles this manually\. No financial record is created\./);
    assert.match(md, /## History integrity: IDENTICAL/);
    assert.equal(data.integrity.mismatched, 0);
    assert.deepEqual(await snapshotOf(which), before[which], `${which}: approved result, approvals, snapshots and feed unchanged`);
    const corr = await local(which, (db) => db.collection("arena_late_correction").find({}).toArray());
    assert.equal(corr.length, 1);
    // Re-running finds the same change set: logged once only.
    r = await approve(which);
    assert.equal(r.code, 0);
    assert.equal(outputs(which, "post-approval-rerun").data.lateCorrection.status, "already_logged");
    assert.equal(await local(which, (db) => db.collection("arena_late_correction").countDocuments()), 1);
    // Only local arena_* writes, nothing financial.
    const d = outputs(which, "post-approval-safety").data;
    assert.equal(d.safety.ok, true);
    assert.deepEqual(d.safety.financeCollectionsOpened, []);
    for (const w of d.safety.localWrites) assert.match(w, /\.arena_/);
  }
});

test("after the story: the CRM copy on 27032 is byte-identical again once the fictional week is removed", async () => {
  await crm((db) => db.collection("Job").deleteMany({ _id: { $in: DOCS.map((d) => d._id) } }));
  assert.deepEqual(await crmFingerprint(), crmBefore);
});
