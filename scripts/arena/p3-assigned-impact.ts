/**
 * LOCAL ANALYSIS ONLY — impact of the owner rule 2026-11-09 ("the job minimum
 * counts ALL assigned jobs", template balanced-p3-2026-11) on the two real weeks
 * that were already extracted to files. No database, no network.
 *
 *   node --no-warnings --import ./scripts/arena/transpile-register.mjs scripts/arena/p3-assigned-impact.ts \
 *     <week A data.json> <week B data.json> <week B jobs.json> <out.md>
 *
 * Compared: P2 (balanced-p2-2026-11, today's template: minimum = 10 QUALIFYING jobs)
 * vs P3 (balanced-p3-2026-11: same prizes, minimum = 10 ASSIGNED jobs).
 *
 * Why the stored results are enough for eligibility: under BALANCED_PERFORMANCE_V1
 * the score and the ranking (min(C, A), then max(C, A), then assigned jobs, then id)
 * never use the qualifying count, so only the job gate — and through it eligibility
 * and the prize allocation — can change. With no approved exclusions in either week
 * (asserted), the P3 job count is exactly the stored `assignedJobs`.
 * Allocation is the engine's own allocatePrizes (lib-reallocate.ts).
 *
 * Cross-checks, all asserted before anything is written:
 *   K1  re-allocating each stored result under its own rules reproduces data.json;
 *   K2  the P3 ranking order (compareRanking) equals the stored ranks;
 *   K3  week B: the engine scoring jobs.json under P2 and under P3 reproduces both
 *       derived results (ranks, scores, job counts, gates, eligibility, prizes, MI).
 * Most Improved baselines are the STORED ones (computed on the qualifying basis);
 * see the limits section. Writes <out.md> (mode 600). Reads the input files only.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { accountExcludes, allocatePrizes, compareRanking } from "../../src/lib/arena/engine.ts";
import {
  SEED_BALANCED_PERFORMANCE, SEED_BALANCED_PERFORMANCE_P2, SEED_BALANCED_PERFORMANCE_P3, cloneRules, rulesHash,
} from "../../src/lib/arena/config.ts";
import type { ArenaRules, CompetitionResult, CompetitorResult } from "../../src/lib/arena/types.ts";
import { competitorsFromStored, payouts, reallocateStored, scoreWeek, toArenaJobs, type ExtractedJob } from "./lib-reallocate.ts";

const [fileA, fileB, jobsFile, outMd] = process.argv.slice(2);
if (!outMd) throw new Error("usage: p3-assigned-impact.ts <weekA data.json> <weekB data.json> <weekB jobs.json> <out.md>");
const STORED_RULES = cloneRules(SEED_BALANCED_PERFORMANCE), P2 = cloneRules(SEED_BALANCED_PERFORMANCE_P2), P3 = cloneRules(SEED_BALANCED_PERFORMANCE_P3);
const FP = { stored: "c122c43bae974c7aa73fc960b19ca921adf646c82b89d67f9eee3fdb21c7d2b4", p2: "6ae3d1278fef64bf9e23bdc21bab865c91abae2a71c22efbd5443f7bc38a0d0c", p3: rulesHash(P3) };
assert.equal(rulesHash(STORED_RULES), FP.stored);
assert.equal(rulesHash(P2), FP.p2);
const usd = (c: number) => (c ? `$${(c / 100).toLocaleString("en-US")}` : "—");
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const checks: string[] = [];
const out: string[] = [];

const readWeek = (f: string) => { const d = JSON.parse(fs.readFileSync(f, "utf8")); return { week: d.week as string, stored: d.v1 as CompetitionResult, hash: d.rules.hash as string }; };

/** The stored result re-evaluated on another job-count basis (scores/ranks unchanged; job gate, eligibility, prizes redone). */
function rebasis(stored: CompetitionResult, rules: ArenaRules): CompetitionResult {
  const results: CompetitorResult[] = structuredClone(stored.results).sort((a, b) => a.rank - b.rank);
  const min = rules.eligibility.minQualifyingJobs;
  for (const r of results) {
    assert.equal(r.excludedFromQualifying, 0, `${r.displayName}: an approved exclusion exists; its status is unknown here`);
    // assigned basis: every assigned job counts (no exclusions); qualifying basis: the stored count.
    const counted = rules.eligibility.jobCountBasis === "assigned" ? r.assignedJobs : r.qualifyingJobs;
    r.qualifyingJobs = counted;
    r.gates = { ...r.gates, jobs: { met: counted >= min, actual: counted, required: min } };
    r.eligible = r.gates.jobs.met && r.gates.avgTicket.met && r.gates.closingRate.met;
    r.prizeEligible = r.eligible && !accountExcludes(r.account.state);
  }
  const sorted = [...results].sort(compareRanking(rules));
  assert.deepEqual(sorted.map((x) => x.competitorId), results.map((x) => x.competitorId), "K2: ranking unchanged by the job-count basis");
  const mostImprovedWinner = allocatePrizes(rules, results);
  const awardedCents = results.reduce((s, x) => s + x.prizeCents, 0);
  assert.ok(awardedCents <= rules.prizes.budgetCents);
  return {
    ...structuredClone(stored), rulesHash: rulesHash(rules), results, awardedCents, unallocatedCents: rules.prizes.budgetCents - awardedCents, mostImprovedWinner,
    eligibleCount: results.filter((x) => x.eligible).length, prizeEligibleCount: results.filter((x) => x.prizeEligible).length,
    gateCounts: { jobs: results.filter((x) => x.gates.jobs.met).length, avgTicket: results.filter((x) => x.gates.avgTicket.met).length, closingRate: results.filter((x) => x.gates.closingRate.met).length, allThree: results.filter((x) => x.eligible).length },
  };
}

