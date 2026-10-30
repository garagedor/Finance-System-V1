/**
 * Technician read models. Reads trigger the lifecycle (freeze on the first read
 * after Sunday ends; live recompute when the cached snapshot is stale), then
 * shape the answer through views.ts. Uses only Arena collections plus the
 * read-only CRM identity loaders.
 */
import type { Db } from "mongodb";
import type { ArenaRules } from "../types";
import type { CompetitionDoc, RuleVersionDoc } from "../config-store";
import {
  currentCompetition, freezeIfDue, liveSnapshot, phaseOf, reviewSnapshot, ruleVersionOf, toStanding, windowOf,
  type ApprovedStanding, type LifecycleContext, type ResultDoc,
} from "../lifecycle";
import type { WeekWindow } from "../week";
import { addDays, isMonday } from "../week";
import { loadMappingFor, loadTechnicians } from "../mongo-store";
import { reviewDecisions, type ReviewContext } from "../review";
import type {
  ArenaEvent, CompetitionPhase, EventsResponse, HistoryResponse, LeaderboardResponse, MeResponse,
} from "../tech-api-contract";
import { ARENA_TECH_API_VERSION } from "../tech-api-contract";
import {
  decodeCursor, encodeCursor, historyWeeks, leaderboardRows, myStanding, prizeEligibleOf, prizePoolCents, rulesView,
} from "./views";
import type { Lookup } from "./access";

export class TechNotFound extends Error {}
export class TechBadRequest extends Error {}

export interface TechCtx {
  lifecycle: LifecycleContext;
  review: ReviewContext;
  crmDb: Db;
}

interface Display {
  c: CompetitionDoc;
  rv: RuleVersionDoc;
  w: WeekWindow;
  phase: CompetitionPhase;
  rows: ApprovedStanding[];
  dataAsOf: string;
}

async function display(ctx: TechCtx, c0: CompetitionDoc): Promise<Display> {
  const lc = ctx.lifecycle;
  const c = await freezeIfDue(lc, c0);
  const rv = await ruleVersionOf(lc, c);
  const w = windowOf(c, rv);
  const now = lc.config.now();
  const phase = phaseOf(c, w, now);
  let rows: ApprovedStanding[] = [];
  let dataAsOf = now.toISOString();
  if (c.status === "approved") {
    const res = await lc.lc.results.findOne({ _id: c._id });
    if (res) {
      rows = res.standings;
      const snap = await lc.lc.snapshots.findOne({ _id: res.snapshotId });
      dataAsOf = snap?.computedAt ?? res.approvedAt;
    }
  } else if (c.status === "provisional" || c.status === "in_review") {
    const snap = await reviewSnapshot(lc, c._id);
    if (snap) {
      rows = snap.result.results.map(toStanding);
      dataAsOf = snap.computedAt;
    }
  } else if (c.status === "active" || c.status === "suspended") {
    const snap = await liveSnapshot(lc, c, rv);
    if (snap) {
      rows = snap.result.results.map(toStanding);
      dataAsOf = snap.computedAt;
    }
  }
  return { c, rv, w, phase, rows, dataAsOf };
}

async function current(ctx: TechCtx): Promise<Display | null> {
  const cur = await currentCompetition(ctx.lifecycle);
  return cur ? display(ctx, cur.c) : null;
}

/** Is this competitor taking part under these rules? (ids and home location) */
export function participates(rules: ArenaRules, competitorId: string, location: string): boolean {
  const p = rules.participants;
  if (p.onlyCompetitorIds.length && !p.onlyCompetitorIds.includes(competitorId)) return false;
  if (p.excludeCompetitorIds.includes(competitorId)) return false;
  if (location && p.excludeLocations.includes(location)) return false;
  return true;
}

/**
 * Re-checked on the exchange and on EVERY technician request: the balance-app
 * account still has exactly one TechNameMapping record, and the current
 * competition's rules do not exclude the person.
 */
export async function findCompetitor(ctx: TechCtx, supabaseUserId: string): Promise<Lookup> {
  const m = await loadMappingFor(ctx.crmDb, supabaseUserId);
  if (!m || m.supabaseUserId !== supabaseUserId) return { ok: false };
  const names = (m.crmTechNames ?? []).filter((n) => typeof n === "string" && n);
  const cur = await currentCompetition(ctx.lifecycle);
  if (cur) {
    const techs = names.length ? (await loadTechnicians(ctx.crmDb)).filter((t) => names.includes(t._id)) : [];
    const location = techs.map((t) => t.location ?? "").find((l) => l) ?? "";
    if (!participates(cur.rv.rules, supabaseUserId, location)) return { ok: false };
  }
  const decisions = await reviewDecisions(ctx.review);
  const displayName =
    cur?.rv.rules.participants.displayNames[supabaseUserId] ||
    decisions.displayNames[supabaseUserId] ||
    m.supabaseFullName?.trim() ||
    names[0] ||
    "Technician";
  return { ok: true, competitor: { competitorId: supabaseUserId, displayName } };
}

