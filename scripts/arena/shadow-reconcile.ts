/**
 * Weekly shadow reconciliation report — ONE owner-readable page per shadow week.
 *
 *   node --import ./scripts/arena/transpile-register.mjs \
 *     scripts/arena/shadow-reconcile.ts <weekStart Monday> <outDir> [--decisions <file>] [--strict]
 *
 * Reads only:
 *   - the daily runs        <outDir>/<week>/runs/<time>/data.json            (shadow-week.ts --snapshot)
 *   - the approval runs     <outDir>/<week>-simulated-approval/runs/…/data.json (shadow-approve.ts)
 *   - optional owner files  <outDir>/<week>/preflight.txt (saved preflight output),
 *                           <outDir>/<week>/owner-signoff.txt (A8)
 *   - the LOCAL Arena state ARENA_SHADOW_DB on 127.0.0.1 (wrapped read-only: a write throws in-process)
 * It never connects to the CRM: every number comes from the stored source
 * snapshots (the exact job sets the Arena read) and the stored results.
 *
 * Combines: CRM parity (A1), rules checks (A2), V1 vs the old method on the same
 * frozen input, the review queue (A3), stability and reruns (A4), safety (A5),
 * history integrity (A6), late changes freeze vs re-read with an independent
 * re-diff (A7), and the owner sign-off (A8).
 *
 * Output: <outDir>/<week>-reconciliation/{report.md,data.json} + runs/<time>/, mode 600/700.
 * Exit 0 (report written); with --strict, 2 when any acceptance criterion FAILs.
 */
import fs from "node:fs";
import path from "node:path";
import { MongoClient, type Db } from "mongodb";
import { assertLocalMongoUri, GuardRefusal, readOnly, runGuarded } from "./lib-ro-guard.ts";
import { archiveRun, ensurePrivateDir, readDecisionsFile, runStamp, techAccessEnvVars, writePrivate } from "./lib-shadow.ts";
import {
  acceptance, compareMethods, independentLateDiff, rulesCheck, type ApprovalRunInfo, type BaselineWeek, type DailyRunInfo,
} from "./lib-reconcile.ts";
import { cloneRules, rulesHash } from "../../src/lib/arena/config.ts";
import { computeFromSource } from "../../src/lib/arena/source-snapshot.ts";
import { verifySnapshotSource, type LateCorrectionDoc, type ResultDoc, type SnapshotDoc } from "../../src/lib/arena/lifecycle.ts";
import type { RuleVersionDoc } from "../../src/lib/arena/config-store.ts";
import type { ReviewCaseDoc, IdentityCaseData } from "../../src/lib/arena/review.ts";
import { ARENA_COLLECTIONS } from "../../src/lib/arena/mongo-store.ts";
import { addDays, isMonday, previousWeekStarts } from "../../src/lib/arena/week.ts";
import type { ArenaRules } from "../../src/lib/arena/types.ts";

const etDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const usd = (c: number) => `$${(c / 100).toFixed(0)}`;

function parseArgs(argv: string[]) {
  const pos: string[] = [];
  const o = { decisions: null as string | null, strict: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--decisions") o.decisions = path.resolve(argv[++i] ?? "");
    else if (a === "--strict") o.strict = true;
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else pos.push(a);
  }
  const [week, outDir] = pos;
  if (!week || !outDir) throw new Error("usage: shadow-reconcile.ts <weekStart> <outDir> [--decisions <file>] [--strict]");
  if (!isMonday(week)) throw new Error("weekStart must be a Monday (YYYY-MM-DD)");
  return { week, out: path.resolve(outDir), ...o };
}

const readRuns = (dir: string): { folder: string; data: Record<string, unknown> }[] => {
  const runs = path.join(dir, "runs");
  if (!fs.existsSync(runs)) return [];
  return fs.readdirSync(runs).sort().flatMap((f) => {
    const p = path.join(runs, f, "data.json");
    if (!fs.existsSync(p)) return [];
    try { return [{ folder: f, data: JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown> }]; } catch { return []; }
  });
};

