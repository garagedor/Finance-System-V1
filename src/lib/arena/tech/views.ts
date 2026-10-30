/**
 * Builders for the technician API responses. DATA MINIMIZATION lives here:
 * every object is constructed field by field from the contract — nothing is
 * spread from an internal record — so job ids, CRM names, profit sums, review
 * data or anything added to internal types later can never leak by accident.
 */
import type { ArenaRules } from "../types";
import type { ApprovedStanding, ResultDoc } from "../lifecycle";
import type {
  CompetitionPhase, GateView, HistoryResponse, LeaderboardRow, MyStanding, RulesView,
} from "../tech-api-contract";

const BP = 10_000;
const CENTS = 100;
const r2 = (n: number) => Math.round(n * CENTS) / CENTS;
const bp = (rate: number) => Math.round(rate * BP);
const cents = (dollars: number) => Math.round(dollars * CENTS);
const money = (c: number) => `$${(c / CENTS).toLocaleString("en-US", { minimumFractionDigits: c % CENTS ? 2 : 0, maximumFractionDigits: 2 })}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function rulesView(rules: ArenaRules): RulesView {
  const s = rules.scoring;
  return {
    timezone: rules.timezone,
    minQualifyingJobs: rules.eligibility.minQualifyingJobs,
    minAvgTicketCents: rules.eligibility.minAvgTicketCents,
    minClosingRateBp: rules.eligibility.minClosingRateBp,
    closingRateWeight: r2(s.closingRate.weight / (s.closingRate.weight + s.avgTicket.weight)),
    avgTicketWeight: r2(s.avgTicket.weight / (s.closingRate.weight + s.avgTicket.weight)),
    closingRateTargetBp: s.closingRate.targetBp,
    avgTicketTargetCents: s.avgTicket.targetCents,
    cap: Math.min(s.closingRate.cap, s.avgTicket.cap),
    prizesCents: [...rules.prizes.positionsCents],
    mostImprovedCents: rules.mostImproved.enabled ? rules.mostImproved.amountCents : null,
    showPotentialPrize: rules.display.showPotentialPrize,
    refreshSeconds: rules.display.refreshSeconds,
  };
}

export const prizePoolCents = (rules: ArenaRules) =>
  rules.prizes.positionsCents.reduce((a, b) => a + b, 0) + (rules.mostImproved.enabled ? rules.mostImproved.amountCents : 0);

/** Prize shown for a row: awarded once approved; potential (if the rules show it) before. */
const shownPrize = (s: ApprovedStanding, rules: ArenaRules, phase: CompetitionPhase) =>
  phase === "approved" ? s.prizeCents : rules.display.showPotentialPrize ? s.prizeCents : 0;

export function leaderboardRows(
  rows: ApprovedStanding[],
  rules: ArenaRules,
  phase: CompetitionPhase,
  me: string,
  view: "national" | "eligible",
): LeaderboardRow[] {
  return rows
    .filter((s) => view === "national" || s.eligible)
    .sort((a, b) => a.rank - b.rank)
    .map((s) => {
      const show = s.eligible || rules.display.showIneligibleMetrics;
      return {
        rank: s.rank,
        competitorId: s.competitorId,
        displayName: s.displayName,
        location: s.location,
        score: r2(s.score),
        eligible: s.eligible,
        gatesMet: { jobs: s.gates.jobs, avgTicket: s.gates.avgTicket, closingRate: s.gates.closingRate },
        closingRateBp: show ? bp(s.closingRate) : null,
        avgTicketCents: show ? cents(s.avgTicket) : null,
        qualifyingJobs: show ? s.qualifyingJobs : null,
        prizeCents: shownPrize(s, rules, phase),
        isMe: s.competitorId === me,
      };
    });
}

/** Closed jobs still needed to reach the minimum rate, if each is a new assigned job. */
export function closesNeeded(closed: number, assigned: number, minBp: number): number {
  if (assigned > 0 && closed * BP >= minBp * assigned) return 0;
  if (minBp >= BP) return closed === assigned ? 1 : Infinity;
  return Math.max(1, Math.ceil((minBp * assigned - closed * BP) / (BP - minBp)));
}

export function myStanding(
  me: ApprovedStanding | null,
  rows: ApprovedStanding[],
  rules: ArenaRules,
  phase: CompetitionPhase,
): MyStanding {
  const e = rules.eligibility;
  const s: ApprovedStanding = me ?? {
    competitorId: "", displayName: "", location: "", rank: 0, score: 0, eligible: false,
    gates: { jobs: false, avgTicket: false, closingRate: false }, closingRate: 0, avgTicket: 0, assignedJobs: 0,
    closedJobs: 0, qualifyingJobs: 0, closingIndex: 0, avgIndex: 0, prizePosition: null, prizeCents: 0,
    wonMostImproved: false, mostImproved: null,
  };
  const avgCents = cents(s.avgTicket);
  const crBp = bp(s.closingRate);
  const gates: MyStanding["gates"] = {
    jobs: { met: s.gates.jobs, actual: s.qualifyingJobs, required: e.minQualifyingJobs } satisfies GateView,
    avgTicket: { met: s.gates.avgTicket, actual: avgCents, required: e.minAvgTicketCents },
    closingRate: { met: s.gates.closingRate, actual: crBp, required: e.minClosingRateBp },
  };
  const nextSteps: MyStanding["nextSteps"] = [];
  if (!s.gates.jobs) {
    const n = e.minQualifyingJobs - s.qualifyingJobs;
    nextSteps.push({ kind: "jobs", amount: n, text: `${plural(n, "more qualifying job")} to meet the ${e.minQualifyingJobs}-job minimum` });
  }
  if (!s.gates.closingRate) {
    const k = closesNeeded(s.closedJobs, s.assignedJobs, e.minClosingRateBp);
    if (Number.isFinite(k))
      nextSteps.push({ kind: "closes", amount: k, text: `${plural(k, "more closed job")} to reach a ${(e.minClosingRateBp / CENTS).toFixed(e.minClosingRateBp % CENTS ? 2 : 0)}% closing rate` });
  }
  if (!s.gates.avgTicket) {
    const short = Math.max(0, e.minAvgTicketCents * Math.max(s.assignedJobs, 1) - cents(s.avgTicket * s.assignedJobs));
    nextSteps.push({ kind: "avg_ticket", amount: short, text: `${money(short)} more profit this week to reach the ${money(e.minAvgTicketCents)} AVG TICKET` });
  }
  const sorted = [...rows].sort((a, b) => a.rank - b.rank);
  const above = me && me.rank > 1 ? sorted.find((x) => x.rank === me.rank - 1) : undefined;
  const pointsToNextRank = above ? r2(Math.max(0, above.score - s.score)) : null;
  if (above && pointsToNextRank !== null && phase === "live")
    nextSteps.push({ kind: "rank", amount: pointsToNextRank, text: `${pointsToNextRank} points to pass #${above.rank}` });
  const potential = s.eligible && (s.prizePosition !== null || s.wonMostImproved) ? shownPrize(s, rules, phase) : 0;
  return {
    rank: me ? s.rank : null,
    score: r2(s.score),
    eligible: s.eligible,
    gates,
    closingRateBp: crBp,
    avgTicketCents: avgCents,
    assignedJobs: s.assignedJobs,
    closedJobs: s.closedJobs,
    qualifyingJobs: s.qualifyingJobs,
    closingIndex: r2(s.closingIndex),
    avgIndex: r2(s.avgIndex),
    potentialPrizeCents: potential,
    nextSteps,
    pointsToNextRank,
    mostImproved: s.mostImproved
      ? { baselineScore: r2(s.mostImproved.baselineScore), improvement: r2(s.mostImproved.improvement), validWeeks: s.mostImproved.validWeeks }
      : null,
  };
}

