/**
 * Phase 1 acceptance gate — CRM parity + historical validation. READ-ONLY.
 *
 *   node --env-file=<path to .env.local> --import ./scripts/test-register.mjs \
 *     scripts/arena/validate-history.ts <firstMonday> <weeks> <out.md>
 *
 * For every week and every CRM technician name, compares the Arena's official
 * Closing Rate / AVG TICKET with the CRM's own code paths, called in-process:
 *   - Balance Report  : computeBalanceReport() (src/app/api/balance-report/route.ts)
 *   - Home Leaderboard: GET /api/home-stats techStats (src/app/api/home-stats/route.ts)
 * then runs the full engine on the seed template to report eligibility and the
 * prizes each week would have produced.
 *
 * The shared Mongo client is replaced by a proxy that throws on every write
 * method, so neither this script nor the CRM code it calls (e.g. the
 * heal-on-read in home-stats) can modify production data. The output contains
 * technician names — write it OUTSIDE the repository.
 */
import { writeFileSync } from "node:fs";
import { MongoClient, type Db } from "mongodb";
import { SEED_STANDARD_WEEK, cloneRules, rulesHash } from "../../src/lib/arena/config.ts";
import { computeCompetition, officialKpis } from "../../src/lib/arena/engine.ts";
import { buildCompetitorMap, type MappingRecord, type TechnicianRecord } from "../../src/lib/arena/identity.ts";
import { loadJobs } from "../../src/lib/arena/job-source.ts";
import { addDays, previousWeekStarts } from "../../src/lib/arena/week.ts";
import type { ArenaJob } from "../../src/lib/arena/types.ts";

const [firstMonday = "2026-08-31", weeksArg = "8", outPath] = process.argv.slice(2);
if (!outPath) throw new Error("usage: validate-history.ts <firstMonday> <weeks> <out.md>");
const WEEKS = Array.from({ length: Number(weeksArg) }, (_, i) => addDays(firstMonday, 7 * i));

