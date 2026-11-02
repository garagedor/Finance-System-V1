/**
 * Shadow validation of ONE week against the real CRM, read-only.
 *
 *   node --env-file=<file> --import ./scripts/arena/transpile-register.mjs \
 *     scripts/arena/shadow-week.ts <weekStart> <outDir> --template <id> [--snapshot] [--no-balance-report]
 *       [--decisions <file>] [--strict]
 *
 * Decisions (read-only here): <outDir>/decisions.json when present (or --decisions).
 * The standings are then shown WITH the owner's decisions applied in memory
 * (nothing is recorded; shadow-approve records them), and every review case is
 * classified decided / pending / UNDECIDED. A CRM name that is neither mapped
 * nor on the exclusion list is a STOP condition, as is any CRM parity mismatch.
 * --strict: exit 2 when a STOP condition holds (the reports are still written).
 * --day-label YYYY-MM-DD: REHEARSAL ONLY (synthetic data) — the ET day this run stands for;
 *   recorded next to the real run time and shown as "simulated day" in the weekly reconciliation.
 *
 * CRM: through lib-ro-guard (server-proven read-only user + in-process write
 * proxy). Arena state (review decisions, templates, shadow snapshots) lives in a
 * LOCAL Mongo only: ARENA_SHADOW_LOCAL_URI (default mongodb://127.0.0.1:27031),
 * database ARENA_SHADOW_DB (default arena_shadow). Nothing is written to the CRM
 * and nothing is sent anywhere (the account verifier is NOT called: every
 * account is "unverified", which never moves a prize).
 *
 * Output: <outDir>/<weekStart>/report.md (owner-readable) + data.json (the latest
 * run) and a copy of every run in <outDir>/<weekStart>/runs/<time>/, mode 600,
 * directory mode 700. <outDir> must be outside the repository (it contains names).
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { assertLocalMongoUri, GuardRefusal, openGuardedCrm, runGuarded } from "./lib-ro-guard.ts";
import { cloneRules, rulesHash } from "../../src/lib/arena/config.ts";
import { computeCompetition, officialKpis } from "../../src/lib/arena/engine.ts";
import { buildCompetitorMap, rosterNames } from "../../src/lib/arena/identity.ts";
import { loadJobs, toArenaJob } from "../../src/lib/arena/job-source.ts";
import { detectCases } from "../../src/lib/arena/detect.ts";
import { reviewDecisions, type ReviewCaseDoc } from "../../src/lib/arena/review.ts";
import { canonicalJson } from "../../src/lib/arena/config.ts";
import { archiveRun, asCaseDocs, planDecisions, projectDecisions, readDecisionsFile, resolveShadowRules, runStamp, type DecisionPlan, type ShadowDecisions } from "./lib-shadow.ts";
import { ARENA_COLLECTIONS, arenaStores, loadMappings, loadTechnicians } from "../../src/lib/arena/mongo-store.ts";
import { addDays, isMonday, previousWeekStarts, weekWindow } from "../../src/lib/arena/week.ts";
import type { ArenaJob, ArenaRules, CompetitionResult } from "../../src/lib/arena/types.ts";
import type { DisplayNameCaseData, DuplicateCaseData, IdentityCaseData } from "../../src/lib/arena/review.ts";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const SNAPSHOTS = "shadow_snapshot";
const MATERIAL_MONEY = 0.005;
const MATERIAL_RATE = 0.00005;

function parseArgs(argv: string[]) {
  const pos: string[] = [];
  const o = { snapshot: false, noBalanceReport: false, template: null as string | null, decisions: null as string | null, strict: false, dayLabel: null as string | null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--snapshot") o.snapshot = true;
    else if (a === "--no-balance-report") o.noBalanceReport = true;
    else if (a === "--template") o.template = argv[++i] ?? null;
    else if (a === "--decisions") o.decisions = argv[++i] ? path.resolve(argv[i]) : null;
    else if (a === "--strict") o.strict = true;
    else if (a === "--day-label") { o.dayLabel = argv[++i] ?? null; if (!o.dayLabel || !/^\d{4}-\d{2}-\d{2}$/.test(o.dayLabel)) throw new Error("--day-label takes YYYY-MM-DD"); }
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else pos.push(a);
  }
  const [week, outDir] = pos;
  if (!week || !outDir) throw new Error("usage: shadow-week.ts <weekStart> <outDir> --template <id> [--snapshot] [--no-balance-report] [--decisions <file>] [--strict]");
  if (!isMonday(week)) throw new Error("weekStart must be a Monday (YYYY-MM-DD)");
  const out = path.resolve(outDir);
  if (out === REPO || out.startsWith(REPO + path.sep)) throw new Error("outDir must be outside the repository (the report contains technician names)");
  return { week, out, ...o };
}

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const usd = (x: number) => `$${x.toFixed(2)}`;
const cents = (c: number) => `$${(c / 100).toFixed(0)}`;
const sha = (x: unknown) => createHash("sha256").update(canonicalJson(x)).digest("hex");

/**
 * CRM code paths (Home Leaderboard, Balance Report) name the database "ag" in
 * code. When ARENA_CRM_DB names another database (a local rehearsal copy),
 * send those reads to the same database the Arena reads, so parity compares
 * like with like. With the default ("ag") this is the identity.
 */
