/**
 * SIMULATED winner approval for one finished shadow week — LOCAL Arena database only.
 *
 *   node --env-file=<file> --import ./scripts/arena/transpile-register.mjs \
 *     scripts/arena/shadow-approve.ts <weekStart Monday> <outDir> \
 *       [--accounts <file.json>] [--accept-unverified-for-simulation] \
 *       [--decisions <file.json>] [--template <templateId>] [--allow-early]
 *
 * Runs the REAL lifecycle (lifecycle.ts) against ARENA_SHADOW_DB on 127.0.0.1:
 *   create/start the week (if needed) → freeze → open review → apply the
 *   owner's decisions file as Arena review decisions → re-check → approve,
 * as actor "shadow-simulation", with `simulated: true` on the competition, the
 * result and the approval records, and a SIMULATION banner on every output.
 *
 * Safety:
 *   - CRM: read through lib-ro-guard only (server-proven read-only user + the
 *     in-process write-blocking proxy). No CRM collection is ever opened for
 *     writing; every CRM collection opened is listed in the report.
 *   - Every local write is recorded (db.collection.method) and must be an
 *     arena_* collection of the local 127.0.0.1 database, or the run fails.
 *   - Nothing creates a Ledger, Payout or finance_* record (asserted statically
 *     by src/lib/arena/shadow-tooling.test.ts over the Arena lib and scripts).
 *   - No Weekly Balance connection: account standing comes from --accounts
 *     ({ competitorId: "eligible" | "pending" | "inactive" | "unmapped" |
 *     "not_competing_role" }), filled by the owner from the WB admin screen;
 *     anyone missing is "unverified". A prize position that is unverified
 *     refuses the approval unless --accept-unverified-for-simulation (then the
 *     report names those positions).
 *   - Refused before the week has ended and before the review window opens
 *     (Tuesday 12:00 America/New_York) unless --allow-early (TESTING ONLY: the
 *     lifecycle then runs on a simulated clock set just after the window opens).
 *
 * After approval: the history integrity check over the local database.
 * Output: <outDir>/<weekStart>-simulated-approval/{report.md,data.json}, mode
 * 600, folder 700, refused inside any git repository.
 * Exit: 0 approved (integrity IDENTICAL), 1 error / safety or integrity failure,
 * 2 refused by a rule (nothing approved), 3 guard refusal.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { MongoClient, type Db } from "mongodb";
import { assertLocalMongoUri, GuardRefusal, openGuardedCrm, runGuarded } from "./lib-ro-guard.ts";
import {
  DEFAULT_SHADOW_DIR, SIMULATION_ACTOR as ACTOR, SIMULATION_BANNER, ensurePrivateDir, integrityCheck, markSimulated, parseAccountsFile,
  planDecisions, readDecisionsFile, readFingerprintFile, rulesFingerprint, rulesSummary, simulationAccounts, trackWrites, writePrivate,
  type DecisionPlan,
} from "./lib-shadow.ts";
import { SEED_BALANCED_PERFORMANCE, SEED_SETTINGS_BUDGET_CEILING_CENTS, cloneRules } from "../../src/lib/arena/config.ts";
import {
  ArenaStateError, activateCompetition, createCompetition, initSettings, scheduleCompetition, type CompetitionDoc, type RuleVersionDoc, type StoreContext,
} from "../../src/lib/arena/config-store.ts";
import {
  approveResults, freezeCompetition, openReview, reconcileCompetition, reviewSnapshot, type LifecycleContext, type ResultDoc,
} from "../../src/lib/arena/lifecycle.ts";
import { computeCompetition } from "../../src/lib/arena/engine.ts";
import { buildCompetitorMap } from "../../src/lib/arena/identity.ts";
import { loadJobs } from "../../src/lib/arena/job-source.ts";
import { detectCases } from "../../src/lib/arena/detect.ts";
import { caseId, resolveCase, reviewDecisions, syncDetected, type ReviewCaseDoc, type ReviewContext } from "../../src/lib/arena/review.ts";
import { ARENA_COLLECTIONS, arenaStores, lifecycleCollections, loadMappings, loadTechnicians } from "../../src/lib/arena/mongo-store.ts";
import { addDays, isMonday, previousWeekStarts, weekWindow } from "../../src/lib/arena/week.ts";
import { KNOWN_STATUSES } from "../../src/lib/status-canonical.ts";
import type { AccountState, ArenaRules, CompetitionResult } from "../../src/lib/arena/types.ts";

const REFUSED = 2;

function parseArgs(argv: string[]) {
  const pos: string[] = [];
  const o = {
    accounts: null as string | null, acceptUnverified: false, allowEarly: false, template: null as string | null,
    decisions: path.join(DEFAULT_SHADOW_DIR, "decisions.json"), rulesConfirmation: path.join(DEFAULT_SHADOW_DIR, "approved-rules.sha256"),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); return v; };
    if (a === "--accounts") o.accounts = path.resolve(val());
    else if (a === "--accept-unverified-for-simulation") o.acceptUnverified = true;
    else if (a === "--allow-early") o.allowEarly = true;
    else if (a === "--template") o.template = val();
    else if (a === "--decisions") o.decisions = path.resolve(val());
    else if (a === "--rules-confirmation") o.rulesConfirmation = path.resolve(val());
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else pos.push(a);
  }
  const [week, outDir] = pos;
  if (!week || !outDir)
    throw new Error("usage: shadow-approve.ts <weekStart> <outDir> [--accounts <file>] [--accept-unverified-for-simulation] [--decisions <file>] [--template <id>] [--allow-early]");
  if (!isMonday(week)) throw new Error("weekStart must be a Monday (YYYY-MM-DD)");
  return { week, outDir: path.resolve(outDir), ...o };
}

class Refusal extends Error {}

const usd = (c: number) => `$${(c / 100).toFixed(0)}`;
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

await runGuarded(async () => {
  const args = parseArgs(process.argv.slice(2));
  // Refuse an in-repo / git-tracked output path before touching any database.
  const outDir = ensurePrivateDir(path.join(ensurePrivateDir(args.outDir), `${args.week}-simulated-approval`));

  const localUri = process.env.ARENA_SHADOW_LOCAL_URI || "mongodb://127.0.0.1:27031";
  assertLocalMongoUri(localUri);
  const dbName = process.env.ARENA_SHADOW_DB || "arena_shadow";
  if (!/^arena_/.test(dbName)) throw new GuardRefusal("ARENA_SHADOW_DB must be an arena_* database");

  // Inputs (files) before any connection.
  const dec = readDecisionsFile(args.decisions);
  if (!dec.decisions) throw new Error(`decisions file ${args.decisions}: ${dec.problems.join("; ")}`);
  const decisions = dec.decisions;
  let accountStates: Record<string, AccountState> = {};
  let accountsCheckedAt = new Date().toISOString();
  if (args.accounts) {
    const parsed = parseAccountsFile(JSON.parse(fs.readFileSync(args.accounts, "utf8")));
    if (parsed.problems.length) throw new Error(`accounts file ${args.accounts}: ${parsed.problems.join("; ")}`);
    accountStates = parsed.states;
    accountsCheckedAt = fs.statSync(args.accounts).mtime.toISOString();
  }
  const acc = simulationAccounts(accountStates, accountsCheckedAt);

  const md: string[] = [];
  const out = (s = "") => md.push(s);
  const data: Record<string, unknown> = { simulated: true, banner: SIMULATION_BANNER, actor: ACTOR, week: args.week };
  const steps: string[] = [];
  let outcome: "approved" | "already_approved" | "refused" | "error" = "error";
  let refusedReason: string | null = null;
  let exitCode = 1;
  let unverifiedPrize: { competitorId: string; displayName: string; position: string }[] = [];

  // CRM: read-only, proven before any read. Every collection opened is recorded.
  const crm = await openGuardedCrm();
  const crmOpened = new Set<string>();
  const crmDb = new Proxy(crm.db, {
    get(t, p, r) {
      const v = Reflect.get(t, p, r);
      if (p === "collection" && typeof v === "function") return (n: string, ...a: unknown[]) => { crmOpened.add(n); return v.call(t, n, ...a); };
      return typeof v === "function" ? v.bind(t) : v;
    },
  }) as Db;
  const local = new MongoClient(localUri, { serverSelectionTimeoutMS: 5_000 });
  await local.connect();
  const rawArena = local.db(dbName);
  if (rawArena.databaseName === crm.db.databaseName) throw new GuardRefusal("the local Arena database must not be the CRM database");
  const localWrites: string[] = [];
  const arena = trackWrites(rawArena, localWrites);

  try {
    // Rules: a local template, else the owner-approved Balanced Performance seed.
    let rules: ArenaRules = cloneRules(SEED_BALANCED_PERFORMANCE);
    let rulesLabel = "Balanced Performance (owner-approved seed, code)";
    if (args.template) {
      const t = await rawArena.collection(ARENA_COLLECTIONS.templates).findOne({ templateId: args.template, current: true });
      if (!t) throw new Error(`template "${args.template}" not found in the local ${dbName} database`);
      rules = cloneRules(t.rules as ArenaRules);
      rulesLabel = `${t.name} v${t.version} (local ${dbName})`;
    }
    const fp = rulesFingerprint(rules);
    const confirmedFp = readFingerprintFile(args.rulesConfirmation);
    if (confirmedFp && confirmedFp !== fp) throw new Refusal(`the rules (${fp.slice(0, 12)}…) differ from the owner-confirmed fingerprint in ${args.rulesConfirmation}`);
    const rulesConfirmed = confirmedFp === fp ? "matches the owner-confirmed fingerprint" : "NOT owner-confirmed yet (no approved-rules.sha256)";

    // Clock: the real one, or (--allow-early, testing only) a simulated one just after the review window opens.
    const w = weekWindow(args.week, rules.timezone, rules.review);
    const realNow = new Date();
    let offsetMs = 0;
    const early = realNow < w.closesAt || realNow < w.approvalOpensAt;
    if (early) {
      const why = realNow < w.closesAt
        ? `the week ${args.week} has not ended (it closes ${w.closesAt.toISOString()})`
        : `the review window opens ${w.approvalOpensAt.toISOString()} (Tuesday 12:00 ${rules.timezone})`;
      if (!args.allowEarly) throw new Refusal(`${why}; refusing (use --allow-early only for testing)`);
      offsetMs = w.approvalOpensAt.getTime() + 1000 - realNow.getTime();
      console.error(`\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n!! --allow-early: ${why}.\n!! TESTING ONLY. The lifecycle runs on a SIMULATED clock (${w.approvalOpensAt.toISOString()} + 1 s).\n!! Late CRM entries are missing; this result means nothing for the real week.\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n`);
    }
    const clock = () => new Date(Date.now() + offsetMs);
    data.clock = { real: realNow.toISOString(), simulated: early, lifecycleNow: clock().toISOString(), weekClosesAt: w.closesAt.toISOString(), approvalOpensAt: w.approvalOpensAt.toISOString() };
    data.rules = { label: rulesLabel, fingerprint: fp, confirmation: rulesConfirmed, summary: rulesSummary(rules) };

    // Contexts over the LOCAL database (write-tracked), simulated: true on competitions/results/approvals.
    const stores = arenaStores(arena);
    stores.config.competitions = markSimulated(stores.config.competitions);
    const lc = lifecycleCollections(arena);
    lc.results = markSimulated(lc.results);
    lc.approvals = markSimulated(lc.approvals);
    const newId = (p: string) => `${p}_${randomUUID()}`;
    const config: StoreContext = { store: stores.config, knownStatuses: KNOWN_STATUSES, now: clock, newId };
    const mappingsNow = await loadMappings(crmDb);
    const review: ReviewContext = {
      store: stores.review, ownerUserId: async () => ACTOR, now: clock, newId,
      verifiedCompetitorIds: async () => new Set(mappingsNow.map((m) => m.supabaseUserId).filter(Boolean)),
    };
    const settings = await stores.config.settings.findOne({ current: true });
    if (!settings) {
      await initSettings(config, { budgetCeilingCents: SEED_SETTINGS_BUDGET_CEILING_CENTS, ownerUserId: ACTOR, approverUserIds: [ACTOR] }, ACTOR);
      steps.push(`initialised local settings (owner ${ACTOR}, ceiling ${usd(SEED_SETTINGS_BUDGET_CEILING_CENTS)})`);
    } else if (settings.ownerUserId !== ACTOR)
      throw new Refusal(`the local ${dbName} database belongs to another owner (${settings.ownerUserId}); use a separate ARENA_SHADOW_DB for simulations`);

    const compute = async (weekStart: string, rv: RuleVersionDoc): Promise<CompetitionResult> => {
      const weeks = rv.rules.mostImproved.enabled ? previousWeekStarts(weekStart, rv.rules.mostImproved.baselineWeeks) : [];
      const from = weeks.length ? weeks[weeks.length - 1] : weekStart;
      const [jobs, mappings, technicians, d] = await Promise.all([
        loadJobs(crmDb, [from, weekStart].sort()[0], addDays(weekStart, 7)), loadMappings(crmDb), loadTechnicians(crmDb), reviewDecisions(review),
      ]);
      const competitors = buildCompetitorMap({ mappings, technicians, crmNamesInUse: [...new Set(jobs.map((j) => j.tech))], overrides: d.overrides, displayNames: d.displayNames });
      return computeCompetition({
        rules: rv.rules, rulesHash: rv.rulesHash, weekStart, competitors, jobs, exclusions: d.exclusions,
        dismissedDuplicateGroups: d.dismissedDuplicateGroups, accounts: acc.lookup(competitors.competitors.map((c) => c.id)),
      });
    };
    const lctx: LifecycleContext = { config, lc, compute, checkAccounts: async (ids) => acc.lookup(ids), devStack: false };

    // Decisions → review cases for this week (detect, record, plan). Conflicts refuse before anything changes.
    const [weekJobs, technicians, before] = await Promise.all([
      loadJobs(crmDb, args.week, addDays(args.week, 7)), loadTechnicians(crmDb), reviewDecisions(review),
    ]);
    const found = detectCases({
      weeks: [{ weekStart: args.week, jobs: weekJobs }], mappings: mappingsNow, technicians, rules,
      overrides: before.overrides, displayNames: before.displayNames, exclusions: before.exclusions,
    });
    await syncDetected(review, found, ACTOR);
    const foundIds = new Set(found.map((f) => caseId(f.kind, f.key)));
    const cases = (await stores.review.cases.find({}).sort({ _id: 1 }).toArray()).filter((c: ReviewCaseDoc) =>
      c.kind !== "duplicate_group" || foundIds.has(c._id) || c.weeks.includes(args.week));
    const plan: DecisionPlan = planDecisions(cases, decisions);
    data.decisions = { file: args.decisions, plan };
    if (plan.conflicts.length) throw new Refusal(`decisions conflict with the local database: ${plan.conflicts.join("; ")}`);

    // Lifecycle.
    const id = `arena_${args.week}`;
    const get = async () => (await stores.config.competitions.findOne({ _id: id })) as CompetitionDoc | null;
    let c = await get();
    if (!c) {
      await createCompetition(config, args.week, { rules }, ACTOR);
      await scheduleCompetition(config, id, ACTOR);
      await activateCompetition(config, id, ACTOR);
      steps.push(`created and started ${id} (rules ${fp.slice(0, 12)}…)`);
      c = await get();
    } else {
      const rv = await stores.config.ruleVersions.findOne({ _id: c.ruleVersionId });
      if (rv?.rulesHash !== fp) throw new Refusal(`${id} already exists locally with different rules (${rv?.rulesHash?.slice(0, 12)}…); use a fresh ARENA_SHADOW_DB`);
      steps.push(`resumed ${id} (status ${c.status})`);
    }
    if (c!.status === "draft") { await scheduleCompetition(config, id, ACTOR); c = await get(); }
    if (c!.status === "scheduled") { await activateCompetition(config, id, ACTOR); c = await get(); }
    if (c!.status === "cancelled") throw new Refusal(`${id} is cancelled in the local database`);

    let result: ResultDoc | null = null;
    if (c!.status === "approved") {
      outcome = "already_approved";
      result = (await lc.results.findOne({ _id: id })) as ResultDoc | null;
      steps.push(`already approved at ${result?.approvedAt} — nothing changed`);
      exitCode = 0;
    } else {
      if (c!.status === "active" || c!.status === "suspended") {
        const s = await freezeCompetition(lctx, id, ACTOR);
        steps.push(`froze the week → ${s._id}`);
        c = await get();
      }
      if (c!.status === "provisional") {
        const s = await openReview(lctx, id, ACTOR);
        steps.push(`opened review → ${s._id}`);
        c = await get();
      }
      if (c!.status !== "in_review") throw new Error(`unexpected status ${c!.status}`);
      for (const r of plan.apply) {
        await resolveCase(review, r.caseId, r.resolution, ACTOR, r.reason);
        steps.push(`applied decision: ${r.label}`);
      }
      const s = await reconcileCompetition(lctx, id, ACTOR);
      steps.push(`re-checked the CRM data → ${s._id}`);
      const snap = (await reviewSnapshot(lctx, id))!;
      data.reviewedSnapshot = { id: snap._id, result: snap.result };
      unverifiedPrize = snap.result.results
        .filter((r) => (r.prizePosition !== null || r.wonMostImproved) && acc.rawState(r.competitorId) === "unverified")
        .map((r) => ({ competitorId: r.competitorId, displayName: r.displayName, position: r.prizePosition ? `#${r.prizePosition}` : "Most Improved" }));
      const names = unverifiedPrize.map((u) => `${u.position} ${u.displayName}`).join(", ");
      if (unverifiedPrize.length && !args.acceptUnverified) {
        throw new Refusal(`Weekly Balance account standing is unverified for prize position(s) ${names}. Fill --accounts from the WB admin screen, or pass --accept-unverified-for-simulation. The week stays in review; re-run to continue`);
      }
      const note = `SIMULATION (shadow practice run by ${ACTOR}): not a real approval, nothing is paid.` +
        (unverifiedPrize.length ? ` Account standing NOT verified, accepted for simulation only: ${names}.` : "");
      try {
        result = await approveResults(lctx, id, ACTOR, { snapshotId: snap._id, note });
      } catch (e) {
        if (e instanceof ArenaStateError) throw new Refusal(`the lifecycle refused the approval: ${e.message}`);
        throw e;
      }
      steps.push(`approved ${id} as ${ACTOR} (simulated) → content hash ${result.contentHash.slice(0, 16)}…`);
      outcome = "approved";
      exitCode = 0;
    }
    data.result = result;
  } catch (e) {
    if (e instanceof Refusal) {
      outcome = "refused";
      refusedReason = e.message;
      exitCode = REFUSED;
    } else if (e instanceof GuardRefusal) throw e;
    else {
      refusedReason = e instanceof Error ? e.message : String(e);
      outcome = "error";
      exitCode = 1;
    }
  }

  data.steps = steps;
  data.accounts = {
    file: args.accounts, states: accountStates, missingMeans: "unverified",
    unverifiedPrizePositions: unverifiedPrize, acceptedUnverifiedForSimulation: args.acceptUnverified && unverifiedPrize.length > 0,
    assumedEligibleForSimulation: [...acc.assumed].sort(),
  };

  // Safety and integrity (read-only).
  const badLocal = localWrites.filter((x) => !x.startsWith(`${dbName}.arena_`));
  const crmCollections = [...crmOpened].sort();
  const finance = crmCollections.filter((n) => /ledger|payout|finance_/i.test(n));
  const safety = {
    crmUser: crm.verdict.users, crmCollectionsOpened: crmCollections, crmWriteAttemptsBlocked: crm.blocked.length,
    localUri: "mongodb://127.0.0.1 (credentials not shown)", localDb: dbName,
    localWrites: Object.entries(localWrites.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {})).map(([k, n]) => `${k} ×${n}`).sort(),
    nonArenaLocalWrites: badLocal, financeCollectionsOpened: finance,
    ok: crm.blocked.length === 0 && badLocal.length === 0 && finance.length === 0,
  };
  data.safety = safety;
  if (!safety.ok) { exitCode = 1; outcome = outcome === "approved" ? "error" : outcome; }
  const integrity = await integrityCheck(crm.db, rawArena);
  data.integrity = integrity;
  const integrityVerdict = integrity.mismatched ? "MISMATCH" : integrity.identical ? "IDENTICAL" : "NO APPROVED RECORDS";
  if (integrity.mismatched && exitCode === 0) exitCode = 1;
  data.outcome = outcome;
  data.refusedReason = refusedReason;
  data.generatedAt = new Date().toISOString();

  // Report.
  const r = data.result as ResultDoc | null;
  out(`> **${SIMULATION_BANNER}**`);
  out();
  out(`# 317 LIVE ARENA — SIMULATED approval · week ${args.week} → ${addDays(args.week, 6)}`);
  out(`Generated ${data.generatedAt} · actor \`${ACTOR}\` · local database \`${dbName}\` on 127.0.0.1 · CRM read-only as ${crm.verdict.users.join(", ")}`);
  out();
  out(`## Outcome: ${outcome === "approved" ? "SIMULATED APPROVAL RECORDED" : outcome === "already_approved" ? "ALREADY APPROVED (simulation) — unchanged" : outcome === "refused" ? "REFUSED — nothing approved" : "ERROR — nothing approved"}`);
  if (refusedReason) out(`**Reason:** ${refusedReason}`);
  const clk = data.clock as { real: string; simulated: boolean; lifecycleNow: string } | undefined;
  if (clk?.simulated) out(`\n**--allow-early (TESTING ONLY):** the week had not ended / the review window was not open at ${clk.real}; the lifecycle ran on a simulated clock (${clk.lifecycleNow}). This result says nothing about the real week.`);
  out();
  const rl = data.rules as { label: string; fingerprint: string; confirmation: string; summary: string[] } | undefined;
  if (rl) {
    out(`## Rules`);
    out(`${rl.label} · fingerprint \`${rl.fingerprint}\` · ${rl.confirmation}`);
    for (const s of rl.summary) out(`- ${s}`);
    out();
  }
  const ac = data.accounts as { file: string | null; states: Record<string, string>; unverifiedPrizePositions: { displayName: string; position: string }[]; acceptedUnverifiedForSimulation: boolean; assumedEligibleForSimulation: string[] } | undefined;
  out(`## Weekly Balance account standing (no WB connection in shadow)`);
  out(`Source: ${args.accounts ? `${args.accounts} (${Object.keys(accountStates).length} entries, filled by the owner from the WB admin screen)` : "none — every account is unverified"}. Missing = unverified (never moves a prize).`);
  if (ac?.unverifiedPrizePositions.length) out(`**Unverified prize positions${ac.acceptedUnverifiedForSimulation ? " — ACCEPTED FOR SIMULATION ONLY" : ""}:** ${ac.unverifiedPrizePositions.map((u) => `${u.position} ${u.displayName}`).join(", ")}`);
  else if (data.result) out(`Every prize position has an account standing from the file.`);
  if (ac?.assumedEligibleForSimulation.length) out(`Unverified competitors recorded as eligible for the practice run (it never changes ranks or prizes): ${ac.assumedEligibleForSimulation.length}.`);
  out();
  const dd = data.decisions as { file: string; plan: DecisionPlan } | undefined;
  if (dd) {
    out(`## Data-review decisions (Arena-only; no CRM record changes)`);
    out(`File: ${dd.file}. Applied: ${dd.plan.apply.length} · already in force: ${dd.plan.alreadyInForce.length} · conflicts: ${dd.plan.conflicts.length}`);
    for (const x of dd.plan.apply) out(`- applied: ${x.label}`);
    for (const x of dd.plan.alreadyInForce) out(`- in force: ${x}`);
    for (const x of dd.plan.conflicts) out(`- **conflict:** ${x}`);
    for (const x of dd.plan.notes) out(`- note: ${x}`);
    out();
  }
  out(`## Lifecycle steps`);
  for (const s of steps) out(`- ${s}`);
  out();
  if (r) {
    out(`## Approved standings (SIMULATION)`);
    out(`Paid on paper ${usd(r.awardedCents)} of ${usd(r.budgetCents)} · unallocated ${usd(r.unallocatedCents)} · approved by \`${r.approvedBy}\` at ${r.approvedAt} · content hash \`${r.contentHash}\``);
    out(`Note: ${r.note ?? "—"}`);
    out();
    out(`| Rank | Technician | Location | Assigned | Closed | Closing Rate | AVG TICKET | Qualifying | Score | Gates | Account | Prize |`);
    out(`|---|---|---|---|---|---|---|---|---|---|---|---|`);
    for (const s of r.standings) {
      const gates = [s.gates.jobs ? "" : "jobs", s.gates.avgTicket ? "" : "AVG", s.gates.closingRate ? "" : "CR"].filter(Boolean).join("+") || "all met";
      const unv = ac?.unverifiedPrizePositions.some((u) => u.displayName === s.displayName) || ac?.assumedEligibleForSimulation.includes(s.competitorId);
      out(`| ${s.rank} | ${s.displayName} | ${s.location} | ${s.assignedJobs} | ${s.closedJobs} | ${pct(s.closingRate)} | $${s.avgTicket.toFixed(2)} | ${s.qualifyingJobs} | ${s.score.toFixed(2)} | ${gates} | ${unv ? "unverified (assumed for simulation)" : s.account} | ${s.prizeCents ? `${s.prizePosition ? `#${s.prizePosition}` : "Most Improved"} ${usd(s.prizeCents)}` : "—"} |`);
    }
    out();
  }
  out(`## Safety`);
  out(`- CRM collections opened (read-only user + write-blocking proxy): ${safety.crmCollectionsOpened.join(", ") || "none"}`);
  out(`- CRM write attempts blocked in-process: ${safety.crmWriteAttemptsBlocked} (expected 0)`);
  out(`- Ledger / Payout / finance_* collections opened: ${finance.length ? finance.join(", ") : "none"}`);
  out(`- Local writes (127.0.0.1, ${dbName}): ${safety.localWrites.join(", ") || "none"}`);
  out(`- Writes outside the local arena_* collections: ${badLocal.length ? badLocal.join(", ") : "none"}`);
  out(`- Verdict: ${safety.ok ? "**OK** — nothing was written outside the local Arena database" : "**FAILED**"}`);
  out();
  out(`## History integrity: ${integrityVerdict}`);
  out(`Every approved record (and the snapshot it approved) recomputed under its original rule version with today's engine: ${integrity.identical} identical, ${integrity.mismatched} mismatched. Other frozen snapshots are informational (taken before later review decisions).`);
  for (const l of integrity.lines) out(`- ${l.verdict} ${l.label} ${l.detail}`);
  out();
  out(`> **${SIMULATION_BANNER}**`);

  writePrivate(outDir, "report.md", md.join("\n") + "\n");
  writePrivate(outDir, "data.json", JSON.stringify(data, null, 1));
  console.log(`[SIMULATION] ${args.week}: ${outcome}${refusedReason ? ` — ${refusedReason}` : ""}; safety ${safety.ok ? "OK" : "FAILED"}; integrity ${integrityVerdict} (${integrity.identical} identical, ${integrity.mismatched} mismatched) → ${outDir}`);
  await local.close().catch(() => {});
  await crm.close().catch(() => {});
  return exitCode;
});
