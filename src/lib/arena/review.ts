/**
 * Data review queue: suspected duplicate jobs, CRM technician names without a
 * verified identity, and competitors without an English display name.
 *
 * Every case is resolved explicitly by a person, with a reason, and every step
 * is kept: cases are versioned and each change appends a review event plus an
 * Arena audit row. Resolutions only produce Arena-side inputs (qualifying-count
 * exclusions, dismissed duplicate groups, identity overrides, display names).
 * Nothing here can edit a CRM job, balance, dispute or financial number; a real
 * duplicate is corrected by the office in the CRM itself.
 *
 *   arena_review_case    one per detected issue, keyed by kind + stable key
 *   arena_review_event   append-only history of every case
 */
import type { IdentityIssueKind, IdentityOverride, JobExclusion } from "./types";
import type { AuditDoc, StoreCollection } from "./config-store";
import { ArenaAuthorizationError, ArenaStateError } from "./config-store";
import { ArenaConfigError } from "./config";

export type ReviewKind = "duplicate_group" | "identity_name" | "display_name";
export type ReviewStatus = "open" | "pending_owner" | "resolved";

export interface DuplicateCaseData {
  weekStart: string;
  date: string;
  competitorId: string | null;
  competitorName: string;
  jobs: { id: string; tech: string; status: string; profit: number }[];
  /** Every job Closed with the same profit: the strongest duplicate signal. */
  likely: boolean;
  /** The group belongs to a competitor whose standing it could change. */
  mayAffectPrizes: boolean;
}
export interface IdentityCaseData {
  issue: IdentityIssueKind;
  crmName: string;
  /** Mapping records that claim this name (never a similarity guess). */
  candidates: string[];
  jobs: number;
  locations: string[];
  /** Shown as a hint only; an admin still has to choose. */
  suggestedCategory: NonCompetitorCategory | null;
}
export interface DisplayNameCaseData {
  competitorId: string;
  currentName: string;
  crmNames: string[];
}
export type CaseData = DuplicateCaseData | IdentityCaseData | DisplayNameCaseData;

export type NonCompetitorCategory = "location_pool" | "subcontractor" | "not_a_person" | "former_technician" | "other";
export const NON_COMPETITOR_CATEGORIES: readonly NonCompetitorCategory[] = [
  "location_pool", "subcontractor", "not_a_person", "former_technician", "other",
];

export type Resolution =
  /** The office corrects the CRM; meanwhile these jobs leave the qualifying count only. */
  | { kind: "duplicate_confirmed"; excludeJobIds: string[] }
  | { kind: "duplicate_dismissed" }
  /** Attach the CRM name to one verified person (a TechNameMapping record). */
  | { kind: "identity_attach"; competitorId: string }
  | { kind: "identity_not_competitor"; category: NonCompetitorCategory }
  | { kind: "display_name"; displayName: string };

export interface ReviewCaseDoc {
  _id: string; // "<kind>:<key>"
  kind: ReviewKind;
  key: string;
  status: ReviewStatus;
  data: CaseData;
  weeks: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  /** The decision in force (resolved) or awaiting the owner (pending_owner). */
  resolution: Resolution | null;
  reason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  version: number;
}

export type ReviewAction = "detected" | "resolved" | "proposed" | "confirmed" | "rejected" | "reopened";
export interface ReviewEventDoc {
  _id: string;
  caseId: string;
  action: ReviewAction;
  by: string;
  at: string;
  reason: string | null;
  before: { status: ReviewStatus; resolution: Resolution | null } | null;
  after: { status: ReviewStatus; resolution: Resolution | null };
}

export interface ReviewStore {
  cases: StoreCollection<ReviewCaseDoc>;
  events: StoreCollection<ReviewEventDoc>;
  audit: StoreCollection<AuditDoc>;
}

export interface ReviewContext {
  store: ReviewStore;
  /** The owner account from the current Arena settings. */
  ownerUserId: () => Promise<string>;
  /** Ids of verified people (TechNameMapping.supabaseUserId). */
  verifiedCompetitorIds: () => Promise<ReadonlySet<string>>;
  now: () => Date;
  newId: (prefix: string) => string;
}

export interface DetectedCase {
  kind: ReviewKind;
  key: string;
  data: CaseData;
  weeks: string[];
}