await runGuarded(async () => {
  const args = parseArgs(process.argv.slice(2));
  const week = args.week;
  const weekDir = path.join(args.out, week);
  const approvalDir = path.join(args.out, `${week}-simulated-approval`);
  const outDir = ensurePrivateDir(path.join(ensurePrivateDir(args.out), `${week}-reconciliation`));
  const localUri = process.env.ARENA_SHADOW_LOCAL_URI || "mongodb://127.0.0.1:27031";
  assertLocalMongoUri(localUri);
  const dbName = process.env.ARENA_SHADOW_DB || "arena_shadow";
  if (!/^arena_/.test(dbName)) throw new GuardRefusal("ARENA_SHADOW_DB must be an arena_* database");
  const decisionsFile = args.decisions ?? path.join(args.out, "decisions.json");
  const dec = fs.existsSync(decisionsFile) ? readDecisionsFile(decisionsFile) : null;
  const pendingByFile = new Set((dec?.decisions?.mappings ?? []).filter((m) => m.status === "pending_identification").map((m) => m.crmName.trim()));

  // ── files ────────────────────────────────────────────────────────────────
  const dailyRaw = readRuns(weekDir);
  const daily: DailyRunInfo[] = dailyRaw.map(({ data: d }) => {
    const parity = d.parity as { comparisons: number; mismatches: unknown[] };
    const g = d.guard as { ok: boolean; users: string[] } | undefined;
    return {
      generatedAt: String(d.generatedAt), day: typeof d.dayLabel === "string" ? d.dayLabel : etDay(String(d.generatedAt)), simulatedDay: typeof d.dayLabel === "string", weekEnded: d.weekEnded === true,
      guardOk: g ? g.ok : true, crmUsers: (g?.users ?? (d.crmUser as string[]) ?? []) as string[], blockedWrites: (d.blockedWrites as string[]) ?? [],
      parityComparisons: parity?.comparisons ?? 0, parityMismatches: parity?.mismatches?.length ?? 0, stops: (d.stops as string[]) ?? [],
      inputHash: (d.hashes as { input?: string } | undefined)?.input ?? null, resultHash: (d.hashes as { result?: string } | undefined)?.result ?? null,
    };
  });
  const approvalRaw = readRuns(approvalDir);
  const approvals: ApprovalRunInfo[] = approvalRaw.map(({ data: d }) => {
    const s = (d.safety ?? {}) as { ok?: boolean; crmWriteAttemptsBlocked?: number; financeCollectionsOpened?: string[]; nonArenaLocalWrites?: string[] };
    const i = (d.integrity ?? {}) as { identical?: number; mismatched?: number };
    const plan = (d.decisions as { plan?: { undecided?: ApprovalRunInfo["undecided"] } } | undefined)?.plan;
    return {
      generatedAt: String(d.generatedAt), outcome: String(d.outcome), simulatedClock: (d.clock as { simulated?: boolean } | undefined)?.simulated === true,
      safetyOk: s.ok === true, crmWriteAttemptsBlocked: s.crmWriteAttemptsBlocked ?? 0, financeCollectionsOpened: s.financeCollectionsOpened ?? [],
      nonArenaLocalWrites: s.nonArenaLocalWrites ?? [], integrityIdentical: i.identical ?? 0, integrityMismatched: i.mismatched ?? 0, undecided: plan?.undecided ?? null,
    };
  });
  const preflightFile = path.join(weekDir, "preflight.txt");
  const preflightPassed = fs.existsSync(preflightFile) ? /PREFLIGHT PASSED/.test(fs.readFileSync(preflightFile, "utf8")) : null;
  const signoffFile = path.join(weekDir, "owner-signoff.txt");
  const ownerSignOff = fs.existsSync(signoffFile) ? fs.readFileSync(signoffFile, "utf8").trim() || null : null;

  // ── local Arena state, read-only ─────────────────────────────────────────
  const local = new MongoClient(localUri, { serverSelectionTimeoutMS: 5_000 });
  await local.connect();
  const blocked: string[] = [];
  const db = readOnly(local.db(dbName), dbName, blocked) as Db;
  try {
    const id = `arena_${week}`;
    const comp = await db.collection(ARENA_COLLECTIONS.competitions).findOne({ _id: id as never });
    const result = (await db.collection(ARENA_COLLECTIONS.results).findOne({ _id: id as never })) as unknown as ResultDoc | null;
    const snaps = (await db.collection(ARENA_COLLECTIONS.snapshots).find({ competitionId: id, kind: { $in: ["provisional", "reconciled"] } }).sort({ n: 1 }).toArray()) as unknown as SnapshotDoc[];
    const freeze = snaps.find((s) => s.kind === "provisional") ?? null;
    const reconciled = snaps.filter((s) => s.kind === "reconciled");
    const target = result ? snaps.find((s) => s._id === result.snapshotId) ?? null : reconciled[reconciled.length - 1] ?? freeze;
    const rv = target ? ((await db.collection(ARENA_COLLECTIONS.ruleVersions).findOne({ _id: target.ruleVersionId as never })) as unknown as RuleVersionDoc | null) : null;
    const cases = ((await db.collection(ARENA_COLLECTIONS.reviewCases).find({ weeks: week }).sort({ _id: 1 }).toArray()) as unknown as ReviewCaseDoc[]);
    const corrections = ((await db.collection(ARENA_COLLECTIONS.lateCorrections).find({ competitionId: id }).sort({ _id: 1 }).toArray()) as unknown as LateCorrectionDoc[]);

    // A2 + V1 vs V0 + reproducibility, all from the stored source of the snapshot approved (or under review)
    let rules: ReturnType<typeof rulesCheck> | null = null;
    let methods: ReturnType<typeof compareMethods> = [];
    let reproducible: boolean | null = null;
    let v0Paid = 0;
    if (target && rv) {
      let baseline: BaselineWeek[] = [];
      if (target.source && rv.rules.mostImproved.enabled) {
        const alone: ArenaRules = cloneRules(rv.rules);
        alone.mostImproved.enabled = false;
        baseline = previousWeekStarts(week, rv.rules.mostImproved.baselineWeeks).map((w) => ({ weekStart: w, results: computeFromSource(target.source!, alone, rulesHash(alone), w).results }));
      }
      rules = rulesCheck(target.result, rv.rules, baseline);
      if (target.source) {
        const v0: ArenaRules = cloneRules(rv.rules);
        delete (v0.scoring as { methodology?: string }).methodology;
        const r0 = computeFromSource(target.source, v0, rulesHash(v0), week);
        methods = compareMethods(target.result, r0);
        v0Paid = r0.awardedCents;
        reproducible = verifySnapshotSource(target, rv).ok;
      }
    }

    // A7: freeze vs the latest real re-read (a keep-freeze snapshot carries the freeze jobs, so it is skipped)
    const lastRead = [...reconciled].reverse().find((s) => s.basis !== "freeze_jobs" && s.source) ?? null;
    let late: Parameters<typeof acceptance>[0]["late"] = null;
    if (freeze?.source && (lastRead || corrections.length)) {
      const independent = lastRead ? independentLateDiff(freeze.source.jobs, lastRead.source!.jobs, week, addDays(week, 7)) : [];
      const reviewed = target ?? lastRead;
      late = {
        detected: [...new Set((lastRead?.lateChanges?.changes ?? []).map((c) => c.jobId))],
        independent, material: !!reviewed?.lateChanges?.impact.material, decided: reviewed?.lateDecision?.choice ?? null, postApproval: corrections.length,
      };
    }

    const openCases = cases.filter((c) => c.status !== "resolved")
      .filter((c) => !(c.kind === "identity_name" && pendingByFile.has((c.data as IdentityCaseData).crmName.trim())))
      .map((c) => `${c.kind.replace("_", " ")} ${c.kind === "identity_name" ? (c.data as IdentityCaseData).crmName : c.key} (${c.status.replace("_", " ")})`);
    const pendingNames = cases.filter((c) => c.kind === "identity_name" && c.status === "open" && pendingByFile.has((c.data as IdentityCaseData).crmName.trim()))
      .map((c) => `${(c.data as IdentityCaseData).crmName} (${(c.data as IdentityCaseData).jobs} jobs)`);
    const expectedDays = [...Array.from({ length: 7 }, (_, i) => addDays(week, i)), addDays(week, 7)];
    const A = acceptance({
      weekStart: week, expectedDays, daily, approvals, rules, openCases, pendingNames, late, reproducible,
      techAccessEnv: techAccessEnvVars(process.env), preflightPassed, ownerSignOff,
    });

    // ── report ─────────────────────────────────────────────────────────────
    const md: string[] = [];
    const out = (s = "") => md.push(s);
    const at = new Date().toISOString();
    const overall = A.some((l) => l.verdict === "FAIL") ? "FAIL" : A.every((l) => l.verdict === "PASS") ? "PASS" : "INCOMPLETE";
    out(`# 317 LIVE ARENA — weekly shadow reconciliation · ${week} → ${addDays(week, 6)}`);
    out(`Generated ${at} · local \`${dbName}\` (read-only) · ${daily.length} daily run(s), ${approvals.length} approval run(s) · competition ${comp ? `\`${id}\` status **${comp.status}**` : "not created yet"}`);
    out();
    out(`SIMULATION ONLY. Nothing here pays a prize or creates a Ledger, Payout or financial record. The CRM is not contacted by this report.`);
    out();
    out(`## Acceptance (overall: **${overall}**)`);
    out(`| # | Criterion | Verdict | Evidence |`);
    out(`|---|---|---|---|`);
    for (const l of A) out(`| ${l.id} | ${l.name} | **${l.verdict}** | ${l.detail.replace(/\|/g, "/")} |`);
    out();
    out(`## 1. CRM parity (A1) and daily runs (A4, A5)`);
    const sim = daily.filter((d) => d.simulatedDay).length;
    if (sim) out(`**REHEARSAL:** ${sim} run(s) carry a simulated day label (--day-label); their real run times are shown. A real shadow week never uses labels.`);
    out(`| ET day | Run (UTC) | Week ended | Guard | Parity (comparisons / mismatches) | STOP | Input | Result |`);
    out(`|---|---|---|---|---|---|---|---|`);
    for (const d of daily) out(`| ${d.day} | ${d.generatedAt} | ${d.weekEnded ? "yes" : "no"} | ${d.guardOk ? "PASS" : "FAIL"} | ${d.parityComparisons} / ${d.parityMismatches} | ${d.stops.length ? d.stops.join("; ").replace(/\|/g, "/") : "—"} | ${d.inputHash?.slice(0, 10) ?? "—"} | ${d.resultHash?.slice(0, 10) ?? "—"} |`);
    out();
    out(`## 2. Rules check (A2) on ${result ? `the approved snapshot \`${result.snapshotId}\`` : target ? `the snapshot under review \`${target._id}\` (not approved)` : "—"}`);
    if (rv) out(`Rules ${rv._id} · fingerprint \`${rv.rulesHash}\` · ${rv.rules.scoring.methodology ?? "WEIGHTED_V0"}`);
    for (const l of rules ?? []) out(`- ${l.ok ? "PASS" : "**FAIL**"} ${l.id} — ${l.detail}`);
    out();
    out(`## 3. V1 (primary) vs the old method (information only, same frozen input)`);
    if (methods.length) {
      out(`| Technician | V1 rank | V1 score | V1 prize | Old rank | Old score | Old prize | Moved |`);
      out(`|---|---|---|---|---|---|---|---|`);
      for (const m of methods) out(`| ${m.displayName} | ${m.v1.rank} | ${m.v1.score.toFixed(2)} | ${m.v1.prizeCents ? usd(m.v1.prizeCents) : "—"} | ${m.v0?.rank ?? "—"} | ${m.v0?.score.toFixed(2) ?? "—"} | ${m.v0?.prizeCents ? usd(m.v0.prizeCents) : "—"} | ${m.moved} |`);
      out(`\nV1 paid ${usd(target!.result.awardedCents)} · old method would pay ${usd(v0Paid)}.`);
    } else out(`No stored source snapshot yet.`);
    out();
    out(`## 4. Review queue (A3)`);
    for (const c of cases) out(`- ${c.status === "resolved" ? "resolved" : `**${c.status.replace("_", " ")}**`} · ${c.kind.replace("_", " ")} · ${c.kind === "identity_name" ? (c.data as IdentityCaseData).crmName : c.key}${c.resolution ? ` → ${JSON.stringify(c.resolution)}` : ""}${c.reason ? ` — ${c.reason}` : ""}`);
    if (!cases.length) out(`No review case recorded for this week in the local database.`);
    out();
    out(`## 5. Late changes: freeze vs re-read (A7)`);
    if (freeze?.source) out(`Freeze \`${freeze._id}\` read ${freeze.source.readAt} (${freeze.source.jobs.length} jobs, hash ${freeze.source.jobsHash.slice(0, 12)}…)${lastRead ? ` · latest re-read \`${lastRead._id}\` ${lastRead.source!.readAt} (hash ${lastRead.source!.jobsHash.slice(0, 12)}…)` : " · no re-read yet"}`);
    for (const c of lastRead?.lateChanges?.changes ?? []) out(`- listed: \`${c.jobId}\` ${c.kind} — ${c.detail} (${c.techBefore ?? "—"} → ${c.techAfter ?? "—"})`);
    for (const c of late?.independent ?? []) out(`- independent re-diff: \`${c.jobId}\` ${c.what}${late!.detected.includes(c.jobId) ? "" : " — **NOT LISTED**"}`);
    const tl = target?.lateChanges ?? lastRead?.lateChanges;
    if (tl) out(`Effect on prizes: ${tl.impact.material ? `**MATERIAL** — ${tl.impact.reasons.join("; ")}` : "none"}${target?.lateDecision ? ` · owner decision: **${target.lateDecision.choice}** — “${target.lateDecision.reason}”` : ""}`);
    for (const c of corrections) out(`- post-approval correction \`${c._id}\` detected ${c.detectedAt}: ${c.report.changes.length} change(s), approved hash ${c.approvedContentHash.slice(0, 16)}… unchanged (owner handles manually)`);
    out();
    out(`## 6. Simulated approval and history (A6)`);
    for (const a of approvals) out(`- ${a.generatedAt} · **${a.outcome}**${a.simulatedClock ? " (simulated clock — testing only)" : ""} · safety ${a.safetyOk ? "OK" : "FAILED"} · integrity ${a.integrityIdentical} identical / ${a.integrityMismatched} mismatched`);
    if (result) out(`\nApproved (SIMULATION) by \`${result.approvedBy}\` at ${result.approvedAt} · paid on paper ${usd(result.awardedCents)} of ${usd(result.budgetCents)} · content hash \`${result.contentHash}\` · winners: ${result.standings.filter((s) => s.prizeCents > 0).map((s) => `${s.prizePosition ? `#${s.prizePosition}` : "Most Improved"} ${s.displayName} ${usd(s.prizeCents)}`).join(", ")}`);
    out();
    out(`## 7. Owner sign-off (A8)`);
    out(ownerSignOff ? `Signed: ${ownerSignOff}` : `Not signed. To sign, write one line (name, date, "winners look right" or what is wrong) into \`${signoffFile}\` and re-run this report.`);
    out();
    out(`In-process write attempts on the local database during this report: ${blocked.length} (expected 0).`);

    const data = { week, generatedAt: at, overall, acceptance: A, rules, methods, late, daily, approvals, openCases, pendingNames, reproducible, resultContentHash: result?.contentHash ?? null, localWritesBlocked: blocked };
    const files = { "report.md": md.join("\n") + "\n", "data.json": JSON.stringify(data, null, 1) };
    for (const [f, c] of Object.entries(files)) writePrivate(outDir, f, c);
    archiveRun(outDir, runStamp(at), files);
    console.log(`reconciliation ${week}: overall ${overall} · ${A.map((l) => `${l.id} ${l.verdict}`).join(" · ")} → ${outDir}`);
    return args.strict && overall === "FAIL" ? 2 : blocked.length ? 1 : 0;
  } finally {
    await local.close().catch(() => {});
  }
});
