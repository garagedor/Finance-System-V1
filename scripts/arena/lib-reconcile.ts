/**
 * Weekly shadow reconciliation — PURE checks and rendering (no I/O, no database).
 * Used by scripts/arena/shadow-reconcile.ts, tested by src/lib/arena/shadow-reconcile.test.ts.
 *
 *   rulesCheck        acceptance A2: minimums, nobody ineligible paid, V1 score formula,
 *                     ranking order and tie-breaks, prize positions, budget, Most Improved
 *                     (incl. the baseline weeks, recomputed independently from the stored source)
 *   compareMethods    V1 (primary) vs the old WEIGHTED_V0 method on the SAME frozen input
 *   independentLateDiff  the job changes between the freeze job set and a later CRM re-read,
 *                     recomputed here, to prove every post-freeze change was detected (A7)
 *   acceptance        A1–A8 verdicts from the daily runs, the simulated approval and the checks
 *   renderReconciliation  the owner-readable report
 *
 * Nothing here can approve, pay or change anything: it only reads results that exist.
 */
import type { ArenaJob, ArenaRules, CompetitionResult, CompetitorResult } from "../../src/lib/arena/types.ts";

export type Verdict = "PASS" | "FAIL" | "PENDING" | "NOT RUN";
export interface CheckLine { id: string; ok: boolean; detail: string }

const EPS = 1e-9;
const BP = 10_000;
const usd = (c: number) => `$${(c / 100).toFixed(0)}`;
const prizeHolder = (r: CompetitorResult) => r.prizeCents > 0 || r.prizePosition !== null || r.wonMostImproved;

/** V1 metric scores from the raw KPIs, independently of the engine. */
export function v1Scores(rules: ArenaRules, closingRate: number, avgTicket: number) {
  const c = 100 * Math.min(closingRate / (rules.scoring.closingRate.targetBp / BP), rules.scoring.closingRate.cap);
  const a = 100 * Math.min(avgTicket / (rules.scoring.avgTicket.targetCents / 100), rules.scoring.avgTicket.cap);
  return { closingScore: c, avgScore: a, score: Math.min(c, a) };
}

/** The approved V1 ranking order, written out independently of engine.compareRanking. */
export function v1Before(a: CompetitorResult, b: CompetitorResult): boolean {
  if (Math.abs(a.score - b.score) > 0) return a.score > b.score;
  const ma = Math.max(a.closingScore, a.avgScore), mb = Math.max(b.closingScore, b.avgScore);
  if (ma !== mb) return ma > mb;
  if (a.assignedJobs !== b.assignedJobs) return a.assignedJobs > b.assignedJobs;
  return a.competitorId < b.competitorId;
}

export interface BaselineWeek { weekStart: string; results: CompetitorResult[] }