export function historyWeeks(results: ResultDoc[], me: string): HistoryResponse["weeks"] {
  return results.map((r) => {
    const mine = r.standings.find((s) => s.competitorId === me) ?? null;
    const mi = r.standings.find((s) => s.wonMostImproved) ?? null;
    return {
      weekStart: r.weekStart,
      myRank: mine ? mine.rank : null,
      myScore: mine ? r2(mine.score) : null,
      eligible: mine?.eligible ?? false,
      prizeCents: mine?.prizeCents ?? 0,
      mostImproved: mine?.wonMostImproved ?? false,
      winners: r.standings
        .filter((s) => s.prizePosition !== null)
        .sort((a, b) => a.prizePosition! - b.prizePosition!)
        .map((s) => ({ rank: s.prizePosition!, displayName: s.displayName, location: s.location, prizeCents: s.prizeCents })),
      mostImprovedWinner: mi ? { displayName: mi.displayName, location: mi.location, prizeCents: mi.prizeCents } : null,
    };
  });
}

/** Opaque feed cursor. */
export const encodeCursor = (key: string) => `c1.${Buffer.from(key, "utf8").toString("base64url")}`;
export function decodeCursor(cursor: string): string | null {
  const m = /^c1\.([A-Za-z0-9_-]{1,200})$/.exec(cursor);
  if (!m) return null;
  const key = Buffer.from(m[1], "base64url").toString("utf8");
  return /^\d{4}-\d{2}-\d{2}T[\d:.]+Z#\d{6}$/.test(key) ? key : null;
}