export async function techMe(ctx: TechCtx, me: string): Promise<MeResponse> {
  const d = await current(ctx);
  const serverTime = ctx.lifecycle.config.now().toISOString();
  const found = await findCompetitor(ctx, me);
  const mine = d?.rows.find((r) => r.competitorId === me) ?? null;
  const competitor = {
    id: me,
    displayName: mine?.displayName ?? (found.ok ? found.competitor.displayName : ""),
    location: mine?.location ?? "",
  };
  if (!d) return { apiVersion: ARENA_TECH_API_VERSION, serverTime, competitor, competition: null, rules: null, standing: null, award: null, notices: [] };
  const notices = (await ctx.lifecycle.config.store.notices.find({ competitionId: d.c._id }).sort({ at: -1 }).toArray()).map((n) => ({
    kind: n.kind, message: n.message, at: n.at,
  }));
  const participating = d.phase !== "upcoming" && d.phase !== "cancelled" && (!!mine || found.ok);
  return {
    apiVersion: ARENA_TECH_API_VERSION,
    serverTime,
    competitor,
    competition: {
      id: d.c._id,
      weekStart: d.c.weekStart,
      weekEnd: addDays(d.w.weekEndExclusive, -1),
      phase: d.phase,
      endsAt: d.w.closesAt.toISOString(),
      reviewOpensAt: d.w.approvalOpensAt.toISOString(),
      dataAsOf: d.dataAsOf,
    },
    rules: rulesView(d.rv.rules),
    standing: participating ? myStanding(mine, d.rows, d.rv.rules, d.phase) : null,
    award: d.phase === "approved" && mine ? { prizeCents: mine.prizeCents, position: mine.prizePosition, mostImproved: mine.wonMostImproved } : null,
    notices,
  };
}

export async function techLeaderboard(ctx: TechCtx, me: string, view: string | null, week: string | null): Promise<LeaderboardResponse> {
  const v = view ?? "national";
  if (v !== "national" && v !== "eligible") throw new TechBadRequest("view must be national or eligible");
  let d: Display | null;
  if (week) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || !isMonday(week)) throw new TechBadRequest("week must be a Monday (YYYY-MM-DD)");
    const c = await ctx.lifecycle.config.store.competitions.findOne({ _id: `arena_${week}` });
    if (!c || c.status === "draft" || c.status === "scheduled") throw new TechNotFound("no competition that week");
    d = await display(ctx, c);
  } else d = await current(ctx);
  if (!d) throw new TechNotFound("no competition right now");
  return {
    apiVersion: ARENA_TECH_API_VERSION,
    weekStart: d.c.weekStart,
    phase: d.phase,
    view: v,
    dataAsOf: d.dataAsOf,
    rows: leaderboardRows(d.rows, d.rv.rules, d.phase, me, v),
    eligibleCount: d.rows.filter(prizeEligibleOf).length,
    participantCount: d.rows.length,
    prizePoolCents: prizePoolCents(d.rv.rules),
  };
}

const HISTORY_DEFAULT = 12;
const HISTORY_MAX = 52;

export async function techHistory(ctx: TechCtx, me: string, limitRaw: string | null): Promise<HistoryResponse> {
  const limit = limitRaw === null ? HISTORY_DEFAULT : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > HISTORY_MAX) throw new TechBadRequest(`limit must be 1–${HISTORY_MAX}`);
  const results: ResultDoc[] = (await ctx.lifecycle.lc.results.find({}).sort({ weekStart: -1 }).toArray()).slice(0, limit);
  return { apiVersion: ARENA_TECH_API_VERSION, weeks: historyWeeks(results, me) };
}

const EVENTS_PAGE = 100;

/** How long after approval a fresh app open still replays the caller's winning result. */
export const RESULT_REPLAY_MS = 7 * 24 * 3600 * 1000;

/**
 * The caller's `result_approved` event from the most recent approval, when it was
 * approved within RESULT_REPLAY_MS and the caller actually won something. A fresh
 * app open (no cursor) gets it so the winner celebration can show "on the next
 * app open"; the app shows it once per week per device (dismissal remembered
 * locally), so replaying it is safe. /me's `award` alone is not enough: once the
 * next week starts, /me describes that week and the award is gone.
 */
async function recentWin(ctx: TechCtx, me: string): Promise<ArenaEvent | null> {
  const lc = ctx.lifecycle.lc;
  const res = (await lc.results.find({}).sort({ approvedAt: -1 }).toArray())[0];
  if (!res) return null;
  if (ctx.lifecycle.config.now().getTime() - Date.parse(res.approvedAt) > RESULT_REPLAY_MS) return null;
  const docs = await lc.events.find({ competitorId: me, competitionId: res._id }).sort({ key: -1 }).toArray();
  const e = docs.map((d) => d.event).find((x) => x.kind === "result_approved");
  return e && e.kind === "result_approved" && (e.prizeCents > 0 || e.mostImproved) ? e : null;
}

/**
 * Polled feed. Without `since` it returns the current position and, at most, the
 * caller's recent winning `result_approved` (see recentWin) — never rank,
 * qualification or phase history. Each poll also drives the read-triggered
 * recompute.
 */
export async function techEvents(ctx: TechCtx, me: string, since: string | null): Promise<EventsResponse> {
  await current(ctx); // freeze-if-due + live refresh generate events
  const ev = ctx.lifecycle.lc.events;
  if (since === null) {
    const last = await ev.findOne({ competitorId: me }, { sort: { key: -1 } });
    const win = await recentWin(ctx, me);
    return {
      apiVersion: ARENA_TECH_API_VERSION,
      cursor: encodeCursor(last?.key ?? `${new Date(0).toISOString()}#000000`),
      events: win ? [win] : [],
    };
  }
  const key = decodeCursor(since);
  if (!key) throw new TechBadRequest("invalid cursor");
  const docs = (await ev.find({ competitorId: me, key: { $gt: key } }).sort({ key: 1 }).toArray()).slice(0, EVENTS_PAGE);
  const events: ArenaEvent[] = docs.map((d) => d.event);
  return { apiVersion: ARENA_TECH_API_VERSION, cursor: encodeCursor(docs.length ? docs[docs.length - 1].key : key), events };
}