const lab = (x: CompetitorResult) => (x.prizeCents ? `${usd(x.prizeCents)} ${x.wonMostImproved ? "(MI)" : `(#${x.prizePosition})`}` : "—");
const missing = (x: CompetitorResult) => [x.gates.jobs.met ? "" : "jobs", x.gates.avgTicket.met ? "" : "AVG", x.gates.closingRate.met ? "" : "CR"].filter(Boolean).join("+") || "none";

const A = readWeek(fileA), B = readWeek(fileB);
const summary: { week: string; eligP2: number; eligP3: number; paidP2: number; paidP3: number; miP2: string; miP3: string; changed: string[] }[] = [];
const derived = new Map<string, { p2: CompetitionResult; p3: CompetitionResult }>();

for (const w of [A, B]) {
  assert.equal(w.hash, FP.stored); assert.equal(w.stored.rulesHash, FP.stored);
  const again = reallocateStored(w.stored, STORED_RULES, STORED_RULES);
  assert.equal(JSON.stringify(again.results), JSON.stringify(w.stored.results), `${w.week}: K1`);
  checks.push(`K1 ${w.week}: re-allocating the stored result under its own rules reproduces data.json (${w.stored.results.length} competitors)`);
  const p2 = rebasis(w.stored, P2);
  // P2 on the qualifying basis = the plain P2 re-allocation (nothing but prizes differs from the stored rules).
  assert.equal(JSON.stringify(p2.results.map((x) => [x.competitorId, x.eligible, x.prizePosition, x.prizeCents, x.wonMostImproved])),
    JSON.stringify(reallocateStored(w.stored, P2, STORED_RULES).results.map((x) => [x.competitorId, x.eligible, x.prizePosition, x.prizeCents, x.wonMostImproved])), `${w.week}: P2 rebasis = P2 re-allocation`);
  const p3 = rebasis(w.stored, P3);
  checks.push(`K2 ${w.week}: P3 ranking order = stored ranks (the job-count basis never enters the score or the BALANCED_PERFORMANCE_V1 tie-break)`);
  derived.set(w.week, { p2, p3 });

  out.push(`## Week of ${w.week}`, "");
  out.push(`Competitors ${p3.results.length} · meet the job minimum: P2 ${p2.gateCounts.jobs} → P3 ${p3.gateCounts.jobs} · meet all three minimums: P2 ${p2.eligibleCount} → P3 ${p3.eligibleCount} · paid: P2 ${usd(p2.awardedCents)} → P3 ${usd(p3.awardedCents)} of $1,500.`, "");
  out.push("### Who changes eligibility", "");
  const flips = p3.results.filter((n) => p2.results.find((o) => o.competitorId === n.competitorId)!.gates.jobs.met !== n.gates.jobs.met);
  out.push("| Rank | Technician | Location | Assigned | Qualifying (P2 count) | Closed | Closing Rate | AVG TICKET | Score | Jobs gate P2 → P3 | Still missing (P3) | Eligible P2 → P3 |", "|---:|---|---|---:|---:|---:|---:|---:|---:|---|---|---|");
  for (const n of flips) {
    const o = p2.results.find((x) => x.competitorId === n.competitorId)!;
    out.push(`| ${n.rank} | ${n.displayName} | ${n.location} | ${n.assignedJobs} | ${o.qualifyingJobs} | ${n.closedJobs} | ${pct(n.closingRate)} | $${n.avgTicket.toFixed(2)} | ${n.score.toFixed(2)} | ${o.gates.jobs.met ? "met" : "no"} → ${n.gates.jobs.met ? "met" : "no"} | ${missing(n)} | ${o.eligible ? "yes" : "no"} → **${n.eligible ? "yes" : "no"}** |`);
  }
  if (!flips.length) out.push("| — | nobody | | | | | | | | | | |");
  out.push("", `${flips.length} technician(s) reach the job minimum only because cancellations, Pending, Reschedule, No answer, OOA, Client Fixed It and blank-status jobs now count; ${flips.filter((x) => x.eligible).length} of them become fully eligible (the others still miss AVG TICKET and/or Closing Rate). Nobody loses the job minimum (assigned ≥ qualifying always).`, "");

  out.push("### Prizes P2 → P3 (engine allocatePrizes)", "");
  const p2Pay = payouts(p2), p3Pay = payouts(p3);
  const ids = [...new Set([...p2Pay.keys(), ...p3Pay.keys()])].sort((a, b) => p3.results.find((x) => x.competitorId === a)!.rank - p3.results.find((x) => x.competitorId === b)!.rank);
  out.push("| Rank | Technician | Location | Score | Eligible P2 / P3 | P2 prize | P3 prize | Change |", "|---:|---|---|---:|---|---:|---:|---:|");
  const changed: string[] = [];
  for (const id of ids) {
    const o = p2.results.find((x) => x.competitorId === id)!, n = p3.results.find((x) => x.competitorId === id)!;
    const d = n.prizeCents - o.prizeCents;
    const same = d === 0 && o.prizePosition === n.prizePosition && o.wonMostImproved === n.wonMostImproved;
    if (!same) changed.push(n.displayName);
    out.push(`| ${n.rank} | ${n.displayName} | ${n.location} | ${n.score.toFixed(2)} | ${o.eligible ? "yes" : "no"} / ${n.eligible ? "yes" : "no"} | ${lab(o)} | ${lab(n)} | ${same ? "same" : d ? `${d > 0 ? "+" : "−"}${usd(Math.abs(d))}` : "label only"} |`);
  }
  const mi = (r: CompetitionResult) => r.results.find((x) => x.wonMostImproved);
  const miO = mi(p2), miN = mi(p3);
  out.push("", `- **Most Improved:** P2 ${miO ? `${miO.displayName} (#${miO.rank}, +${miO.mostImproved!.improvement.toFixed(2)})` : "none"} → P3 ${miN ? `**${miN.displayName}** (#${miN.rank}, +${miN.mostImproved!.improvement.toFixed(2)})` : "none"}${miO?.competitorId === miN?.competitorId ? " — same" : " — CHANGED"} (stored baselines; see limits).`);
  out.push(`- **Cash changes for:** ${changed.join(", ") || "nobody"}.`, "");
  const noBase = p3.results.filter((x) => x.prizeEligible && x.prizePosition === null && !x.mostImproved);
  out.push(`- Prize-eligible under P3, no position prize, and NO stored Most Improved baseline (could gain one on the assigned basis — not computable here): ${noBase.map((x) => `${x.displayName} (#${x.rank}, score ${x.score.toFixed(2)})`).join(", ") || "none"}.`, "");
  summary.push({ week: w.week, eligP2: p2.eligibleCount, eligP3: p3.eligibleCount, paidP2: p2.awardedCents, paidP3: p3.awardedCents, miP2: miO?.displayName ?? "none", miP3: miN?.displayName ?? "none", changed });
}

// ── K3: week B from jobs.json through the engine ───────────────────────────
const jobsB: ExtractedJob[] = JSON.parse(fs.readFileSync(jobsFile, "utf8"));
const mapB = competitorsFromStored(B.stored, jobsB);
const arenaJobs = toArenaJobs(jobsB);
for (const [name, rules] of [["P2", P2], ["P3", P3]] as const) {
  const eng = scoreWeek({ rules, weekStart: B.week, stored: B.stored, competitors: mapB, jobs: arenaJobs });
  const der = derived.get(B.week)![name === "P2" ? "p2" : "p3"];
  assert.equal(eng.results.length, der.results.length);
  for (const d of der.results) {
    const e = eng.results.find((x) => x.competitorId === d.competitorId)!;
    assert.ok(e, `K3 ${name}: ${d.displayName} missing`);
    for (const k of ["rank", "score", "assignedJobs", "closedJobs", "qualifyingJobs", "eligible", "prizeEligible", "prizePosition", "prizeCents", "wonMostImproved"] as const)
      assert.equal(e[k], d[k], `K3 ${name} ${d.displayName}.${k}`);
    assert.deepEqual(e.gates.jobs, d.gates.jobs, `K3 ${name} ${d.displayName} jobs gate`);
  }
  assert.equal(eng.mostImprovedWinner, der.mostImprovedWinner, `K3 ${name} MI`);
  checks.push(`K3 ${B.week} ${name}: the engine scoring jobs.json (${jobsB.length} jobs) under ${name} reproduces every derived rank, score, job count, gate, eligibility, prize and the MI winner`);
}

const head = [
  "# P3 — the job minimum counts ALL assigned jobs: impact on the two real weeks", "",
  `Generated ${new Date().toISOString()} by \`scripts/arena/p3-assigned-impact.ts\` (branch arena/live-beta; local files only — no database, no network, no CRM read).`, "",
  `- **P2 (today):** Balanced Performance · Prizes 2026-11 (\`balanced-p2-2026-11\`, \`${FP.p2}\`): minimum **10 qualifying jobs** (Closed, X close, Estimate, Cancel Estimate, Price Issue, Deposit, Refund).`,
  `- **P3 (new):** Balanced Performance · Assigned jobs · Prizes 2026-11 (\`balanced-p3-2026-11\`, \`${FP.p3}\`): minimum **10 assigned jobs** — every job with the technician and a date in the week, any status. Same prizes ($550 / $400 / $300 + Most Improved $250, $1,500), same AVG ≥ $400 and CR ≥ 40% minimums, same 50% / $500 targets.`,
  "- Closing Rate, AVG TICKET, scores and ranks are identical under P2 and P3; only the job minimum — and through it eligibility and the prize allocation — can change.",
  "- Inputs: `trial-20261102/2026-10-19/data.json`, `preview-20261102/2026-10-26/data.json` (stored per-competitor results), `preview-20261102/work/jobs.json` (week of 2026-10-26 jobs). **Stored and approved results are not altered** — this is a what-if on copies.", "",
  "## Summary", "",
  "| Week | Fully eligible P2 → P3 | Paid P2 → P3 | Most Improved P2 → P3 | Cash changes for |", "|---|---|---|---|---|",
  ...summary.map((s) => `| ${s.week} | ${s.eligP2} → ${s.eligP3} | ${usd(s.paidP2)} → ${usd(s.paidP3)} | ${s.miP2} → ${s.miP3} | ${s.changed.join(", ") || "nobody"} |`), "",
  "## Cross-checks (asserted)", "", ...checks.map((c) => `- ${c}`), "",
];
const tail = [
  "## Limits — not verified", "",
  "- **Most Improved baselines cannot be fully recomputed without a new CRM read.** The stored baselines were computed on the qualifying basis (a baseline week is valid with ≥ 5 *qualifying* jobs). Under P3 a baseline week is valid with ≥ 5 *assigned* jobs, so (a) technicians with no stored baseline may gain one, and (b) existing baselines may pool more valid weeks, which changes the baseline score and therefore the improvement. The extracts hold no baseline-week jobs, so the P3 Most Improved result above uses the stored baselines and is **provisional**; the names listed under each week (prize-eligible, no position, no stored baseline) are the ones whose MI standing could change.",
  "- No approved job exclusions exist in either stored week (asserted). Suspected duplicate groups are unresolved in both weeks; under P3 a confirmed duplicate would deduct from the assigned count (any status). Not modelled.",
  "- Account standing: every competitor is `unverified` in both stored weeks (keeps their place; nothing redistributed).",
  "- Week of 2026-10-19 has no per-job extract, so it was derived from the stored per-competitor `assignedJobs` only (K3 cross-check was possible for 2026-10-26 only).",
  "- Identity what-ifs (unidentified CRM names such as John / TZVI) are not repeated here; see PRIZES-P2 impact for those.", "",
];
fs.writeFileSync(outMd, [...head, ...out, ...tail].join("\n"), { mode: 0o600 });
fs.chmodSync(outMd, 0o600);
console.log(checks.join("\n"));
for (const s of summary) console.log(`${s.week}: eligible ${s.eligP2} -> ${s.eligP3}; paid ${s.paidP2} -> ${s.paidP3}; MI ${s.miP2} -> ${s.miP3}; changed: ${s.changed.join(", ") || "nobody"}`);
console.log(`wrote ${outMd}`);