export const caseId = (kind: ReviewKind, key: string) => `${kind}:${key}`;

const RESOLUTION_KINDS: Record<ReviewKind, Resolution["kind"][]> = {
  duplicate_group: ["duplicate_confirmed", "duplicate_dismissed"],
  identity_name: ["identity_attach", "identity_not_competitor"],
  display_name: ["display_name"],
};

/** Letters from the Latin alphabet (accents allowed), spaces, apostrophes, hyphens, dots. */
const LATIN_NAME = /^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ .'-]{0,38}[A-Za-zÀ-ɏ.]$/;
export const isEnglishDisplayName = (s: string) => LATIN_NAME.test(s) && !/\s{2,}/.test(s);

/** Decisions the owner must confirm when someone else makes them. */
function needsOwner(c: ReviewCaseDoc, r: Resolution): boolean {
  if (r.kind === "identity_attach" || r.kind === "display_name") return true;
  if (c.kind === "duplicate_group") return (c.data as DuplicateCaseData).mayAffectPrizes;
  return false;
}

async function writeEvent(ctx: ReviewContext, e: Omit<ReviewEventDoc, "_id" | "at">) {
  const at = ctx.now().toISOString();
  await ctx.store.events.insertOne({ ...e, _id: ctx.newId("arev"), at });
  await ctx.store.audit.insertOne({
    _id: ctx.newId("aaud"),
    action: `review.${e.action}`,
    target: e.caseId,
    by: e.by,
    at,
    reason: e.reason,
    before: e.before,
    after: e.after,
  });
}

async function getCase(ctx: ReviewContext, id: string): Promise<ReviewCaseDoc> {
  const c = await ctx.store.cases.findOne({ _id: id });
  if (!c) throw new ArenaStateError(`review case ${id} not found`);
  return c;
}

async function saveCase(ctx: ReviewContext, cur: ReviewCaseDoc, patch: Partial<ReviewCaseDoc>) {
  const res = await ctx.store.cases.updateOne(
    { _id: cur._id, version: cur.version },
    { $set: { ...patch, version: cur.version + 1 } },
  );
  if (res.matchedCount !== 1) throw new ArenaStateError("this case changed meanwhile; reload and retry");
}

async function validateResolution(ctx: ReviewContext, c: ReviewCaseDoc, r: Resolution): Promise<Resolution> {
  if (!RESOLUTION_KINDS[c.kind].includes(r.kind))
    throw new ArenaConfigError([`"${r.kind}" does not resolve a ${c.kind.replace("_", " ")} case`]);
  switch (r.kind) {
    case "duplicate_confirmed": {
      const ids = new Set((c.data as DuplicateCaseData).jobs.map((j) => j.id));
      const pick = [...new Set(r.excludeJobIds ?? [])];
      if (pick.length === 0) throw new ArenaConfigError(["choose the duplicate job(s) to exclude"]);
      if (pick.some((id) => !ids.has(id))) throw new ArenaConfigError(["a chosen job is not in this group"]);
      if (pick.length >= ids.size) throw new ArenaConfigError(["at least one job of the group must stay counted"]);
      return { kind: r.kind, excludeJobIds: pick.sort() };
    }
    case "identity_attach": {
      const known = await ctx.verifiedCompetitorIds();
      if (!r.competitorId || !known.has(r.competitorId))
        throw new ArenaConfigError(["attach only to a verified person (an existing name-mapping record)"]);
      return { kind: r.kind, competitorId: r.competitorId };
    }
    case "identity_not_competitor":
      if (!NON_COMPETITOR_CATEGORIES.includes(r.category)) throw new ArenaConfigError(["choose what kind of name this is"]);
      return { kind: r.kind, category: r.category };
    case "display_name": {
      const name = String(r.displayName ?? "").trim().replace(/\s+/g, " ");
      if (!isEnglishDisplayName(name))
        throw new ArenaConfigError(["an English display name uses Latin letters only, 2 to 40 characters"]);
      return { kind: r.kind, displayName: name };
    }
    case "duplicate_dismissed":
      return { kind: r.kind };
  }
}

/**
 * Record newly detected issues. Existing cases keep their status and decision;
 * only their latest snapshot and the weeks they were seen in are refreshed.
 */
