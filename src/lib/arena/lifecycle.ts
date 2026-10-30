/**
 * Competition lifecycle after a week starts: live results, freeze, review,
 * owner approval, immutable approved results, and the technician event feed.
 *
 *   arena_snapshot     computed results. `<id>:live` is overwritten in place
 *                      (read-triggered, cached for rules.display.refreshSeconds);
 *                      `<id>:provisional` (at freeze) and `<id>:reconciled:<n>`
 *                      (review re-checks) are insert-only.
 *   arena_result       ONE immutable approved record per competition (_id =
 *                      competition id, insert-only, content-hashed). Never updated.
 *   arena_approval     append-only approval decisions.
 *   arena_tech_event   per-competitor event feed derived from successive snapshots;
 *                      `result_approved` is written ONLY by approveResults().
 *   arena_claim        compare-and-swap leases so one caller recomputes at a time.
 *
 * Status flow: active → provisional (freeze, at Monday 00:00 after the week in the
 * competition timezone) → in_review (an admin opens review) → approved (owner only,
 * not before the review window opens). Nothing here creates payouts, ledger
 * entries or any CRM/finance write: the approved record is the end of the line.
 */
import { createHash } from "node:crypto";
import type { AccountInput, AccountState, CompetitionResult, CompetitorResult } from "./types";
import { accountApprovalProblems, accountBlockers, type AccountMode } from "./accounts";
import type { ArenaEvent, CompetitionPhase } from "./tech-api-contract";
import {
  ArenaAuthorizationError,
  ArenaStateError,
  assertMayApprove,
  currentSettings,
  type CompetitionDoc,
  type RuleVersionDoc,
  type StoreCollection,
  type StoreContext,
} from "./config-store";
import { assertValidRules, canonicalJson } from "./config";
import { weekWindow, type WeekWindow } from "./week";

export type SnapshotKind = "live" | "provisional" | "reconciled";

export interface SnapshotDoc {
  _id: string;
  competitionId: string;
  weekStart: string;
  kind: SnapshotKind;
  n: number;
  computedAt: string;
  ruleVersionId: string;
  rulesHash: string;
  result: CompetitionResult;
}

/** One competitor's line in an approved result (no job ids, no money detail). */
export interface ApprovedStanding {
  competitorId: string;
  displayName: string;
  location: string;
  rank: number;
  score: number;
  eligible: boolean;
  /** Weekly Balance account standing used for this record (absent on records
   *  made before the account rule: treat as "eligible", prizeEligible = eligible). */
  account?: AccountState;
  prizeEligible?: boolean;
  gates: { jobs: boolean; avgTicket: boolean; closingRate: boolean };
  closingRate: number;
  avgTicket: number;
  assignedJobs: number;
  closedJobs: number;
  qualifyingJobs: number;
  closingIndex: number;
  avgIndex: number;
  prizePosition: number | null;
  prizeCents: number;
  wonMostImproved: boolean;
  mostImproved: { baselineScore: number; improvement: number; validWeeks: number } | null;
}

export interface ResultDoc {
  _id: string; // = competition id; one approved result per competition, ever
  competitionId: string;
  weekStart: string;
  snapshotId: string;
  ruleVersionId: string;
  rulesHash: string;
  approvedBy: string;
  approvedAt: string;
  note: string | null;
  standings: ApprovedStanding[];
  awardedCents: number;
  unallocatedCents: number;
  budgetCents: number;
  mostImprovedWinner: string | null;
  /** sha256 of the canonical record above (integrity check). */
  contentHash: string;
}

export interface ApprovalDoc {
  _id: string;
  competitionId: string;
  action: "approve";
  snapshotId: string;
  by: string;
  at: string;
  note: string | null;
  winners: { competitorId: string; position: number | null; prizeCents: number; mostImproved: boolean }[];
  awardedCents: number;
}

export interface TechEventDoc {
  _id: string;
  competitorId: string;
  competitionId: string;
  /** Sortable feed position: `<ISO at>#<seq>`. The cursor is an encoding of it. */
  key: string;
  at: string;
  event: ArenaEvent;
}