function sameCrmDb<T extends object>(client: T, crmDb: string): T {
  if (crmDb === "ag") return client;
  return new Proxy(client, {
    get(t, p, r) {
      const v = Reflect.get(t, p, r);
      if (p === "db" && typeof v === "function") return (n?: string, ...a: unknown[]) => (v as (n?: string, ...a: unknown[]) => Db).call(t, n === "ag" || n === undefined ? crmDb : n, ...a);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}

const lim = (m: string | null) => (m === "closingRate" ? "CR" : m === "avgTicket" ? "AVG" : m === "both" ? "both" : "—");

await runGuarded(async () => {
  const args = parseArgs(process.argv.slice(2));
  const localUri = process.env.ARENA_SHADOW_LOCAL_URI || "mongodb://127.0.0.1:27031";
  assertLocalMongoUri(localUri);
  const localDbName = process.env.ARENA_SHADOW_DB || "arena_shadow";
  if (!/^arena_/.test(localDbName)) throw new GuardRefusal("ARENA_SHADOW_DB must be an arena_* database");

  // 1) CRM read-only, proven before any read
  const crm = await openGuardedCrm();
  const verdict = crm.verdict;
  // CRM code paths (Home Leaderboard, Balance Report) use the shared client: give them the guarded one.
  (globalThis as { __lbsMongo?: unknown }).__lbsMongo = { client: sameCrmDb(crm.client, crm.db.databaseName), promise: null, connectedAt: Date.now(), lastError: null };
  const local = new MongoClient(localUri, { serverSelectionTimeoutMS: 5_000 });
  await local.connect();
  const arena = local.db(localDbName);
  if (arena.databaseName === crm.db.databaseName) throw new GuardRefusal("the local Arena database must not be the CRM database");

  try {
    // 2) rules: named explicitly with --template (a code seed or a local template); no default
    const { rules, label: rulesLabel } = await resolveShadowRules(args.template,
      (id) => arena.collection(ARENA_COLLECTIONS.templates).findOne({ templateId: id, current: true }), localDbName);
    const v1 = cloneRules(rules);
    v1.scoring.methodology = "BALANCED_PERFORMANCE_V1";
    const v0 = cloneRules(rules);
    delete (v0.scoring as { methodology?: string }).methodology;

    // 3) data (read-only)
    const week = args.week;
    const end = addDays(week, 7);
    const baseline = rules.mostImproved.enabled ? previousWeekStarts(week, rules.mostImproved.baselineWeeks) : [];
    const from = baseline.length ? baseline[baseline.length - 1] : week;
    const [jobs, mappings, technicians] = await Promise.all([loadJobs(crm.db, from, end), loadMappings(crm.db), loadTechnicians(crm.db)]);
    const weekJobs = jobs.filter((j) => j.date >= week && j.date < end);
    const inForce = await reviewDecisions({ store: arenaStores(arena).review } as never);

    // 3b) review queue for this week (same detector as the Control Center) and the owner's decisions file
    const cases = detectCases({
      weeks: [{ weekStart: week, jobs: weekJobs }], mappings, technicians, rules: v1,
      overrides: inForce.overrides, displayNames: inForce.displayNames, exclusions: inForce.exclusions,
    });
    const decisionsFile = args.decisions ?? (fs.existsSync(path.join(args.out, "decisions.json")) ? path.join(args.out, "decisions.json") : null);
    let fileDecisions: ShadowDecisions | null = null;
    let plan: DecisionPlan | null = null;
    let decisionsNote = "no decisions file (standings use only the decisions recorded in the local database; unknown CRM names cannot be checked)";
    let decisions = inForce;
    if (decisionsFile) {
      const r = readDecisionsFile(decisionsFile);
      if (!r.decisions) throw new Error(`decisions file ${decisionsFile}: ${r.problems.join("; ")}`);
      fileDecisions = r.decisions;
      const recorded = (await arena.collection(ARENA_COLLECTIONS.reviewCases).find({}).toArray()) as unknown as ReviewCaseDoc[];
      const caseDocs = asCaseDocs(cases, recorded);
      plan = planDecisions(caseDocs, fileDecisions);
      decisions = projectDecisions(inForce, caseDocs, plan);
      decisionsNote = `${decisionsFile} applied in memory (${plan.apply.length} to apply at review, ${plan.alreadyInForce.length} already in force, ${plan.conflicts.length} conflicts)`;
    }
    const competitors = buildCompetitorMap({
      mappings, technicians, crmNamesInUse: [...new Set(jobs.map((j) => j.tech))], overrides: decisions.overrides, displayNames: decisions.displayNames,
    });
    const run = (r: ArenaRules): CompetitionResult =>
      computeCompetition({
        rules: r, rulesHash: rulesHash(r), weekStart: week, competitors, jobs,
        exclusions: decisions.exclusions, dismissedDuplicateGroups: decisions.dismissedDuplicateGroups, accounts: {},
      });
    const a = run(v1), b = run(v0);

    // 4) display-name flags
    const roster = rosterNames(mappings, technicians, decisions.displayNames);
    const inWeek = new Set(a.results.map((r) => r.competitorId));
    const nameFlags = [...roster.values()].filter((r) => inWeek.has(r.id) && (r.collision || r.needsEnglish || r.possibleDuplicateOf.length));

    // 5) CRM parity: Home Leaderboard always; Balance Report when `User` is readable (or not disabled)
    const balanceReport = !args.noBalanceReport && verdict.canFind("User");
    const balanceNote = args.noBalanceReport
      ? "skipped (--no-balance-report)"
      : balanceReport ? "included" : "skipped: the read-only user has no find on `User` (the Balance Report reads it)";
    const { GET: homeStats } = await import("../../src/app/api/home-stats/route.ts");
    const computeBalanceReport = balanceReport ? (await import("../../src/app/api/balance-report/route.ts")).computeBalanceReport : null;
    const sunday = addDays(week, 6);
    const hsRes = await homeStats(new Request(`http://local/api/home-stats?startDate=${week}&endDate=${sunday}`) as never);
    const hs = (await hsRes.json()) as { techStats?: { tech: string; avgTicket: number; closedPct: number; count: number }[] };
    // A CRM code path that fails (e.g. a collection the read-only user cannot read) must
    // not look like "the CRM says 0": stop with a clear message instead.
    if (hsRes.status !== 200 || !Array.isArray(hs.techStats))
      throw new Error(`the Home Leaderboard code path failed (HTTP ${hsRes.status}); the read-only user probably lacks find on a collection it reads (see the log above: Job, Location, Provider)`);
    const hsByTech = new Map(hs.techStats.map((t) => [t.tech, t]));
    const byName = new Map<string, ArenaJob[]>();
    for (const j of weekJobs) (byName.get(j.tech) ?? byName.set(j.tech, []).get(j.tech)!).push(j);
    const parity: { tech: string; source: string; field: string; arena: number; crm: number }[] = [];
    let comparisons = 0;
    for (const [tech, tj] of [...byName.entries()].sort()) {
      const k = officialKpis(tj);
      const h = hsByTech.get(tech);
      const checks: [string, string, number, number, number][] = [
        ["Home Leaderboard", "assigned jobs", k.assigned, h?.count ?? 0, 0],
        ["Home Leaderboard", "AVG TICKET", k.avgTicket, h?.avgTicket ?? 0, MATERIAL_MONEY],
        ["Home Leaderboard", "Closing Rate", k.closingRate, (h?.closedPct ?? 0) / 100, MATERIAL_RATE],
      ];
      if (computeBalanceReport) {
        let br: Awaited<ReturnType<typeof computeBalanceReport>>;
        try {
          br = await computeBalanceReport({ startDateStr: week, endDateStr: sunday, techFilter: tech, mode: "tech" });
        } catch (e) {
          throw new Error(`the Balance Report code path failed (${(e as { codeName?: string }).codeName ?? "error"}); grant find on the collections it reads (Job, Technician, Location, User) or pass --no-balance-report`);
        }
        const closed = (br.statusStats as { key: string; count: number }[]).find((s) => s.key === "Closed")?.count ?? 0;
        checks.push(
          ["Balance Report", "assigned jobs", k.assigned, br.totals.assigned, 0],
          ["Balance Report", "AVG TICKET", k.avgTicket, br.totals.avgTicket, MATERIAL_MONEY],
          ["Balance Report", "Closing Rate", k.closingRate, br.totals.assigned ? closed / br.totals.assigned : 0, MATERIAL_RATE],
        );
      }
      for (const [source, field, av, cv, tol] of checks) {
        comparisons++;
        if (Math.abs(av - cv) > tol) parity.push({ tech, source, field, arena: av, crm: cv });
      }
    }
    for (const t of hsByTech.keys()) if (!byName.has(t)) parity.push({ tech: t, source: "Home Leaderboard", field: "present only in CRM", arena: 0, crm: hsByTech.get(t)!.count });

    // 5b) STOP conditions for the daily check, and run hashes (rerun = same input → same result)
    const stops: string[] = [];
    if (parity.length) stops.push(`CRM parity: ${parity.length} mismatch(es) between the Arena and the CRM`);
    if (plan?.undecided.names.length) stops.push(`CRM name(s) neither mapped nor on the exclusion list: ${plan.undecided.names.join("; ")}`);
    if (plan?.conflicts.length) stops.push(`decisions file conflicts with the local database: ${plan.conflicts.join("; ")}`);
    if (!decisionsFile && args.strict) stops.push("no decisions file: unknown CRM names cannot be checked");
    const sortedJobs = [...weekJobs].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    const hashes = {
      jobs: sha(sortedJobs),
      input: sha({ jobs: [...jobs].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)), mappings, technicians, decisions, rules: rulesHash(v1) }),
      result: sha({ v1: a, v0: b }),
    };
    const ww = weekWindow(week, v1.timezone, v1.review);

    // 6) optional timestamped snapshot + diff vs the previous one (local Arena db only)
    const at = new Date().toISOString();
    const jobRows = weekJobs.map((j) => ({ id: j.id, tech: j.tech, date: j.date, status: j.status, profit: j.profit, location: j.location }));
    const standings = a.results.map((r) => ({ competitorId: r.competitorId, displayName: r.displayName, rank: r.rank, score: r.score, eligible: r.eligible, prizeCents: r.prizeCents }));
    let diff: null | {
      previousAt: string; added: typeof jobRows; removed: { id: string; tech: string; was: string; now: string }[];
      changed: { id: string; tech: string; changes: string[] }[]; standings: { name: string; change: string }[];
    } = null;
    if (args.snapshot) {
      const snaps = arena.collection<{ _id: string; week: string; at: string; jobs: typeof jobRows; standings: typeof standings }>(SNAPSHOTS);
      const prev = await snaps.find({ week }).sort({ at: -1 }).limit(1).next();
      if (prev) {
        const before = new Map(prev.jobs.map((j) => [j.id, j]));
        const now = new Map(jobRows.map((j) => [j.id, j]));
        const added = jobRows.filter((j) => !before.has(j.id));
        const gone = prev.jobs.filter((j) => !now.has(j.id));
        // Where did they go? Look each one up by id (read-only).
        const ids = gone.map((j) => (/^[0-9a-f]{24}$/.test(j.id) ? new ObjectId(j.id) : j.id));
        const found = ids.length ? await crm.db.collection("Job").find({ _id: { $in: ids as never[] } }).toArray() : [];
        const foundById = new Map(found.map((d) => [String(d._id), toArenaJob(d as Record<string, unknown>)]));
        const removed = gone.map((j) => {
          const x = foundById.get(j.id);
          const nowWhere = !foundById.has(j.id) ? "deleted from the CRM" : !x ? "no valid date now" : !x.tech ? "unassigned now" : `moved to ${x.date} (${x.tech})`;
          return { id: j.id, tech: j.tech, was: j.date, now: nowWhere };
        });
        const changed: { id: string; tech: string; changes: string[] }[] = [];
        for (const j of jobRows) {
          const p = before.get(j.id);
          if (!p) continue;
          const c: string[] = [];
          for (const f of ["tech", "date", "status", "location"] as const) if (p[f] !== j[f]) c.push(`${f} ${p[f]} → ${j[f]}`);
          if (Math.abs(p.profit - j.profit) > MATERIAL_MONEY) c.push(`profit ${usd(p.profit)} → ${usd(j.profit)}`);
          if (c.length) changed.push({ id: j.id, tech: j.tech, changes: c });
        }
        const pb = new Map(prev.standings.map((s) => [s.competitorId, s]));
        const st: { name: string; change: string }[] = [];
        for (const s of standings) {
          const p = pb.get(s.competitorId);
          if (!p) st.push({ name: s.displayName, change: "new in the standings" });
          else if (p.rank !== s.rank || p.prizeCents !== s.prizeCents || p.eligible !== s.eligible)
            st.push({ name: s.displayName, change: `rank ${p.rank} → ${s.rank}${p.prizeCents !== s.prizeCents ? `, prize ${cents(p.prizeCents)} → ${cents(s.prizeCents)}` : ""}${p.eligible !== s.eligible ? `, ${s.eligible ? "now qualified" : "no longer qualified"}` : ""}` });
        }
        for (const p of prev.standings) if (!standings.some((s) => s.competitorId === p.competitorId)) st.push({ name: p.displayName, change: "left the standings" });
        diff = { previousAt: prev.at, added, removed, changed, standings: st };
      }
      await snaps.insertOne({ _id: `${week}@${at}`, week, at, jobs: jobRows, standings });
    }

    // 7) report
    const md: string[] = [];
    const out = (s = "") => md.push(s);
    out(`# 317 LIVE ARENA — shadow week ${week} → ${sunday}`);
    out(`Generated ${at} · CRM read-only as ${verdict.users.join(", ")} (find on ${verdict.findOn.join(", ")}) · rules: ${rulesLabel}, hash ${rulesHash(v1).slice(0, 12)}`);
    out();
    out(`Shadow mode: nothing was written to the CRM, nothing was sent anywhere. Weekly Balance accounts were NOT checked (every account "unverified", which never moves a prize), so these are performance results, not approved winners.`);
    out();
    out(stops.length ? `**STOP — ${stops.length} condition(s); escalate before continuing:**` : `**Daily check: no STOP condition.**`);
    for (const x of stops) out(`- STOP: ${x}`);
    if (args.dayLabel) out(`REHEARSAL: this run stands for ET day ${args.dayLabel} (real run time ${at}).`);
    out(`Decisions: ${decisionsNote}. Week ${new Date(at) >= ww.closesAt ? "ENDED (this run is after Sunday 23:59:59 ET)" : "still running"} · input ${hashes.input.slice(0, 12)}… · result ${hashes.result.slice(0, 12)}…`);
    out();
    out(`## 1. Standings — Balanced Performance (V1, primary)${plan ? " · with the decisions file applied" : ""}`);
    out(`Gates: ${v1.eligibility.minQualifyingJobs} qualifying jobs · AVG ≥ ${cents(v1.eligibility.minAvgTicketCents)} · CR ≥ ${v1.eligibility.minClosingRateBp / 100}%. Qualified: ${a.gateCounts.allThree} of ${a.results.length}. Paid ${cents(a.awardedCents)} of ${cents(v1.prizes.budgetCents)}.`);
    out();
    out(`| Rank | Technician | Location | Assigned | Closed | Closing Rate | AVG TICKET | Qualifying | C | A | Score | Limiting | Gates | Prize |`);
    out(`|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
    for (const r of a.results)
      out(`| ${r.rank} | ${r.displayName} | ${r.location} | ${r.assignedJobs} | ${r.closedJobs} | ${pct(r.closingRate)} | ${usd(r.avgTicket)} | ${r.qualifyingJobs} | ${r.closingScore.toFixed(2)} | ${r.avgScore.toFixed(2)} | ${r.score.toFixed(2)} | ${lim(r.limitingMetric)} | ${[r.gates.jobs.met ? "" : "jobs", r.gates.avgTicket.met ? "" : "AVG", r.gates.closingRate.met ? "" : "CR"].filter(Boolean).join("+") || "all met"} | ${r.prizeCents ? `${r.prizePosition ? `#${r.prizePosition}` : "Most Improved"} ${cents(r.prizeCents)}` : "—"} |`);
    out();
    out(`## 2. Comparison — Weighted (V0), same rules otherwise`);
    out(`| Technician | V1 rank | V1 prize | V0 rank | V0 score | V0 prize |`);
    out(`|---|---|---|---|---|---|`);
    for (const r of a.results) {
      const o = b.results.find((x) => x.competitorId === r.competitorId)!;
      out(`| ${r.displayName} | ${r.rank} | ${r.prizeCents ? cents(r.prizeCents) : "—"} | ${o.rank} | ${o.score.toFixed(2)} | ${o.prizeCents ? cents(o.prizeCents) : "—"} |`);
    }
    out(`\nV1 paid ${cents(a.awardedCents)} · V0 paid ${cents(b.awardedCents)}.`);
    out();
    out(`## 3. Review queue (this week; decisions from the local ${localDbName} database)`);
    const dup = cases.filter((c) => c.kind === "duplicate_group");
    const idc = cases.filter((c) => c.kind === "identity_name");
    const dn = cases.filter((c) => c.kind === "display_name");
    out(`- Suspected duplicate groups: ${dup.length} (could change prizes: ${dup.filter((c) => (c.data as DuplicateCaseData).mayAffectPrizes).length})`);
    for (const c of dup) { const d = c.data as DuplicateCaseData; out(`  - ${d.competitorName} · ${d.date} · ${d.jobs.length} jobs${d.likely ? " · likely" : ""}${d.mayAffectPrizes ? " · could change prizes" : ""}`); }
    out(`- CRM names without a verified person: ${idc.length}`);
    for (const c of idc) { const d = c.data as IdentityCaseData; out(`  - “${d.crmName}” — ${d.issue}, ${d.jobs} job(s)${d.locations.length ? ` at ${d.locations.join(", ")}` : ""}`); }
    out(`- Display names needing a decision: ${dn.length}`);
    for (const c of dn) { const d = c.data as DisplayNameCaseData; out(`  - ${d.currentName} (${d.reason === "name_collision" ? "identical to another technician's name" : "needs English display name"})`); }
    out(`- Display-name flags among this week's competitors: ${nameFlags.length}`);
    for (const r of nameFlags)
      out(`  - ${r.fullName} → **${r.displayName}**${r.collision ? ` · collision (${r.collision})` : ""}${r.needsEnglish ? " · needs English display name" : ""}${r.possibleDuplicateOf.length ? ` · possible duplicate account — confirm (${r.possibleDuplicateOf.map((id) => roster.get(id)?.fullName ?? id).join(", ")})` : ""}`);
    out(`- Unattributed jobs (pools, subcontractors, unmapped): ${a.unattributed.reduce((s, u) => s + u.jobs, 0)}`);
    if (plan) {
      out(`- Against the decisions file: ${plan.apply.length} to apply at review · ${plan.alreadyInForce.length} in force · pending ${plan.pending.names.length} name(s) / ${plan.pending.duplicates.length} duplicate(s) · **UNDECIDED ${plan.undecided.names.length} name(s), ${plan.undecided.duplicates.length} duplicate group(s), ${plan.undecided.displayNames.length} display name(s)**`);
      for (const x of plan.apply) out(`  - will apply: ${x.label}`);
      for (const x of plan.pending.names) out(`  - pending identification (not credited, cannot win): ${x}`);
      for (const x of plan.pending.duplicates) out(`  - pending office confirmation (blocks this week's approval): ${x}`);
      for (const x of plan.undecided.names) out(`  - **UNDECIDED name (STOP):** ${x}`);
      for (const x of plan.undecided.duplicates) out(`  - **UNDECIDED duplicate (blocks approval):** ${x}`);
      for (const x of plan.undecided.displayNames) out(`  - undecided display name: ${x}`);
    }
    out();
    out(`## 4. CRM parity`);
    out(`Home Leaderboard: included · Balance Report: ${balanceNote}. Comparisons: ${comparisons}. Tolerance $0.005 / 0.005 pp.`);
    out(parity.length ? `**Mismatches: ${parity.length}**` : `**Mismatches: 0** — the Arena equals the CRM for every technician this week.`);
    if (parity.length) {
      out(`| Tech | Source | Field | Arena | CRM |`);
      out(`|---|---|---|---|---|`);
      for (const m of parity) out(`| ${m.tech} | ${m.source} | ${m.field} | ${m.arena} | ${m.crm} |`);
    }
    out(`\nWrite attempts blocked in-process: ${crm.blocked.length}${crm.blocked.length ? ` (${[...new Set(crm.blocked)].join(", ")}) — CRM heal-on-read; nothing was written` : ""}.`);
    out();
    if (args.snapshot) {
      out(`## 5. Snapshot`);
      out(`Stored ${week}@${at} in the local ${localDbName}.${SNAPSHOTS}.`);
      if (!diff) out(`First snapshot of this week: nothing to compare yet.`);
      else {
        out(`Compared with ${diff.previousAt}: ${diff.added.length} job(s) added, ${diff.removed.length} removed, ${diff.changed.length} edited; ${diff.standings.length} standing change(s).`);
        for (const j of diff.added) out(`- added ${j.id} · ${j.tech} · ${j.date} · ${j.status}`);
        for (const j of diff.removed) out(`- removed ${j.id} · ${j.tech} · was ${j.was} · ${j.now}`);
        for (const j of diff.changed) out(`- edited ${j.id} · ${j.tech} · ${j.changes.join("; ")}`);
        for (const s of diff.standings) out(`- ${s.name}: ${s.change}`);
      }
    }

    const dir = path.join(args.out, week);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    const write = (f: string, s: string) => {
      const p = path.join(dir, f);
      fs.writeFileSync(p, s, { mode: 0o600 });
      fs.chmodSync(p, 0o600);
    };
    const files = {
      "report.md": md.join("\n") + "\n",
      "data.json": JSON.stringify({
        week, generatedAt: at, crmUser: verdict.users, findOn: verdict.findOn, rules: { label: rulesLabel, hash: rulesHash(v1) },
        v1: a, v0: b, cases, displayNameFlags: nameFlags, parity: { comparisons, mismatches: parity, balanceReport: balanceNote },
        blockedWrites: crm.blocked, snapshot: args.snapshot ? { id: `${week}@${at}`, diff } : null,
        guard: { ok: verdict.ok, users: verdict.users, roles: verdict.roles },
        decisions: { file: decisionsFile, plan }, stops, hashes, weekEnded: new Date(at) >= ww.closesAt, dayLabel: args.dayLabel,
      }, null, 1),
    };
    for (const [f, c] of Object.entries(files)) write(f, c);
    archiveRun(dir, runStamp(at), files);
    console.log(`shadow ${week}: ${a.results.length} competitors, ${a.gateCounts.allThree} qualified, parity ${comparisons} comparisons / ${parity.length} mismatches, ${cases.length} review cases, ${stops.length ? `STOP ×${stops.length}` : "no STOP"} → ${dir}`);
    return args.strict && stops.length ? 2 : 0;
  } finally {
    await local.close().catch(() => {});
    await crm.close().catch(() => {});
  }
});