export async function syncDetected(ctx: ReviewContext, found: DetectedCase[], by: string): Promise<{ added: number; refreshed: number }> {
  let added = 0, refreshed = 0;
  const at = ctx.now().toISOString();
  for (const d of found) {
    const id = caseId(d.kind, d.key);
    const cur = await ctx.store.cases.findOne({ _id: id });
    if (!cur) {
      await ctx.store.cases.insertOne({
        _id: id, kind: d.kind, key: d.key, status: "open", data: d.data, weeks: [...d.weeks].sort(),
        firstSeenAt: at, lastSeenAt: at, resolution: null, reason: null, decidedBy: null, decidedAt: null,
        confirmedBy: null, confirmedAt: null, version: 1,
      });
      await writeEvent(ctx, { caseId: id, action: "detected", by, reason: null, before: null, after: { status: "open", resolution: null } });
      added++;
    } else {
      const weeks = [...new Set([...cur.weeks, ...d.weeks])].sort();
      await saveCase(ctx, cur, { data: d.data, weeks, lastSeenAt: at });
      refreshed++;
    }
  }
  return { added, refreshed };
}

/** Decide a case. A decision the owner must confirm waits as pending_owner. */
export async function resolveCase(ctx: ReviewContext, id: string, resolution: Resolution, by: string, reason: string): Promise<ReviewCaseDoc> {
  if (!reason?.trim()) throw new ArenaConfigError(["a reason is required"]);
  const c = await getCase(ctx, id);
  if (c.status !== "open") throw new ArenaStateError(`only an open case can be decided (this one is ${c.status.replace("_", " ")})`);
  const r = await validateResolution(ctx, c, resolution);
  const owner = await ctx.ownerUserId();
  const status: ReviewStatus = needsOwner(c, r) && by !== owner ? "pending_owner" : "resolved";
  const at = ctx.now().toISOString();
  const confirmed = status === "resolved" ? { confirmedBy: by, confirmedAt: at } : { confirmedBy: null, confirmedAt: null };
  await saveCase(ctx, c, { status, resolution: r, reason: reason.trim(), decidedBy: by, decidedAt: at, ...confirmed });
  await writeEvent(ctx, {
    caseId: id, action: status === "resolved" ? "resolved" : "proposed", by, reason: reason.trim(),
    before: { status: c.status, resolution: c.resolution }, after: { status, resolution: r },
  });
  return getCase(ctx, id);
}

/** Owner only: accept a pending decision. */
export async function confirmCase(ctx: ReviewContext, id: string, by: string): Promise<ReviewCaseDoc> {
  if (by !== (await ctx.ownerUserId())) throw new ArenaAuthorizationError("only the owner can confirm this decision");
  const c = await getCase(ctx, id);
  if (c.status !== "pending_owner") throw new ArenaStateError("there is no pending decision to confirm");
  const at = ctx.now().toISOString();
  await saveCase(ctx, c, { status: "resolved", confirmedBy: by, confirmedAt: at });
  await writeEvent(ctx, {
    caseId: id, action: "confirmed", by, reason: null,
    before: { status: c.status, resolution: c.resolution }, after: { status: "resolved", resolution: c.resolution },
  });
  return getCase(ctx, id);
}

/** Owner only: send a pending decision back. */
export async function rejectCase(ctx: ReviewContext, id: string, by: string, reason: string): Promise<ReviewCaseDoc> {
  if (by !== (await ctx.ownerUserId())) throw new ArenaAuthorizationError("only the owner can reject this decision");
  if (!reason?.trim()) throw new ArenaConfigError(["a reason is required"]);
  const c = await getCase(ctx, id);
  if (c.status !== "pending_owner") throw new ArenaStateError("there is no pending decision to reject");
  await saveCase(ctx, c, { status: "open", resolution: null, reason: null, decidedBy: null, decidedAt: null });
  await writeEvent(ctx, {
    caseId: id, action: "rejected", by, reason: reason.trim(),
    before: { status: c.status, resolution: c.resolution }, after: { status: "open", resolution: null },
  });
  return getCase(ctx, id);
}

/**
 * Reopen a decided case. Reopening a decision that the owner confirmed (or that
 * needed the owner) is itself owner-only, so nobody can quietly undo it.
 */