export interface ClaimDoc {
  _id: string;
  until: string;
}

export interface LifecycleCollections {
  snapshots: StoreCollection<SnapshotDoc>;
  results: StoreCollection<ResultDoc>;
  approvals: StoreCollection<ApprovalDoc>;
  events: StoreCollection<TechEventDoc>;
  claims: StoreCollection<ClaimDoc>;
}

export interface LifecycleContext {
  config: StoreContext;
  lc: LifecycleCollections;
  /** Runs the engine for one week on the CRM data (read-only), with account
   *  standings checked in `mode` (live: provisional, last known on failure). */
  compute: (weekStart: string, rv: RuleVersionDoc, mode: AccountMode) => Promise<CompetitionResult>;
  /** Fresh/live Weekly Balance account check (never throws; failure = unverified). */
  checkAccounts: (ids: string[], mode: AccountMode) => Promise<Record<string, AccountInput>>;
  /** True only on the local dev stack (ARENA_DEV_STACK=1). */
  devStack: boolean;
}

const CLAIM_LEASE_MS = 30_000;
const SECOND_MS = 1000;

const now = (ctx: LifecycleContext) => ctx.config.now();
const iso = (ctx: LifecycleContext) => now(ctx).toISOString();

async function audit(ctx: LifecycleContext, action: string, target: string, by: string, reason: string | null, before: unknown, after: unknown) {
  await ctx.config.store.audit.insertOne({ _id: ctx.config.newId("aaud"), action, target, by, at: iso(ctx), reason, before, after });
}

export async function getCompetitionDoc(ctx: LifecycleContext, id: string): Promise<CompetitionDoc> {
  const c = await ctx.config.store.competitions.findOne({ _id: id });
  if (!c) throw new ArenaStateError(`competition ${id} not found`);
  return c;
}

export async function ruleVersionOf(ctx: LifecycleContext, c: CompetitionDoc): Promise<RuleVersionDoc> {
  const rv = await ctx.config.store.ruleVersions.findOne({ _id: c.ruleVersionId });
  if (!rv) throw new ArenaStateError(`rule version ${c.ruleVersionId} missing`);
  return rv;
}

export const windowOf = (c: CompetitionDoc, rv: RuleVersionDoc): WeekWindow =>
  weekWindow(c.weekStart, rv.rules.timezone, rv.rules.review);

async function transition(ctx: LifecycleContext, cur: CompetitionDoc, patch: Partial<CompetitionDoc>) {
  const res = await ctx.config.store.competitions.updateOne(
    { _id: cur._id, status: cur.status, ruleVersionId: cur.ruleVersionId },
    { $set: { ...patch, updatedAt: iso(ctx) } },
  );
  if (res.matchedCount !== 1) throw new ArenaStateError("the competition changed meanwhile; reload and retry");
}

/** Compare-and-swap lease. Returns a release function, or null when someone else holds it. */
export async function tryClaim(ctx: LifecycleContext, id: string): Promise<(() => Promise<void>) | null> {
  const t = now(ctx);
  const until = new Date(t.getTime() + CLAIM_LEASE_MS).toISOString();
  const cur = await ctx.lc.claims.findOne({ _id: id });
  if (!cur) {
    try {
      await ctx.lc.claims.insertOne({ _id: id, until });
    } catch {
      return null; // somebody inserted it first
    }
  } else {
    if (cur.until > t.toISOString()) return null;
    const r = await ctx.lc.claims.updateOne({ _id: id, until: cur.until }, { $set: { until } });
    if (r.matchedCount !== 1) return null;
  }
  return async () => {
    await ctx.lc.claims.updateOne({ _id: id, until }, { $set: { until: new Date(0).toISOString() } });
  };
}

// ── phase ──────────────────────────────────────────────────────────────────