// ── read-only client ────────────────────────────────────────────────────────
const WRITE = /^(insert|update|replace|delete|bulkWrite|findOneAnd|createIndex|drop|rename|createCollection)/;
const blocked: string[] = [];
function readOnly<T extends object>(target: T, label: string): T {
  return new Proxy(target, {
    get(t, p, r) {
      const v = Reflect.get(t, p, r);
      if (typeof p === "string" && WRITE.test(p)) {
        return () => {
          blocked.push(`${label}.${p}`);
          throw new Error(`READ-ONLY: ${label}.${p} blocked`);
        };
      }
      if (p === "aggregate" && typeof v === "function") {
        return (pipeline: unknown[], ...rest: unknown[]) => {
          if (JSON.stringify(pipeline).match(/"\$(out|merge)"/)) {
            blocked.push(`${label}.aggregate($out/$merge)`);
            throw new Error("READ-ONLY: $out/$merge blocked");
          }
          return v.call(t, pipeline, ...rest);
        };
      }
      if (p === "collection" && typeof v === "function") return (n: string, ...a: unknown[]) => readOnly(v.call(t, n, ...a), n);
      if (p === "db" && typeof v === "function") return (n?: string, ...a: unknown[]) => readOnly(v.call(t, n, ...a), `db:${n}`);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}
const raw = new MongoClient(process.env.MONGODB_URI!, { readPreference: "secondaryPreferred" });
await raw.connect();
const client = readOnly(raw, "client");
(globalThis as { __lbsMongo?: unknown }).__lbsMongo = { client, promise: null, connectedAt: Date.now(), lastError: null };

// CRM modules are imported only after the read-only client is installed.
const { computeBalanceReport } = await import("../../src/app/api/balance-report/route.ts");
const { GET: homeStats } = await import("../../src/app/api/home-stats/route.ts");

const db: Db = client.db("ag");
const mappings = (await db.collection("TechNameMapping").find({}).toArray()) as unknown as MappingRecord[];
const technicians = (await db.collection("Technician").find({}).toArray()) as unknown as TechnicianRecord[];

const baselineSpan = SEED_STANDARD_WEEK.mostImproved.baselineWeeks;
const allJobs = await loadJobs(db, previousWeekStarts(WEEKS[0], baselineSpan).at(-1)!, addDays(WEEKS.at(-1)!, 7));
const jobsIn = (w: string) => allJobs.filter((j) => j.date >= w && j.date < addDays(w, 7));

type Mismatch = { week: string; tech: string; source: string; field: string; arena: number; crm: number; note: string };
const mismatches: Mismatch[] = [];
const MATERIAL_MONEY = 0.005; // half a cent
const MATERIAL_RATE = 0.00005; // 0.005 percentage points
let comparisons = 0;
const maxDiff: Record<string, number> = {};

const md: string[] = [];
const out = (s = "") => md.push(s);
out(`# 317 LIVE ARENA — Phase 1 historical validation`);
out(`Generated ${new Date().toISOString()} · weeks ${WEEKS[0]} → ${addDays(WEEKS.at(-1)!, 6)} · rules: seed "Standard Week" (hash ${rulesHash(SEED_STANDARD_WEEK).slice(0, 12)})`);
out();

const weekly: string[] = [];
const winnersMd: string[] = [];
for (const w of WEEKS) {
  const sunday = addDays(w, 6);
  const wJobs = jobsIn(w);
  const byName = new Map<string, ArenaJob[]>();
  for (const j of wJobs) (byName.get(j.tech) ?? byName.set(j.tech, []).get(j.tech)!).push(j);

  // Home Leaderboard, called in-process
  const res = await homeStats(new Request(`http://local/api/home-stats?startDate=${w}&endDate=${sunday}`) as never);
  const hs = (await res.json()) as { techStats?: { tech: string; avgTicket: number; closedPct: number; count: number }[] };
  const hsByTech = new Map((hs.techStats ?? []).map((t) => [t.tech, t]));

  for (const [tech, jobs] of [...byName.entries()].sort()) {
    const a = officialKpis(jobs);
    // Balance Report
    const br = await computeBalanceReport({ startDateStr: w, endDateStr: sunday, techFilter: tech, mode: "tech" });
    const brClosed = (br.statusStats as { key: string; count: number }[]).find((s) => s.key === "Closed")?.count ?? 0;
    const brAssigned = br.totals.assigned;
    const brCr = brAssigned ? brClosed / brAssigned : 0;
    const h = hsByTech.get(tech);
    const checks: [string, string, number, number, number][] = [
      ["Balance Report", "assigned jobs", a.assigned, brAssigned, 0],
      ["Balance Report", "AVG TICKET", a.avgTicket, br.totals.avgTicket, MATERIAL_MONEY],
      ["Balance Report", "Closing Rate", a.closingRate, brCr, MATERIAL_RATE],
      ["Home Leaderboard", "assigned jobs", a.assigned, h?.count ?? 0, 0],
      ["Home Leaderboard", "AVG TICKET", a.avgTicket, h?.avgTicket ?? 0, MATERIAL_MONEY],
      ["Home Leaderboard", "Closing Rate", a.closingRate, (h?.closedPct ?? 0) / 100, MATERIAL_RATE],
    ];
    for (const [source, field, av, cv, tol] of checks) {
      comparisons += 1;
      const k = `${source} ${field}`;
      maxDiff[k] = Math.max(maxDiff[k] ?? 0, Math.abs(av - cv));
      if (Math.abs(av - cv) > tol) mismatches.push({ week: w, tech, source, field, arena: av, crm: cv, note: "" });
    }
  }
  for (const t of hsByTech.keys()) {
    if (!byName.has(t)) mismatches.push({ week: w, tech: t, source: "Home Leaderboard", field: "present", arena: 0, crm: hsByTech.get(t)!.count, note: "tech only in CRM" });
  }

  // Full engine, production identity, seed rules
  const rules = cloneRules(SEED_STANDARD_WEEK);
  const names = [...new Set(allJobs.map((j) => j.tech))];
  const competitors = buildCompetitorMap({ mappings, technicians, crmNamesInUse: names });
  const window = allJobs.filter((j) => j.date >= previousWeekStarts(w, baselineSpan).at(-1)! && j.date < addDays(w, 7));
  const r = computeCompetition({ rules, rulesHash: rulesHash(rules), weekStart: w, competitors, jobs: window, accounts: {} }); // performance only (accounts unverified never move a prize)
  const blockingDupes = r.duplicateGroups.filter((g) => g.mayAffectPrizes).length;
  weekly.push(
    `| ${w} | ${r.results.length} | ${r.gateCounts.jobs} | ${r.gateCounts.avgTicket} | ${r.gateCounts.closingRate} | **${r.gateCounts.allThree}** | $${(r.awardedCents / 100).toFixed(0)} | $${(r.unallocatedCents / 100).toFixed(0)} | ${r.duplicateGroups.length} (${blockingDupes}) | ${r.unattributed.reduce((s, u) => s + u.jobs, 0)} |`,
  );
  winnersMd.push(`### Week of ${w}`);
  winnersMd.push(`| Prize | Technician | Location | Score | Closing Rate | AVG TICKET | Qualifying / assigned |`);
  winnersMd.push(`|---|---|---|---|---|---|---|`);
  for (const x of r.results.filter((x) => x.prizeCents > 0).sort((a, b) => (a.prizePosition ?? 99) - (b.prizePosition ?? 99))) {
    const label = x.prizePosition ? `#${x.prizePosition} $${x.prizeCents / 100}` : `Most Improved $${x.prizeCents / 100} (+${x.mostImproved!.improvement.toFixed(2)} vs ${x.mostImproved!.baselineScore.toFixed(2)})`;
    winnersMd.push(`| ${label} | ${x.displayName} | ${x.location} | ${x.score.toFixed(2)} | ${(x.closingRate * 100).toFixed(2)}% | $${x.avgTicket.toFixed(2)} | ${x.qualifyingJobs} / ${x.assignedJobs} |`);
  }
  if (!r.mostImprovedWinner && rules.mostImproved.enabled) winnersMd.push(`| Most Improved | — unawarded (no eligible non-winner with a valid improving baseline) | | | | | |`);
  const outranked = r.results.filter((x) => !x.eligible && x.rank < Math.max(...r.results.filter((y) => y.prizePosition).map((y) => y.rank), 0));
  winnersMd.push(`\nIneligible technicians scoring above the last prize position (correctly kept out): ${outranked.length}${outranked.length ? " — " + outranked.map((x) => `${x.displayName} (missing ${[!x.gates.jobs.met && "jobs", !x.gates.avgTicket.met && "AVG", !x.gates.closingRate.met && "CR"].filter(Boolean).join("+")})`).join(", ") : ""}`);
  winnersMd.push("");
}

// Identity review
const competitors = buildCompetitorMap({ mappings, technicians, crmNamesInUse: [...new Set(allJobs.map((j) => j.tech))] });
const merged = competitors.competitors.filter((c) => c.crmNames.length > 1);

out(`## 1. CRM parity gate`);
out(`Comparisons: **${comparisons}** (every CRM technician name × week × {Balance Report, Home Leaderboard} × {assigned jobs, AVG TICKET, Closing Rate}). Material tolerance: $0.005 / 0.005 pp.`);
out();
out(mismatches.length ? `**Mismatches: ${mismatches.length}**` : `**Mismatches: 0 — the Arena equals both CRM calculations for every technician and week.**`);
if (mismatches.length) {
  out(`| Week | Tech | Source | Field | Arena | CRM | Note |`);
  out(`|---|---|---|---|---|---|---|`);
  for (const m of mismatches) out(`| ${m.week} | ${m.tech} | ${m.source} | ${m.field} | ${m.arena} | ${m.crm} | ${m.note} |`);
}
out();
out(`Largest absolute difference observed: ${Object.entries(maxDiff).map(([k, v]) => `${k} ${v.toExponential(2)}`).join(" · ")}`);
out();
out(`Write attempts blocked by the read-only client: ${blocked.length}${blocked.length ? ` (${[...new Set(blocked)].join(", ")}) — from CRM code paths (heal-on-read); nothing was written.` : ""}`);
out();
out(`## 2. Weekly qualification (seed rules: 10 jobs / $400 / 40%)`);
out(`| Week | Competitors | ≥10 qualifying | AVG ≥ $400 | CR ≥ 40% | All three | Awarded | Unallocated | Suspected dup groups (blocking) | Unattributed jobs |`);
out(`|---|---|---|---|---|---|---|---|---|---|`);
weekly.forEach((l) => out(l));
out();
out(`## 3. Proposed prize distributions`);
winnersMd.forEach((l) => out(l));
out(`## 4. Identity review`);
out(`Verified competitors: ${competitors.competitors.length}. Merged multi-name competitors: ${merged.map((c) => `${c.displayName} = ${c.crmNames.join(" + ")}`).join("; ") || "none"}.`);
out();
out(`| CRM name | Issue | Blocking |`);
out(`|---|---|---|`);
for (const i of competitors.issues) out(`| ${i.crmName} | ${i.kind}${i.candidates.length ? ` (${i.candidates.length} candidate)` : ""} | ${i.blocking ? "yes" : "no"} |`);

writeFileSync(outPath, md.join("\n") + "\n");
console.log(`comparisons=${comparisons} mismatches=${mismatches.length} blockedWrites=${blocked.length} → ${outPath}`);
await raw.close();
process.exit(0);