export async function reopenCase(ctx: ReviewContext, id: string, by: string, reason: string): Promise<ReviewCaseDoc> {
  if (!reason?.trim()) throw new ArenaConfigError(["a reason is required"]);
  const c = await getCase(ctx, id);
  if (c.status === "open") throw new ArenaStateError("this case is already open");
  const owner = await ctx.ownerUserId();
  if (c.resolution && needsOwner(c, c.resolution) && by !== owner && c.status === "resolved")
    throw new ArenaAuthorizationError("only the owner can reopen a decision the owner confirmed");
  await saveCase(ctx, c, {
    status: "open", resolution: null, reason: null, decidedBy: null, decidedAt: null, confirmedBy: null, confirmedAt: null,
  });
  await writeEvent(ctx, {
    caseId: id, action: "reopened", by, reason: reason.trim(),
    before: { status: c.status, resolution: c.resolution }, after: { status: "open", resolution: null },
  });
  return getCase(ctx, id);
}

export async function caseHistory(ctx: ReviewContext, id: string): Promise<ReviewEventDoc[]> {
  return ctx.store.events.find({ caseId: id }).sort({ at: 1, _id: 1 }).toArray();
}

export interface ReviewDecisions {
  exclusions: JobExclusion[];
  dismissedDuplicateGroups: string[];
  overrides: IdentityOverride[];
  displayNames: Record<string, string>;
}

/** Engine inputs derived from RESOLVED cases only; open and pending ones change nothing. */
export async function reviewDecisions(ctx: ReviewContext): Promise<ReviewDecisions> {
  const done = await ctx.store.cases.find({ status: "resolved" }).sort({ _id: 1 }).toArray();
  const out: ReviewDecisions = { exclusions: [], dismissedDuplicateGroups: [], overrides: [], displayNames: {} };
  for (const c of done) {
    const r = c.resolution;
    if (!r) continue;
    const by = c.confirmedBy ?? c.decidedBy ?? "unknown";
    const at = c.confirmedAt ?? c.decidedAt ?? c.lastSeenAt;
    const reason = c.reason ?? "";
    if (r.kind === "duplicate_confirmed")
      for (const jobId of r.excludeJobIds) out.exclusions.push({ jobId, kind: "duplicate", reason, by, at });
    else if (r.kind === "duplicate_dismissed") out.dismissedDuplicateGroups.push(c.key);
    else if (r.kind === "identity_attach")
      out.overrides.push({ crmName: (c.data as IdentityCaseData).crmName, competitorId: r.competitorId, reason, by, at });
    else if (r.kind === "identity_not_competitor")
      out.overrides.push({ crmName: (c.data as IdentityCaseData).crmName, competitorId: null, reason: `${r.category}: ${reason}`, by, at });
    else if (r.kind === "display_name") out.displayNames[(c.data as DisplayNameCaseData).competitorId] = r.displayName;
  }
  return out;
}

export interface Readiness {
  byKind: Record<ReviewKind, { open: number; pendingOwner: number; resolved: number; likelyOpen?: number }>;
  launchBlocking: number;
  launchReady: boolean;
}

/** Launch gate G2: no open or pending case of any kind. */
export async function readiness(ctx: ReviewContext): Promise<Readiness> {
  const all = await ctx.store.cases.find({}).sort({ _id: 1 }).toArray();
  const byKind = {
    duplicate_group: { open: 0, pendingOwner: 0, resolved: 0, likelyOpen: 0 },
    identity_name: { open: 0, pendingOwner: 0, resolved: 0 },
    display_name: { open: 0, pendingOwner: 0, resolved: 0 },
  } as Readiness["byKind"];
  for (const c of all) {
    const k = byKind[c.kind];
    if (c.status === "open") {
      k.open++;
      if (c.kind === "duplicate_group" && (c.data as DuplicateCaseData).likely) k.likelyOpen = (k.likelyOpen ?? 0) + 1;
    } else if (c.status === "pending_owner") k.pendingOwner++;
    else k.resolved++;
  }
  const launchBlocking = Object.values(byKind).reduce((s, k) => s + k.open + k.pendingOwner, 0);
  return { byKind, launchBlocking, launchReady: launchBlocking === 0 };
}