/** The technician-facing phase of a competition at `at`. */
export function phaseOf(c: CompetitionDoc, w: WeekWindow, at: Date): CompetitionPhase {
  switch (c.status) {
    case "draft":
    case "scheduled":
      return "upcoming";
    case "active":
    case "suspended":
      return at < w.closesAt ? "live" : "frozen";
    case "provisional":
      return "frozen";
    case "in_review":
      return "in_review";
    case "approved":
      return "approved";
    case "cancelled":
      return "cancelled";
  }
}

// ── events (pure) ──────────────────────────────────────────────────────────

const GATE_KEYS = ["jobs", "avgTicket", "closingRate"] as const;

/** Events implied by moving from `prev` to `next` results, per competitor. */
export function diffEvents(prev: CompetitionResult | null, next: CompetitionResult, at: string): Map<string, ArenaEvent[]> {
  const out = new Map<string, ArenaEvent[]>();
  if (!prev) return out; // first snapshot: nothing to compare against
  const before = new Map(prev.results.map((r) => [r.competitorId, r]));
  for (const r of next.results) {
    const p = before.get(r.competitorId);
    const ev: ArenaEvent[] = [];
    if (!p || p.rank !== r.rank) ev.push({ kind: "rank_changed", at, from: p?.rank ?? null, to: r.rank });
    if (r.eligible && !p?.eligible) ev.push({ kind: "qualified", at, gate: "all" });
    for (const g of GATE_KEYS) {
      const was = p?.gates[g].met ?? false;
      const is = r.gates[g].met;
      if (is && !was && !r.eligible) ev.push({ kind: "qualified", at, gate: g });
      if (!is && was) ev.push({ kind: "lost_qualification", at, gate: g });
    }
    if (r.prizePosition !== null && (p?.prizePosition ?? null) === null)
      ev.push({ kind: "entered_prize_zone", at, position: r.prizePosition });
    if (ev.length) out.set(r.competitorId, ev);
  }
  return out;
}

async function writeEvents(ctx: LifecycleContext, competitionId: string, at: string, byCompetitor: Map<string, ArenaEvent[]>) {
  let seq = 0;
  for (const [competitorId, events] of byCompetitor) {
    for (const event of events) {
      const key = `${at}#${String(seq++).padStart(6, "0")}`;
      try {
        await ctx.lc.events.insertOne({ _id: `${competitorId}|${key}`, competitorId, competitionId, key, at, event });
      } catch {
        /* the same event was already written */
      }
    }
  }
}

function phaseEvents(result: CompetitionResult, phase: CompetitionPhase, at: string): Map<string, ArenaEvent[]> {
  return new Map(result.results.map((r) => [r.competitorId, [{ kind: "phase_changed", at, phase } as ArenaEvent]]));
}

// ── live snapshot ──────────────────────────────────────────────────────────

const liveId = (id: string) => `${id}:live`;
const provisionalId = (id: string) => `${id}:provisional`;

/**
 * The live snapshot of a running competition, recomputed when older than the
 * rules' refresh interval or computed under a different rule version (an owner
 * amendment takes effect on the next read). One caller recomputes; the others
 * get the cached copy.
 */
export async function liveSnapshot(ctx: LifecycleContext, c: CompetitionDoc, rv: RuleVersionDoc): Promise<SnapshotDoc | null> {
  const cur = await ctx.lc.snapshots.findOne({ _id: liveId(c._id) });
  const fresh =
    cur &&
    cur.ruleVersionId === rv._id &&
    now(ctx).getTime() - Date.parse(cur.computedAt) < rv.rules.display.refreshSeconds * SECOND_MS;
  if (fresh) return cur;
  if (c.status !== "active" && c.status !== "suspended") return cur;
  const release = await tryClaim(ctx, `live:${c._id}`);
  if (!release) return cur ?? null;
  try {
    const result = await ctx.compute(c.weekStart, rv, "live");
    const at = iso(ctx);
    const doc: SnapshotDoc = {
      _id: liveId(c._id), competitionId: c._id, weekStart: c.weekStart, kind: "live", n: (cur?.n ?? 0) + 1,
      computedAt: at, ruleVersionId: rv._id, rulesHash: rv.rulesHash, result,
    };
    if (cur) await ctx.lc.snapshots.updateOne({ _id: doc._id }, { $set: doc });
    else await ctx.lc.snapshots.insertOne(doc);
    await writeEvents(ctx, c._id, at, cur ? diffEvents(cur.result, result, at) : phaseEvents(result, "live", at));
    return doc;
  } finally {
    await release();
  }
}

