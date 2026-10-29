/**
 * Database-backed, versioned Arena configuration.
 *
 *   arena_settings          owner-level bounds (budget ceiling, approvers) — versioned
 *   arena_config_template   reusable named rule sets — every save is a new version
 *   arena_rule_version      immutable rule snapshots a competition runs on
 *   arena_competition       one per Monday-start week
 *   arena_notice            participant-visible notices (mid-week amendments)
 *   arena_audit             append-only log of every configuration action
 *
 * Collections are injected (a narrow subset of the Mongo driver API) so this is
 * testable against an in-memory double. Rule versions, notices and audit rows
 * are insert-only; nothing here ever deletes.
 */
import type { ArenaRules, ArenaSettings } from "./types";
import { ArenaConfigError, assertValidRules, cloneRules, rulesHash, validateSettings } from "./config";
import { isMonday, weekWindow, addDays } from "./week";

export type Filter = Record<string, unknown>;
export interface StoreCollection<T> {
  insertOne(doc: T): Promise<unknown>;
  findOne(filter: Filter, options?: { sort?: Record<string, 1 | -1> }): Promise<T | null>;
  find(filter: Filter): { sort(s: Record<string, 1 | -1>): { toArray(): Promise<T[]> } };
  updateOne(filter: Filter, update: { $set: Partial<T> }): Promise<{ matchedCount: number }>;
}

export type CompetitionStatus =
  | "draft"
  | "scheduled"
  | "active"
  | "suspended"
  | "provisional"
  | "in_review"
  | "approved"
  | "cancelled";