/** Acceptance A2 over one result. `baseline` (optional) = the Most Improved baseline weeks scored alone. */
export function rulesCheck(result: CompetitionResult, rules: ArenaRules, baseline: BaselineWeek[] = []): CheckLine[] {
  const out: CheckLine[] = [];
  const e = rules.eligibility;
  const rs = [...result.results].sort((x, y) => x.rank - y.rank);
  const holders = rs.filter(prizeHolder);

  // A2.1 minimums for every prize holder, from the raw numbers (not from the stored gate flags)
  const below = holders.filter((r) =>
    r.qualifyingJobs < e.minQualifyingJobs || r.avgTicket + EPS < e.minAvgTicketCents / 100 || r.closingRate + EPS < e.minClosingRateBp / BP ||
    !r.gates.jobs.met || !r.gates.avgTicket.met || !r.gates.closingRate.met);
  out.push({
    id: "A2.1", ok: below.length === 0,
    detail: below.length ? `prize holder(s) below a minimum: ${below.map((r) => `${r.displayName} (${r.qualifyingJobs} qualifying, $${r.avgTicket.toFixed(2)}, ${(r.closingRate * 100).toFixed(2)}%)`).join("; ")}`
      : `${holders.length} prize holder(s), each ≥ ${e.minQualifyingJobs} qualifying jobs, AVG ≥ ${usd(e.minAvgTicketCents)}, CR ≥ ${e.minClosingRateBp / 100}%`,
  });
  // A2.2 nobody ineligible holds a prize
  const inel = holders.filter((r) => !r.eligible || !r.prizeEligible);
  out.push({ id: "A2.2", ok: inel.length === 0, detail: inel.length ? `ineligible prize holder(s): ${inel.map((r) => r.displayName).join(", ")}` : "no ineligible competitor holds a prize" });

  // A2.3 the score formula (V1 only)
  const v1 = rules.scoring.methodology === "BALANCED_PERFORMANCE_V1";
  if (v1) {
    const bad = rs.filter((r) => {
      const s = v1Scores(rules, r.closingRate, r.avgTicket);
      return Math.abs(s.score - r.score) > EPS || Math.abs(s.closingScore - r.closingScore) > EPS || Math.abs(s.avgScore - r.avgScore) > EPS;
    });
    out.push({ id: "A2.3", ok: bad.length === 0, detail: bad.length ? `score differs from min(C, A) for ${bad.map((r) => r.displayName).join(", ")}` : `every score = min(100·min(CR/${rules.scoring.closingRate.targetBp / 100}%, ${rules.scoring.closingRate.cap}), 100·min(AVG/${usd(rules.scoring.avgTicket.targetCents)}, ${rules.scoring.avgTicket.cap})) (${rs.length} competitors)` });
  } else out.push({ id: "A2.3", ok: false, detail: `methodology is ${rules.scoring.methodology ?? "WEIGHTED_V0"}, not BALANCED_PERFORMANCE_V1` });

  // A2.4 ranking order + tie-breaks
  const order: string[] = [];
  rs.forEach((r, i) => { if (r.rank !== i + 1) order.push(`rank ${r.rank} at position ${i + 1}`); });
  for (let i = 1; i < rs.length; i++) if (!v1Before(rs[i - 1], rs[i])) order.push(`${rs[i - 1].displayName} (#${rs[i - 1].rank}) should not be above ${rs[i].displayName} (#${rs[i].rank})`);
  const ties = rs.filter((r, i) => i > 0 && r.score === rs[i - 1].score).length;
  out.push({ id: "A2.4", ok: order.length === 0, detail: order.length ? order.slice(0, 5).join("; ") : `order = final score (unrounded) → higher metric score → more assigned jobs → id; ${ties} exact tie(s) resolved by tie-break` });

  // A2.5 prize positions: the prize-eligible competitors in rank order, amounts as approved
  const positions = rules.prizes.positionsCents;
  const expected = rs.filter((r) => r.prizeEligible).slice(0, positions.length);
  const pos: string[] = [];
  expected.forEach((r, i) => { if (r.prizePosition !== i + 1 || (r.prizeCents !== positions[i] && !r.wonMostImproved)) pos.push(`${r.displayName}: expected #${i + 1} ${usd(positions[i])}, has ${r.prizePosition ? `#${r.prizePosition}` : "none"} ${usd(r.prizeCents)}`); });
  for (const r of rs) if (r.prizePosition !== null && !expected.includes(r)) pos.push(`${r.displayName} holds #${r.prizePosition} but is not among the top ${positions.length} prize-eligible`);
  out.push({ id: "A2.5", ok: pos.length === 0, detail: pos.length ? pos.join("; ") : `${expected.length} of ${positions.length} positions filled in rank order (${expected.map((r) => `#${r.prizePosition} ${r.displayName}`).join(", ") || "none"})${expected.length < positions.length ? `; ${positions.length - expected.length} unpaid (no eligible competitor)` : ""}` });

  // A2.6 budget
  const sum = rs.reduce((s, r) => s + r.prizeCents, 0);
  const budgetOk = sum === result.awardedCents && sum <= rules.prizes.budgetCents;
  out.push({ id: "A2.6", ok: budgetOk, detail: `awarded ${usd(sum)} (record ${usd(result.awardedCents)}) of budget ${usd(rules.prizes.budgetCents)}` });

  // A2.7 Most Improved
  const mi = rules.mostImproved;
  const mip: string[] = [];
  const winners = rs.filter((r) => r.wonMostImproved);
  if (!mi.enabled) { if (winners.length) mip.push("Most Improved is off but has a winner"); }
  else {
    if (winners.length > 1) mip.push(`${winners.length} Most Improved winners`);
    const candidates = rs.filter((r) => r.prizeEligible && r.prizePosition === null && r.mostImproved && r.mostImproved.validWeeks >= mi.minValidWeeks && r.mostImproved.improvement > mi.minImprovement);
    const best = [...candidates].sort((a, b) => b.mostImproved!.improvement - a.mostImproved!.improvement || (v1Before(a, b) ? -1 : 1))[0];
    const w = winners[0];
    if (w) {
      if (w.prizePosition !== null) mip.push(`${w.displayName} also holds Top-${positions.length} position #${w.prizePosition}`);
      if (!w.eligible || !w.prizeEligible) mip.push(`${w.displayName} is not eligible this week`);
      if (w.prizeCents !== mi.amountCents) mip.push(`${w.displayName} prize ${usd(w.prizeCents)} ≠ ${usd(mi.amountCents)}`);
      if (!w.mostImproved || w.mostImproved.validWeeks < mi.minValidWeeks) mip.push(`${w.displayName}: ${w.mostImproved?.validWeeks ?? 0} valid baseline weeks < ${mi.minValidWeeks}`);
      if (best && best.competitorId !== w.competitorId) mip.push(`${best.displayName} improved more (+${best.mostImproved!.improvement.toFixed(2)}) than the winner ${w.displayName} (+${w.mostImproved?.improvement.toFixed(2)})`);
      if (result.mostImprovedWinner !== w.competitorId) mip.push("mostImprovedWinner differs from the flagged winner");
    } else if (best) mip.push(`no winner, but ${best.displayName} qualifies (+${best.mostImproved!.improvement.toFixed(2)})`);
    // Independent baseline: from the baseline weeks scored alone, count valid weeks and pool them under V1.
    if (baseline.length) {
      for (const r of rs.filter((x) => x.mostImproved || x.wonMostImproved)) {
        const valid = baseline.map((b) => b.results.find((x) => x.competitorId === r.competitorId)).filter((x): x is CompetitorResult => !!x && x.assignedJobs > 0 && x.qualifyingJobs >= mi.minQualifyingJobsPerWeek);
        if (valid.length !== (r.mostImproved?.validWeeks ?? valid.length)) mip.push(`${r.displayName}: ${valid.length} baseline week(s) with ≥ ${mi.minQualifyingJobsPerWeek} qualifying jobs, engine says ${r.mostImproved?.validWeeks}`);
        if (r.mostImproved && valid.length) {
          const assigned = valid.reduce((s, x) => s + x.assignedJobs, 0), closed = valid.reduce((s, x) => s + x.closedJobs, 0), profit = valid.reduce((s, x) => s + x.profitMicro, 0) / 1e6;
          const b = v1Scores(rules, assigned ? closed / assigned : 0, assigned ? profit / assigned : 0).score;
          if (Math.abs(b - r.mostImproved.baselineScore) > 1e-6) mip.push(`${r.displayName}: baseline ${b.toFixed(4)} recomputed vs ${r.mostImproved.baselineScore.toFixed(4)}`);
        }
      }
    }
  }
  const w0 = winners[0];
  out.push({ id: "A2.7", ok: mip.length === 0, detail: mip.length ? mip.join("; ") : !mi.enabled ? "Most Improved off" : w0
    ? `${w0.displayName} +${w0.mostImproved!.improvement.toFixed(2)} (baseline ${w0.mostImproved!.baselineScore.toFixed(2)}, ${w0.mostImproved!.validWeeks} valid weeks of ${mi.baselineWeeks}, each ≥ ${mi.minQualifyingJobsPerWeek} qualifying jobs${baseline.length ? ", recomputed independently" : ""}); eligible; not a Top-${positions.length} winner`
    : "no competitor qualifies for Most Improved (rule applied, prize unpaid)" });
  return out;
}

export interface MethodRow {
  competitorId: string; displayName: string;
  v1: { rank: number; score: number; prizeCents: number }; v0: { rank: number; score: number; prizeCents: number } | null;
  moved: string;
}
/** V1 vs the old method on the same input. Information only. */
export function compareMethods(v1: CompetitionResult, v0: CompetitionResult): MethodRow[] {
  return [...v1.results].sort((a, b) => a.rank - b.rank).map((r) => {
    const o = v0.results.find((x) => x.competitorId === r.competitorId) ?? null;
    const moved = !o ? "not in V0" : o.rank === r.rank && o.prizeCents === r.prizeCents ? "—"
      : `${o.rank === r.rank ? "same rank" : `old #${o.rank} → V1 #${r.rank}`}${o.prizeCents !== r.prizeCents ? `, prize ${usd(o.prizeCents)} → ${usd(r.prizeCents)}` : ""}${r.limitingMetric ? ` (limited by ${r.limitingMetric === "closingRate" ? "Closing Rate" : r.limitingMetric === "avgTicket" ? "AVG TICKET" : "both"})` : ""}`;
    return { competitorId: r.competitorId, displayName: r.displayName, v1: { rank: r.rank, score: r.score, prizeCents: r.prizeCents }, v0: o ? { rank: o.rank, score: o.score, prizeCents: o.prizeCents } : null, moved };
  });
}

/** Job ids of the competition week that differ between the freeze set and a re-read (independent of source-snapshot.ts). */
export function independentLateDiff(freeze: ArenaJob[], read: ArenaJob[], weekStart: string, weekEndExclusive: string): { jobId: string; what: string }[] {
  const inWeek = (j: ArenaJob) => j.date >= weekStart && j.date < weekEndExclusive;
  const a = new Map(freeze.map((j) => [j.id, j])), b = new Map(read.map((j) => [j.id, j]));
  const out: { jobId: string; what: string }[] = [];
  for (const id of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const x = a.get(id), y = b.get(id);
    if (!(x && inWeek(x)) && !(y && inWeek(y))) continue;
    if (!y) { out.push({ jobId: id, what: "gone from the re-read" }); continue; }
    if (!x) { out.push({ jobId: id, what: "new in the re-read" }); continue; }
    const f: string[] = [];
    if (x.tech !== y.tech) f.push(`tech ${x.tech} → ${y.tech}`);
    if (x.date !== y.date) f.push(`date ${x.date} → ${y.date}`);
    if (x.status !== y.status) f.push(`status ${x.status} → ${y.status}`);
    if (x.location !== y.location) f.push(`location ${x.location} → ${y.location}`);
    if (Math.abs(x.profit - y.profit) >= 0.005) f.push(`profit ${x.profit} → ${y.profit}`);
    if (f.length) out.push({ jobId: id, what: f.join("; ") });
  }
  return out;
}

// ── acceptance A1–A8 ─────────────────────────────────────────────────────────

export interface DailyRunInfo {
  generatedAt: string;
  /** ET calendar day of the run. */
  day: string;
  /** REHEARSAL: the day is a --day-label, not the real run day. */
  simulatedDay?: boolean;
  weekEnded: boolean;
  guardOk: boolean;
  crmUsers: string[];
  blockedWrites: string[];
  parityComparisons: number;
  parityMismatches: number;
  stops: string[];
  inputHash: string | null;
  resultHash: string | null;
}
export interface ApprovalRunInfo {
  generatedAt: string;
  outcome: string;
  simulatedClock: boolean;
  safetyOk: boolean;
  crmWriteAttemptsBlocked: number;
  financeCollectionsOpened: string[];
  nonArenaLocalWrites: string[];
  integrityIdentical: number;
  integrityMismatched: number;
  undecided: { names: string[]; duplicates: string[]; displayNames: string[] } | null;
}
export interface AcceptanceInput {
  weekStart: string;
  /** The ET days Monday … Sunday of the week (daily runs expected), and the Monday after (freeze-day run). */
  expectedDays: string[];
  daily: DailyRunInfo[];
  approvals: ApprovalRunInfo[];
  rules: CheckLine[] | null;
  /** Review cases of the week still open or waiting for the owner (local database), excluding names pending identification. */
  openCases: string[];
  pendingNames: string[];
  /** A7 inputs. */
  late: { detected: string[]; independent: { jobId: string; what: string }[]; material: boolean; decided: string | null; postApproval: number } | null;
  reproducible: boolean | null;
  techAccessEnv: string[];
  preflightPassed: boolean | null;
  ownerSignOff: string | null;
}
export interface AcceptanceLine { id: string; name: string; verdict: Verdict; detail: string }

const FORBIDDEN = ["lbs_crm_app", "lbs_ops"];

export function acceptance(x: AcceptanceInput): AcceptanceLine[] {
  const L: AcceptanceLine[] = [];
  const final = [...x.daily].filter((d) => d.weekEnded).sort((a, b) => (a.generatedAt < b.generatedAt ? -1 : 1)).pop() ?? null;
  const approved = x.approvals.find((a) => a.outcome === "approved") ?? null;

  // A1 parity
  const earlier = x.daily.filter((d) => d.parityMismatches > 0 && d !== final);
  L.push({
    id: "A1", name: "CRM parity",
    verdict: !final ? "NOT RUN" : final.parityMismatches === 0 && final.parityComparisons > 0 ? "PASS" : "FAIL",
    detail: !final ? "no shadow-week run after the week ended (the Monday freeze-day run is the official parity check)"
      : `final run ${final.generatedAt}: ${final.parityComparisons} comparisons, ${final.parityMismatches} mismatch(es)${earlier.length ? `; earlier runs with mismatches (data still changing, explain each): ${earlier.map((d) => `${d.day} ×${d.parityMismatches}`).join(", ")}` : ""}`,
  });
  // A2 rules
  const bad = (x.rules ?? []).filter((l) => !l.ok);
  L.push({ id: "A2", name: "Rules", verdict: !x.rules ? "NOT RUN" : bad.length ? "FAIL" : "PASS",
    detail: !x.rules ? "no approved (or reviewed) result to check" : bad.length ? bad.map((l) => `${l.id} ${l.detail}`).join(" | ") : `${x.rules.length} checks, 0 violations${approved ? "" : " (on the snapshot under review — not approved yet)"}` });
  // A3 review queue
  const und = approved?.undecided;
  const undecidedCount = und ? und.names.length + und.duplicates.length + und.displayNames.length : 0;
  L.push({ id: "A3", name: "Review queue",
    verdict: !approved ? (x.openCases.length ? "FAIL" : "PENDING") : x.openCases.length || undecidedCount ? "FAIL" : "PASS",
    detail: `${x.openCases.length} case(s) open / waiting for the owner${x.openCases.length ? `: ${x.openCases.slice(0, 8).join("; ")}` : ""}${undecidedCount ? `; undecided by the decisions file at approval: ${[...und!.names, ...und!.duplicates, ...und!.displayNames].join("; ")}` : ""}` +
      `${x.pendingNames.length ? `; decided "pending identification" (not credited, cannot win): ${x.pendingNames.join(", ")}` : ""}${approved ? "" : "; no practice approval yet"}` });
  // A4 stability
  const days = new Set(x.daily.map((d) => d.day));
  const missed = x.expectedDays.filter((d) => !days.has(d));
  const byInput = new Map<string, Set<string>>();
  for (const d of x.daily) if (d.inputHash && d.resultHash) (byInput.get(d.inputHash) ?? byInput.set(d.inputHash, new Set()).get(d.inputHash)!).add(d.resultHash);
  const unstable = [...byInput.values()].filter((s) => s.size > 1).length;
  const reruns = [...byInput.values()].length < x.daily.filter((d) => d.inputHash).length;
  const errors = x.approvals.filter((a) => a.outcome === "error").length;
  L.push({ id: "A4", name: "Stability",
    verdict: missed.length || unstable || errors || x.reproducible === false ? "FAIL" : "PASS",
    detail: `${x.daily.length} daily run(s) on ${days.size} day(s)${missed.length ? `; MISSED: ${missed.join(", ")}` : ""}; ${unstable ? `${unstable} input(s) gave DIFFERENT results` : reruns ? "every rerun with the same input gave the same result" : "no rerun with an identical input (determinism shown by the stored snapshot reproducing)"}` +
      `; approval runs with an error: ${errors}; approved snapshot reproduces from its stored source: ${x.reproducible === null ? "n/a" : x.reproducible ? "yes" : "NO"}` });
  // A5 safety
  const guardBad = x.daily.filter((d) => !d.guardOk || d.crmUsers.some((u) => FORBIDDEN.includes(u.split("@")[0].toLowerCase())));
  const unsafe = x.approvals.filter((a) => !a.safetyOk || a.crmWriteAttemptsBlocked > 0 || a.financeCollectionsOpened.length || a.nonArenaLocalWrites.length);
  const healOnRead = [...new Set(x.daily.flatMap((d) => d.blockedWrites))];
  const nonHeal = healOnRead.filter((w) => !/^finance_meta\./.test(w));
  L.push({ id: "A5", name: "Safety",
    verdict: guardBad.length || unsafe.length || nonHeal.length || x.techAccessEnv.length || x.preflightPassed === false ? "FAIL" : x.preflightPassed === null ? "PENDING" : "PASS",
    detail: `read-only guard passed on ${x.daily.length - guardBad.length}/${x.daily.length} daily run(s); approval runs unsafe: ${unsafe.length}; CRM writes: 0 possible (blocked in-process before sending: ${healOnRead.length ? healOnRead.join(", ") + " — CRM heal-on-read" : "none"})` +
      `${nonHeal.length ? `; UNEXPECTED blocked write(s): ${nonHeal.join(", ")}` : ""}; technician-access variables now: ${x.techAccessEnv.length ? x.techAccessEnv.join(", ") : "none"}; preflight (F7 technician access OFF): ${x.preflightPassed === null ? "no preflight log saved for this week" : x.preflightPassed ? "PASSED" : "FAILED"}` });
  // A6 history
  L.push({ id: "A6", name: "History",
    verdict: !approved ? "PENDING" : approved.integrityMismatched === 0 && approved.integrityIdentical > 0 ? "PASS" : "FAIL",
    detail: approved ? `integrity after the practice approval: ${approved.integrityIdentical} IDENTICAL, ${approved.integrityMismatched} MISMATCH` : "no practice approval yet" });
  // A7 late edits
  if (!x.late) L.push({ id: "A7", name: "Late edits", verdict: "NOT RUN", detail: "no re-read after the freeze yet (run the Thursday re-read)" });
  else {
    const missedLate = x.late.independent.filter((c) => !x.late!.detected.includes(c.jobId));
    L.push({ id: "A7", name: "Late edits",
      verdict: missedLate.length || (x.late.material && !x.late.decided && !!approved) ? "FAIL" : "PASS",
      detail: `${x.late.detected.length} post-freeze change(s) listed by the Arena; independent re-diff found ${x.late.independent.length}${missedLate.length ? `, NOT LISTED: ${missedLate.map((c) => `${c.jobId} (${c.what})`).join("; ")}` : ", all listed"}; ` +
        `${x.late.material ? `affects prizes → ${x.late.decided ? `owner decided ${x.late.decided}` : "approval BLOCKED until the owner decides"}` : "no prize effect"}; post-approval corrections logged: ${x.late.postApproval}` });
  }
  // A8 owner sign-off
  L.push({ id: "A8", name: "Owner sign-off", verdict: x.ownerSignOff ? "PASS" : "PENDING", detail: x.ownerSignOff ?? "the owner reviews the winners and signs below" });
  return L;
}