// ── freeze ─────────────────────────────────────────────────────────────────

/**
 * Freeze a finished week: compute the provisional snapshot and move the
 * competition to `provisional`. Refused before the week has ended — except the
 * dev-stack demo action (`devEarlyClose`), which is owner-only and refused
 * unless ARENA_DEV_STACK=1.
 */
export async function freezeCompetition(
  ctx: LifecycleContext,
  id: string,
  by: string,
  opts: { devEarlyClose?: boolean } = {},
): Promise<SnapshotDoc> {
  const c = await getCompetitionDoc(ctx, id);
  if (c.status !== "active" && c.status !== "suspended")
    throw new ArenaStateError(`only a running competition can be frozen (is ${c.status})`);
  const rv = await ruleVersionOf(ctx, c);
  const w = windowOf(c, rv);
  if (opts.devEarlyClose) {
    if (!ctx.devStack) throw new ArenaAuthorizationError("“Freeze now” exists only on the local dev stack");
    const s = await currentSettings(ctx.config);
    if (by !== s.ownerUserId) throw new ArenaAuthorizationError("only the owner can freeze a week early (dev)");
  } else if (now(ctx) < w.closesAt) {
    throw new ArenaStateError("a week freezes only after Sunday ends in the competition timezone");
  }
  const release = await tryClaim(ctx, `freeze:${id}`);
  if (!release) throw new ArenaStateError("the week is being frozen right now; reload in a moment");
  try {
    const result = await ctx.compute(c.weekStart, rv, "fresh");
    const at = iso(ctx);
    const snap: SnapshotDoc = {
      _id: provisionalId(id), competitionId: id, weekStart: c.weekStart, kind: "provisional", n: 1,
      computedAt: at, ruleVersionId: rv._id, rulesHash: rv.rulesHash, result,
    };
    try {
      await ctx.lc.snapshots.insertOne(snap);
    } catch {
      throw new ArenaStateError("this week is already frozen");
    }
    await transition(ctx, c, { status: "provisional", frozenAt: at, ...(opts.devEarlyClose ? { devEarlyClose: true } : {}) });
    await audit(ctx, opts.devEarlyClose ? "competition.freeze.dev" : "competition.freeze", id, by, null, c.status,
      { status: "provisional", snapshotId: snap._id, rulesHash: rv.rulesHash });
    const live = await ctx.lc.snapshots.findOne({ _id: liveId(id) });
    const changes = diffEvents(live?.result ?? null, result, at);
    for (const [k, v] of phaseEvents(result, "frozen", at)) changes.set(k, [...(changes.get(k) ?? []), ...v]);
    await writeEvents(ctx, id, at, changes);
    return snap;
  } finally {
    await release();
  }
}

/** Read-triggered freeze: the first read after Sunday ends freezes the week. */
export async function freezeIfDue(ctx: LifecycleContext, c: CompetitionDoc): Promise<CompetitionDoc> {
  if (c.status !== "active") return c;
  const rv = await ruleVersionOf(ctx, c);
  if (now(ctx) < windowOf(c, rv).closesAt) return c;
  try {
    await freezeCompetition(ctx, c._id, "system");
  } catch (e) {
    if (!(e instanceof ArenaStateError)) throw e; // another caller froze it
  }
  return getCompetitionDoc(ctx, c._id);
}

/**
 * Safety net for the daily cron: freeze every running week whose Sunday has
 * ended, even if nobody opened it. Idempotent — an already frozen (or
 * reviewed/approved) week is left alone, and a week still running is untouched.
 */