export interface SettingsDoc extends ArenaSettings {
  _id: string; // "settings:v<version>"
  version: number;
  current: boolean;
  reason: string;
  by: string;
  at: string;
}
export interface TemplateDoc {
  _id: string; // "<templateId>:v<version>"
  templateId: string;
  name: string;
  version: number;
  current: boolean;
  rules: ArenaRules;
  rulesHash: string;
  by: string;
  at: string;
}
export interface RuleVersionDoc {
  _id: string; // "<competitionId>:r<n>"
  competitionId: string;
  n: number;
  rules: ArenaRules;
  rulesHash: string;
  source: { kind: "template" | "previous_week" | "manual" | "edit" | "amendment"; ref?: string };
  by: string;
  at: string;
}
export interface CompetitionDoc {
  _id: string; // "arena_<weekStart>"
  weekStart: string;
  status: CompetitionStatus;
  ruleVersionId: string;
  ruleVersionN: number;
  lockedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
export interface NoticeDoc {
  _id: string;
  competitionId: string;
  kind: "rules_amended" | "suspended" | "resumed";
  message: string;
  ruleVersionId: string | null;
  by: string;
  at: string;
}
export interface AuditDoc {
  _id: string;
  action: string;
  target: string;
  by: string;
  at: string;
  reason: string | null;
  before: unknown;
  after: unknown;
}

export interface ArenaStore {
  settings: StoreCollection<SettingsDoc>;
  templates: StoreCollection<TemplateDoc>;
  ruleVersions: StoreCollection<RuleVersionDoc>;
  competitions: StoreCollection<CompetitionDoc>;
  notices: StoreCollection<NoticeDoc>;
  audit: StoreCollection<AuditDoc>;
}

export interface StoreContext {
  store: ArenaStore;
  /** Live CRM JobStatus ids, for validating qualifying statuses. */
  knownStatuses: readonly string[];
  now: () => Date;
  newId: (prefix: string) => string;
}

export class ArenaAuthorizationError extends Error {}
export class ArenaStateError extends Error {}

/** Statuses in which rules may be edited normally. */
const EDITABLE: CompetitionStatus[] = ["draft", "scheduled"];

async function writeAudit(ctx: StoreContext, a: Omit<AuditDoc, "_id" | "at">) {
  await ctx.store.audit.insertOne({ ...a, _id: ctx.newId("aaud"), at: ctx.now().toISOString() });
}

export async function currentSettings(ctx: StoreContext): Promise<SettingsDoc> {
  const s = await ctx.store.settings.findOne({ current: true });
  if (!s) throw new ArenaStateError("Arena settings have not been initialised");
  return s;
}

/** One-time initialisation; refuses if settings already exist. */
export async function initSettings(ctx: StoreContext, s: ArenaSettings, by: string): Promise<SettingsDoc> {
  if (await ctx.store.settings.findOne({ current: true })) throw new ArenaStateError("settings already initialised");
  const problems = validateSettings(s);
  if (problems.length) throw new ArenaConfigError(problems);
  const doc: SettingsDoc = { ...s, _id: "settings:v1", version: 1, current: true, reason: "initial", by, at: ctx.now().toISOString() };
  await ctx.store.settings.insertOne(doc);
  await writeAudit(ctx, { action: "settings.init", target: doc._id, by, reason: "initial", before: null, after: s });
  return doc;
}

/** Owner-only: change the budget ceiling or the approver list. */
export async function updateSettings(
  ctx: StoreContext,
  patch: Partial<Pick<ArenaSettings, "budgetCeilingCents" | "approverUserIds">>,
  by: string,
  reason: string,
): Promise<SettingsDoc> {
  const cur = await currentSettings(ctx);
  if (by !== cur.ownerUserId) throw new ArenaAuthorizationError("only the owner can change Arena settings");
  if (!reason.trim()) throw new ArenaConfigError(["a reason is required"]);
  const next: ArenaSettings = {
    budgetCeilingCents: patch.budgetCeilingCents ?? cur.budgetCeilingCents,
    ownerUserId: cur.ownerUserId,
    approverUserIds: patch.approverUserIds ?? cur.approverUserIds,
  };
  const problems = validateSettings(next);
  if (problems.length) throw new ArenaConfigError(problems);
  const version = cur.version + 1;
  const doc: SettingsDoc = { ...next, _id: `settings:v${version}`, version, current: true, reason, by, at: ctx.now().toISOString() };
  await ctx.store.settings.updateOne({ _id: cur._id, current: true }, { $set: { current: false } });
  await ctx.store.settings.insertOne(doc);
  await writeAudit(ctx, { action: "settings.update", target: doc._id, by, reason, before: stripMeta(cur), after: next });
  return doc;
}

function stripMeta(s: SettingsDoc): ArenaSettings {
  return { budgetCeilingCents: s.budgetCeilingCents, ownerUserId: s.ownerUserId, approverUserIds: s.approverUserIds };
}

async function validate(ctx: StoreContext, rules: ArenaRules) {
  const s = await currentSettings(ctx);
  assertValidRules(rules, { knownStatuses: ctx.knownStatuses, ceilingCents: s.budgetCeilingCents });
}

// ── templates ──────────────────────────────────────────────────────────────

export async function saveTemplate(
  ctx: StoreContext,
  t: { templateId: string; name: string; rules: ArenaRules },
  by: string,
): Promise<TemplateDoc> {
  await validate(ctx, t.rules);
  const cur = await ctx.store.templates.findOne({ templateId: t.templateId, current: true });
  const version = (cur?.version ?? 0) + 1;
  const doc: TemplateDoc = {
    _id: `${t.templateId}:v${version}`,
    templateId: t.templateId,
    name: t.name,
    version,
    current: true,
    rules: cloneRules(t.rules),
    rulesHash: rulesHash(t.rules),
    by,
    at: ctx.now().toISOString(),
  };
  if (cur) await ctx.store.templates.updateOne({ _id: cur._id, current: true }, { $set: { current: false } });
  await ctx.store.templates.insertOne(doc);
  await writeAudit(ctx, { action: "template.save", target: doc._id, by, reason: null, before: cur?.rules ?? null, after: doc.rules });
  return doc;
}

// ── competitions ───────────────────────────────────────────────────────────

const competitionId = (weekStart: string) => `arena_${weekStart}`;

async function insertRuleVersion(
  ctx: StoreContext,
  compId: string,
  rules: ArenaRules,
  source: RuleVersionDoc["source"],
  by: string,
): Promise<RuleVersionDoc> {
  const last = await ctx.store.ruleVersions.findOne({ competitionId: compId }, { sort: { n: -1 } });
  const n = (last?.n ?? 0) + 1;
  const doc: RuleVersionDoc = {
    _id: `${compId}:r${n}`,
    competitionId: compId,
    n,
    rules: cloneRules(rules),
    rulesHash: rulesHash(rules),
    source,
    by,
    at: ctx.now().toISOString(),
  };
  await ctx.store.ruleVersions.insertOne(doc);
  return doc;
}

/**
 * Create a competition for a future (or current, not yet locked) week from a
 * template, a copy of the previous week's rules, or explicit rules.
 */
export async function createCompetition(
  ctx: StoreContext,
  weekStart: string,
  from: { template: string } | { copyPreviousWeek: true } | { rules: ArenaRules },
  by: string,
): Promise<CompetitionDoc> {
  if (!isMonday(weekStart)) throw new ArenaConfigError([`a competition week must start on a Monday (${weekStart})`]);
  const id = competitionId(weekStart);
  if (await ctx.store.competitions.findOne({ _id: id })) throw new ArenaStateError(`a competition already exists for ${weekStart}`);

  let rules: ArenaRules;
  let source: RuleVersionDoc["source"];
  if ("template" in from) {
    const t = await ctx.store.templates.findOne({ templateId: from.template, current: true });
    if (!t) throw new ArenaStateError(`template "${from.template}" not found`);
    rules = t.rules;
    source = { kind: "template", ref: t._id };
  } else if ("copyPreviousWeek" in from) {
    const prev = await ctx.store.competitions.findOne({ _id: competitionId(addDays(weekStart, -7)) });
    if (!prev) throw new ArenaStateError("there is no previous week to copy");
    const rv = await ctx.store.ruleVersions.findOne({ _id: prev.ruleVersionId });
    if (!rv) throw new ArenaStateError("previous week's rules are missing");
    rules = rv.rules;
    source = { kind: "previous_week", ref: rv._id };
  } else {
    rules = from.rules;
    source = { kind: "manual" };
  }
  await validate(ctx, rules);
  const rv = await insertRuleVersion(ctx, id, rules, source, by);
  const at = ctx.now().toISOString();
  const doc: CompetitionDoc = {
    _id: id,
    weekStart,
    status: "draft",
    ruleVersionId: rv._id,
    ruleVersionN: rv.n,
    lockedAt: null,
    createdBy: by,
    createdAt: at,
    updatedAt: at,
  };
  await ctx.store.competitions.insertOne(doc);
  await writeAudit(ctx, { action: "competition.create", target: id, by, reason: null, before: null, after: { ruleVersionId: rv._id, source } });
  return doc;
}

async function getCompetition(ctx: StoreContext, id: string): Promise<CompetitionDoc> {
  const c = await ctx.store.competitions.findOne({ _id: id });
  if (!c) throw new ArenaStateError(`competition ${id} not found`);
  return c;
}

async function setCompetition(ctx: StoreContext, cur: CompetitionDoc, patch: Partial<CompetitionDoc>) {
  // Optimistic guard: the update applies only if nobody changed the competition meanwhile.
  const res = await ctx.store.competitions.updateOne(
    { _id: cur._id, status: cur.status, ruleVersionId: cur.ruleVersionId },
    { $set: { ...patch, updatedAt: ctx.now().toISOString() } },
  );
  if (res.matchedCount !== 1) throw new ArenaStateError("the competition changed meanwhile; reload and retry");
}

/** Edit a draft/scheduled competition's rules: always a NEW version; old ones are kept. */
export async function updateDraftRules(ctx: StoreContext, id: string, rules: ArenaRules, by: string): Promise<RuleVersionDoc> {
  const c = await getCompetition(ctx, id);
  if (!EDITABLE.includes(c.status))
    throw new ArenaStateError(`rules of a ${c.status} competition are locked; use an owner amendment`);
  await validate(ctx, rules);
  const before = await ctx.store.ruleVersions.findOne({ _id: c.ruleVersionId });
  const rv = await insertRuleVersion(ctx, id, rules, { kind: "edit", ref: c.ruleVersionId }, by);
  await setCompetition(ctx, c, { ruleVersionId: rv._id, ruleVersionN: rv.n });
  await writeAudit(ctx, { action: "competition.rules.edit", target: id, by, reason: null, before: before?.rules ?? null, after: rv.rules });
  return rv;
}

export async function scheduleCompetition(ctx: StoreContext, id: string, by: string): Promise<void> {
  const c = await getCompetition(ctx, id);
  if (c.status !== "draft") throw new ArenaStateError(`only a draft can be scheduled (is ${c.status})`);
  const rv = await ctx.store.ruleVersions.findOne({ _id: c.ruleVersionId });
  await validate(ctx, rv!.rules);
  await setCompetition(ctx, c, { status: "scheduled" });
  await writeAudit(ctx, { action: "competition.schedule", target: id, by, reason: null, before: c.status, after: "scheduled" });
}

/**
 * Lock the rules and start the competition. Allowed from Monday 00:00 of the
 * competition week (competition timezone). Re-validates against the current
 * budget ceiling.
 */
export async function activateCompetition(ctx: StoreContext, id: string, by: string): Promise<void> {
  const c = await getCompetition(ctx, id);
  if (c.status !== "scheduled") throw new ArenaStateError(`only a scheduled competition can start (is ${c.status})`);
  const rv = (await ctx.store.ruleVersions.findOne({ _id: c.ruleVersionId }))!;
  await validate(ctx, rv.rules);
  const w = weekWindow(c.weekStart, rv.rules.timezone, rv.rules.review);
  if (ctx.now() < w.startsAt) throw new ArenaStateError("a competition cannot start before Monday 00:00 of its week");
  const at = ctx.now().toISOString();
  await setCompetition(ctx, c, { status: "active", lockedAt: at });
  await writeAudit(ctx, { action: "competition.activate", target: id, by, reason: null, before: c.status, after: { status: "active", rulesHash: rv.rulesHash } });
}

/**
 * Exceptional mid-competition rule change. Owner only, written reason
 * required; creates a new rule version and a notice every participant sees.
 */
export async function amendActiveRules(
  ctx: StoreContext,
  id: string,
  rules: ArenaRules,
  by: string,
  reason: string,
): Promise<{ ruleVersion: RuleVersionDoc; notice: NoticeDoc }> {
  const s = await currentSettings(ctx);
  if (by !== s.ownerUserId) throw new ArenaAuthorizationError("only the owner can amend an active competition");
  if (!reason.trim()) throw new ArenaConfigError(["a reason is required for a mid-competition change"]);
  const c = await getCompetition(ctx, id);
  if (c.status !== "active" && c.status !== "suspended")
    throw new ArenaStateError(`only an active or suspended competition can be amended (is ${c.status})`);
  await validate(ctx, rules);
  const before = await ctx.store.ruleVersions.findOne({ _id: c.ruleVersionId });
  if (before && rules.timezone !== before.rules.timezone)
    throw new ArenaConfigError(["the timezone of a started competition cannot change"]);
  const rv = await insertRuleVersion(ctx, id, rules, { kind: "amendment", ref: c.ruleVersionId }, by);
  await setCompetition(ctx, c, { ruleVersionId: rv._id, ruleVersionN: rv.n });
  const notice: NoticeDoc = {
    _id: ctx.newId("anot"),
    competitionId: id,
    kind: "rules_amended",
    message: reason,
    ruleVersionId: rv._id,
    by,
    at: ctx.now().toISOString(),
  };
  await ctx.store.notices.insertOne(notice);
  await writeAudit(ctx, { action: "competition.rules.amend", target: id, by, reason, before: before?.rules ?? null, after: rv.rules });
  return { ruleVersion: rv, notice };
}

export async function suspendCompetition(ctx: StoreContext, id: string, by: string, reason: string): Promise<void> {
  const s = await currentSettings(ctx);
  if (by !== s.ownerUserId) throw new ArenaAuthorizationError("only the owner can suspend a competition");
  if (!reason.trim()) throw new ArenaConfigError(["a reason is required"]);
  const c = await getCompetition(ctx, id);
  if (c.status !== "active") throw new ArenaStateError(`only an active competition can be suspended (is ${c.status})`);
  await setCompetition(ctx, c, { status: "suspended" });
  await ctx.store.notices.insertOne({
    _id: ctx.newId("anot"), competitionId: id, kind: "suspended", message: reason, ruleVersionId: null, by, at: ctx.now().toISOString(),
  });
  await writeAudit(ctx, { action: "competition.suspend", target: id, by, reason, before: "active", after: "suspended" });
}

export async function cancelCompetition(ctx: StoreContext, id: string, by: string, reason: string): Promise<void> {
  const c = await getCompetition(ctx, id);
  if (c.status === "approved") throw new ArenaStateError("an approved competition can never be cancelled");
  if (c.status !== "draft" && c.status !== "scheduled") {
    const s = await currentSettings(ctx);
    if (by !== s.ownerUserId) throw new ArenaAuthorizationError("only the owner can cancel a started competition");
  }
  if (!reason.trim()) throw new ArenaConfigError(["a reason is required"]);
  await setCompetition(ctx, c, { status: "cancelled" });
  await writeAudit(ctx, { action: "competition.cancel", target: id, by, reason, before: c.status, after: "cancelled" });
}

/** The exact rules a competition runs on (immutable snapshot). */
export async function rulesFor(ctx: StoreContext, id: string): Promise<RuleVersionDoc> {
  const c = await getCompetition(ctx, id);
  const rv = await ctx.store.ruleVersions.findOne({ _id: c.ruleVersionId });
  if (!rv) throw new ArenaStateError(`rule version ${c.ruleVersionId} missing`);
  return rv;
}

/** Approval permission check (Phase 3 uses this): approver list, never role alone. */
export async function assertMayApprove(ctx: StoreContext, userId: string): Promise<void> {
  const s = await currentSettings(ctx);
  if (!s.approverUserIds.includes(userId)) throw new ArenaAuthorizationError("this account is not an Arena approver");
}