export async function freezeDueCompetitions(ctx: LifecycleContext): Promise<{ checked: number; frozen: string[]; notDue: number }> {
  const running = await ctx.config.store.competitions.find({ status: "active" }).sort({ weekStart: 1 }).toArray();
  const frozen: string[] = [];
  let notDue = 0;
  for (const c of running) {
    const after = await freezeIfDue(ctx, c);
    if (after.status === "active") notDue++;
    else frozen.push(c._id);
  }
  return { checked: running.length, frozen, notDue };
}

// ── review ─────────────────────────────────────────────────────────────────

async function latestReconciled(ctx: LifecycleContext, id: string): Promise<SnapshotDoc | null> {
  return ctx.lc.snapshots.findOne({ competitionId: id, kind: "reconciled" }, { sort: { n: -1 } });
}

/** The snapshot an admin is reviewing (latest re-check, else the provisional one). */
export async function reviewSnapshot(ctx: LifecycleContext, id: string): Promise<SnapshotDoc | null> {
  return (await latestReconciled(ctx, id)) ?? (await ctx.lc.snapshots.findOne({ _id: provisionalId(id) }));
}

async function reconcileSnapshot(ctx: LifecycleContext, c: CompetitionDoc, rv: RuleVersionDoc, by: string): Promise<SnapshotDoc> {
  const prev = await latestReconciled(ctx, c._id);
  const n = (prev?.n ?? 0) + 1;
  const result = await ctx.compute(c.weekStart, rv, "fresh");
  const snap: SnapshotDoc = {
    _id: `${c._id}:reconciled:${n}`, competitionId: c._id, weekStart: c.weekStart, kind: "reconciled", n,
    computedAt: iso(ctx), ruleVersionId: rv._id, rulesHash: rv.rulesHash, result,
  };
  await ctx.lc.snapshots.insertOne(snap);
  await audit(ctx, "competition.reconcile", c._id, by, null, prev?._id ?? provisionalId(c._id), snap._id);
  return snap;
}

/** Open the review: provisional → in_review, with a fresh re-check of the CRM data (late entries). */
export async function openReview(ctx: LifecycleContext, id: string, by: string): Promise<SnapshotDoc> {
  const c = await getCompetitionDoc(ctx, id);
  if (c.status !== "provisional") throw new ArenaStateError(`only a frozen week can go to review (is ${c.status})`);
  const rv = await ruleVersionOf(ctx, c);
  const snap = await reconcileSnapshot(ctx, c, rv, by);
  const at = iso(ctx);
  await transition(ctx, c, { status: "in_review", reviewOpenedAt: at });
  await audit(ctx, "competition.review.open", id, by, null, "provisional", "in_review");
  await writeEvents(ctx, id, at, phaseEvents(snap.result, "in_review", at));
  return snap;
}

/** Re-check the CRM data during review (late Sunday entries, corrections). */
export async function reconcileCompetition(ctx: LifecycleContext, id: string, by: string): Promise<SnapshotDoc> {
  const c = await getCompetitionDoc(ctx, id);
  if (c.status !== "in_review") throw new ArenaStateError(`only a week in review can be re-checked (is ${c.status})`);
  return reconcileSnapshot(ctx, c, await ruleVersionOf(ctx, c), by);
}

export interface DiffSide { rank: number; score: number; eligible: boolean; account: AccountState | null; prizeEligible: boolean; prizeCents: number }

export interface ReviewDiffRow {
  competitorId: string;
  displayName: string;
  before: DiffSide | null;
  after: DiffSide | null;
}

/** Provisional vs. the snapshot under review, rows that differ only. */
export function reviewDiff(provisional: CompetitionResult | null, current: CompetitionResult | null): ReviewDiffRow[] {
  const pick = (r?: CompetitorResult): DiffSide | null =>
    r
      ? { rank: r.rank, score: r.score, eligible: r.eligible, account: r.account?.state ?? null, prizeEligible: r.prizeEligible ?? r.eligible, prizeCents: r.prizeCents }
      : null;
  const a = new Map((provisional?.results ?? []).map((r) => [r.competitorId, r]));
  const b = new Map((current?.results ?? []).map((r) => [r.competitorId, r]));
  const out: ReviewDiffRow[] = [];
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const before = pick(a.get(id));
    const after = pick(b.get(id));
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    out.push({ competitorId: id, displayName: (b.get(id) ?? a.get(id))!.displayName, before, after });
  }
  return out.sort((x, y) => (x.after?.rank ?? Infinity) - (y.after?.rank ?? Infinity));
}

// ── approval ───────────────────────────────────────────────────────────────

export function approvalBlockers(result: CompetitionResult): string[] {
  const p: string[] = [];
  const dup = result.duplicateGroups.filter((g) => g.mayAffectPrizes).length;
  if (dup) p.push(`${dup} suspected duplicate group(s) could change prizes; resolve them in the review queue and re-check`);
  p.push(...accountBlockers(result));
  return p;
}

export function toStanding(r: CompetitorResult): ApprovedStanding {
  return {
    competitorId: r.competitorId, displayName: r.displayName, location: r.location, rank: r.rank, score: r.score,
    eligible: r.eligible, account: r.account?.state ?? "eligible", prizeEligible: r.prizeEligible ?? r.eligible,
    gates: { jobs: r.gates.jobs.met, avgTicket: r.gates.avgTicket.met, closingRate: r.gates.closingRate.met },
    closingRate: r.closingRate, avgTicket: r.avgTicket, assignedJobs: r.assignedJobs, closedJobs: r.closedJobs,
    qualifyingJobs: r.qualifyingJobs, closingIndex: r.closingIndex, avgIndex: r.avgIndex,
    prizePosition: r.prizePosition, prizeCents: r.prizeCents, wonMostImproved: r.wonMostImproved, mostImproved: r.mostImproved,
  };
}

export const resultContentHash = (doc: Omit<ResultDoc, "contentHash">) =>
  createHash("sha256").update(canonicalJson(doc)).digest("hex");

/**
 * Approve the winners. OWNER ONLY (the settings owner, who must also be on the
 * approver list), only for a week in review, not before the review window
 * opens (Tuesday 12:00 in the competition timezone by default), only the exact
 * snapshot the owner looked at, only when the rules still validate against
 * the budget ceiling, and only when every Weekly Balance account standing is
 * still what the snapshot recorded (checked again now; see accounts.ts). Writes one immutable result record; a second approval is
 * refused by the unique id. Creates NO payout or ledger entry.
 */
export async function approveResults(
  ctx: LifecycleContext,
  id: string,
  by: string,
  input: { snapshotId: string; note?: string | null },
): Promise<ResultDoc> {
  const s = await currentSettings(ctx.config);
  if (by !== s.ownerUserId) throw new ArenaAuthorizationError("only the owner can approve Arena results");
  await assertMayApprove(ctx.config, by);
  const c = await getCompetitionDoc(ctx, id);
  if (c.status === "approved") throw new ArenaStateError("these results are already approved and can never change");
  if (c.status !== "in_review") throw new ArenaStateError(`only a week in review can be approved (is ${c.status})`);
  const rv = await ruleVersionOf(ctx, c);
  const w = windowOf(c, rv);
  const early = c.devEarlyClose === true && ctx.devStack;
  if (now(ctx) < w.approvalOpensAt && !early)
    throw new ArenaStateError(`approval opens ${w.approvalOpensAt.toISOString()} (review window)`);
  const snap = await reviewSnapshot(ctx, id);
  if (!snap || snap._id !== input.snapshotId)
    throw new ArenaStateError("the results changed since you opened them; reload and review again");
  if (snap.ruleVersionId !== rv._id) throw new ArenaStateError("the rules changed after this snapshot; re-check first");
  assertValidRules(rv.rules, { knownStatuses: ctx.config.knownStatuses, ceilingCents: s.budgetCeilingCents });
  const blockers = approvalBlockers(snap.result);
  if (blockers.length) throw new ArenaStateError(blockers.join("; "));
  // Account eligibility is checked again NOW: the owner approves exactly the
  // account standings that were reviewed, or nothing.
  const fresh = await ctx.checkAccounts(snap.result.results.map((x) => x.competitorId), "fresh");
  const accountProblems = accountApprovalProblems(snap.result, fresh);
  if (accountProblems.length) {
    await audit(ctx, "competition.approve.refused", id, by, accountProblems.join("; "), snap._id, null);
    throw new ArenaStateError(accountProblems.join("; "));
  }
  const r = snap.result;
  if (r.awardedCents > rv.rules.prizes.budgetCents) throw new ArenaStateError("awarded prizes exceed the budget");
  const holders = r.results.filter((x) => x.prizeCents > 0);
  if (holders.some((x) => x.prizePosition !== null && x.wonMostImproved)) throw new ArenaStateError("overlapping individual prizes");

  const at = iso(ctx);
  const note = input.note?.trim() || null;
  const base: Omit<ResultDoc, "contentHash"> = {
    _id: id, competitionId: id, weekStart: c.weekStart, snapshotId: snap._id, ruleVersionId: rv._id, rulesHash: rv.rulesHash,
    approvedBy: by, approvedAt: at, note, standings: r.results.map(toStanding), awardedCents: r.awardedCents,
    unallocatedCents: r.unallocatedCents, budgetCents: rv.rules.prizes.budgetCents, mostImprovedWinner: r.mostImprovedWinner,
  };
  const doc: ResultDoc = { ...base, contentHash: resultContentHash(base) };
  try {
    await ctx.lc.results.insertOne(doc);
  } catch {
    throw new ArenaStateError("these results are already approved and can never change");
  }
  await ctx.lc.approvals.insertOne({
    _id: ctx.config.newId("aapr"), competitionId: id, action: "approve", snapshotId: snap._id, by, at, note,
    winners: holders.map((x) => ({ competitorId: x.competitorId, position: x.prizePosition, prizeCents: x.prizeCents, mostImproved: x.wonMostImproved })),
    awardedCents: r.awardedCents,
  });
  await transition(ctx, c, { status: "approved", approvedAt: at });
  await audit(ctx, "competition.approve", id, by, note, "in_review", { status: "approved", snapshotId: snap._id, awardedCents: r.awardedCents, contentHash: doc.contentHash });
  // The ONLY place a result_approved event is created.
  const evs = new Map<string, ArenaEvent[]>();
  for (const x of r.results)
    evs.set(x.competitorId, [
      { kind: "phase_changed", at, phase: "approved" },
      { kind: "result_approved", at, weekStart: c.weekStart, prizeCents: x.prizeCents, position: x.prizePosition, mostImproved: x.wonMostImproved },
    ]);
  await writeEvents(ctx, id, at, evs);
  return doc;
}

// ── selection for technicians ──────────────────────────────────────────────

const WEEK_MS = 7 * 24 * 3600 * SECOND_MS;

/**
 * The competition a technician sees now: the latest started week (shown for up
 * to a week after it ends, so the result stays visible), else the next
 * scheduled one as "upcoming". Draft/scheduled weeks that were never started
 * and have already ended are skipped.
 */
export async function currentCompetition(ctx: LifecycleContext): Promise<{ c: CompetitionDoc; rv: RuleVersionDoc; w: WeekWindow } | null> {
  const all = await ctx.config.store.competitions.find({}).sort({ weekStart: -1 }).toArray();
  const t = now(ctx);
  let upcoming: { c: CompetitionDoc; rv: RuleVersionDoc; w: WeekWindow } | null = null;
  for (const c of all) {
    const rv = await ruleVersionOf(ctx, c);
    const w = windowOf(c, rv);
    if (w.startsAt > t) {
      if (c.status === "scheduled") upcoming = { c, rv, w };
      continue;
    }
    if (c.status === "draft") continue;
    if (c.status === "scheduled") {
      if (t < w.closesAt) return { c, rv, w };
      continue;
    }
    if (t.getTime() >= w.closesAt.getTime() + WEEK_MS && c.status !== "provisional" && c.status !== "in_review") return upcoming;
    return { c, rv, w };
  }
  return upcoming;
}
