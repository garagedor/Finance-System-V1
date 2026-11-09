/**
 * Shared, mostly pure helpers for the shadow-validation preflight and the
 * simulated approval (scripts/arena/shadow-preflight.ts, shadow-approve.ts).
 *
 *   - the owner's data-review decisions file (schema, validation, and how it
 *     turns into Arena review resolutions — Arena-only, never a CRM change);
 *   - the accounts file the owner fills from the Weekly Balance admin screen;
 *   - the rules fingerprint (sha256 of the canonical JSON) and its summary;
 *   - private output folders (mode 700, outside any git repository);
 *   - "technician access is off" checks (environment, public listeners);
 *   - a write tracker for the LOCAL Arena database;
 *   - the history integrity check (same logic as ~/arena-dev/v1-proofs.ts integrity).
 *
 * Nothing in here writes to the CRM: the CRM Db handed in is always the guarded
 * read-only one from lib-ro-guard.ts.
 */
import fs from "node:fs";
import path from "node:path";
import type { Db } from "mongodb";
import { ARENA_RULE_SEEDS, canonicalJson, cloneRules, ruleSeed, rulesHash } from "../../src/lib/arena/config.ts";
import { computeCompetition } from "../../src/lib/arena/engine.ts";
import { buildCompetitorMap } from "../../src/lib/arena/identity.ts";
import { loadJobs } from "../../src/lib/arena/job-source.ts";
import { arenaStores, loadMappings, loadTechnicians } from "../../src/lib/arena/mongo-store.ts";
import { reviewDecisions, isEnglishDisplayName, NON_COMPETITOR_CATEGORIES } from "../../src/lib/arena/review.ts";
import type {
  DisplayNameCaseData, DuplicateCaseData, IdentityCaseData, NonCompetitorCategory, Resolution, ReviewCaseDoc, ReviewDecisions,
} from "../../src/lib/arena/review.ts";
import { resultContentHash, toStanding, verifySnapshotSource, type ResultDoc, type SnapshotDoc } from "../../src/lib/arena/lifecycle.ts";
import type { RuleVersionDoc } from "../../src/lib/arena/config-store.ts";
import type { ImpactSide, LateChangeReport } from "../../src/lib/arena/source-snapshot.ts";
import { addDays, previousWeekStarts } from "../../src/lib/arena/week.ts";
import type { AccountInput, AccountState, ArenaRules } from "../../src/lib/arena/types.ts";
import type { DisplayNameFormat } from "../../src/lib/arena/display-name.ts";

export const SIMULATION_ACTOR = "shadow-simulation";
export const SIMULATION_BANNER =
  "SIMULATION — shadow practice run on a local copy. NOT a real approval: no prize is paid, no Ledger, Payout or financial record exists or can be created.";
export const DECISIONS_SCHEMA = "arena-shadow-decisions/1";
export const DEFAULT_SHADOW_DIR = path.join(process.env.HOME ?? "~", "317-live-arena", "shadow");
/** Ports the Arena dev server (3999), `next dev` (3000) and the technician app (5173) use. */
export const DEFAULT_ARENA_PORTS = [3000, 3999, 5173];

// ── decisions file ─────────────────────────────────────────────────────────

export interface DecisionExclusion {
  /** Exact CRM technician name (Job.tech). */
  crmName: string;
  category: NonCompetitorCategory;
  reason: string;
}
export interface DecisionMapping {
  crmName: string;
  /** attach: credit this CRM name to a verified person; pending: not credited, cannot win. */
  status: "attach" | "pending_identification";
  /** TechNameMapping.supabaseUserId (required for attach, null while pending). */
  competitorId: string | null;
  reason: string;
}
export interface DecisionDuplicateGroup {
  /** CRM name of the technician (for matching and the report). */
  technician: string;
  date: string;
  /** Net profit of each copy (null = any). */
  profit: number | null;
  /**
   * confirmed: the office confirmed one invoice / one payment → count once (excludeJobIds left out);
   * keep_both: a normal two-part visit / not a double entry → both jobs count (the group is dismissed);
   * pending_office_confirmation: nothing applied — the group keeps blocking that week's approval.
   */
  status: "confirmed" | "pending_office_confirmation" | "keep_both";
  /** Jobs to leave out of the count (required when confirmed; at least one job of the group stays counted). */
  excludeJobIds: string[];
  /** Optional: the exact job ids of the group (from the shadow report); when given, only that exact group matches. */
  jobIds?: string[];
  reason: string;
}
/** Owner policy for whole classes of suspected duplicates (D2). "review" = decide pair by pair. */
export interface DecisionDuplicatePolicy {
  /** A group whose jobs are all Closed / X close with at least one of each (a two-part visit). */
  closedPlusXClose?: "keep_both" | "review";
  /** A group in which every job has $0 profit (OOA, Estimate, No answer…). */
  zeroDollar?: "keep_both" | "review";
}
export interface DecisionDisplayName {
  /** The account's full name, as shown in the review queue. */
  fullName: string;
  competitorId: string | null;
  displayName: string;
  reason: string;
}
export interface ShadowDecisions {
  schema: typeof DECISIONS_SCHEMA;
  note?: string;
  exclusions: DecisionExclusion[];
  mappings: DecisionMapping[];
  countOnceDuplicateGroups: DecisionDuplicateGroup[];
  displayNameOverrides: DecisionDisplayName[];
  /** Optional (absent = "review" for both). */
  duplicatePolicy?: DecisionDuplicatePolicy;
}

const POLICY_VALUES = ["keep_both", "review"];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown) => typeof v === "string" && v.trim().length > 0;

/** Validate a parsed decisions file. Returns the problems (empty = valid). */
export function validateDecisions(raw: unknown): { decisions: ShadowDecisions | null; problems: string[] } {
  const p: string[] = [];
  const d = raw as Partial<ShadowDecisions> | null;
  if (!d || typeof d !== "object" || Array.isArray(d)) return { decisions: null, problems: ["the file is not a JSON object"] };
  if (d.schema !== DECISIONS_SCHEMA) p.push(`"schema" must be "${DECISIONS_SCHEMA}"`);
  for (const k of ["exclusions", "mappings", "countOnceDuplicateGroups", "displayNameOverrides"] as const)
    if (!Array.isArray(d[k])) p.push(`"${k}" must be a list`);
  if (p.length) return { decisions: null, problems: p };
  const names = new Map<string, string>();
  const claim = (crmName: string, where: string) => {
    const k = crmName.trim();
    if (names.has(k)) p.push(`"${k}" is decided twice (${names.get(k)} and ${where})`);
    names.set(k, where);
  };
  d.exclusions!.forEach((x, i) => {
    if (!str(x?.crmName)) return p.push(`exclusions[${i}]: crmName is required`);
    if (!NON_COMPETITOR_CATEGORIES.includes(x.category)) p.push(`exclusions[${i}] "${x.crmName}": category must be one of ${NON_COMPETITOR_CATEGORIES.join(", ")}`);
    if (!str(x.reason)) p.push(`exclusions[${i}] "${x.crmName}": a reason is required`);
    claim(x.crmName, "exclusions");
  });
  d.mappings!.forEach((x, i) => {
    if (!str(x?.crmName)) return p.push(`mappings[${i}]: crmName is required`);
    if (x.status === "attach") {
      if (!str(x.competitorId)) p.push(`mappings[${i}] "${x.crmName}": attach needs competitorId (the person's Weekly Balance id)`);
    } else if (x.status === "pending_identification") {
      if (x.competitorId !== null && x.competitorId !== undefined) p.push(`mappings[${i}] "${x.crmName}": a pending name has competitorId null`);
    } else p.push(`mappings[${i}] "${x.crmName}": status must be "attach" or "pending_identification"`);
    if (!str(x.reason)) p.push(`mappings[${i}] "${x.crmName}": a reason is required`);
    claim(x.crmName, "mappings");
  });
  d.countOnceDuplicateGroups!.forEach((x, i) => {
    const at = `countOnceDuplicateGroups[${i}]`;
    if (!str(x?.technician)) return p.push(`${at}: technician is required`);
    if (!ISO_DAY.test(String(x.date))) p.push(`${at} "${x.technician}": date must be YYYY-MM-DD`);
    if (x.profit !== null && (typeof x.profit !== "number" || !Number.isFinite(x.profit))) p.push(`${at} "${x.technician}": profit must be a number or null`);
    if (!Array.isArray(x.excludeJobIds) || x.excludeJobIds.some((j) => !str(j))) p.push(`${at} "${x.technician}": excludeJobIds must be a list of job ids`);
    if (x.jobIds !== undefined && (!Array.isArray(x.jobIds) || x.jobIds.length < 2 || x.jobIds.some((j) => !str(j))))
      p.push(`${at} "${x.technician}": jobIds, when given, must list the 2 or more job ids of the group`);
    else if (x.jobIds && Array.isArray(x.excludeJobIds) && x.excludeJobIds.some((j) => !x.jobIds!.includes(j)))
      p.push(`${at} "${x.technician}": every excludeJobIds entry must be one of jobIds`);
    if (x.status === "confirmed") {
      if (!x.excludeJobIds?.length) p.push(`${at} "${x.technician}" ${x.date}: a confirmed group needs excludeJobIds (the copy to leave out)`);
      else if (x.jobIds && x.excludeJobIds.length >= x.jobIds.length) p.push(`${at} "${x.technician}" ${x.date}: at least one job of the group must stay counted`);
    } else if (x.status === "keep_both") {
      if (x.excludeJobIds?.length) p.push(`${at} "${x.technician}" ${x.date}: keep_both leaves nothing out (excludeJobIds must be empty)`);
    } else if (x.status !== "pending_office_confirmation") p.push(`${at} "${x.technician}": status must be "confirmed", "keep_both" or "pending_office_confirmation"`);
    if (!str(x.reason)) p.push(`${at} "${x.technician}": a reason is required`);
  });
  if (d.duplicatePolicy !== undefined) {
    const pol = d.duplicatePolicy as Record<string, unknown> | null;
    if (!pol || typeof pol !== "object" || Array.isArray(pol)) p.push(`"duplicatePolicy" must be an object`);
    else for (const [k, v] of Object.entries(pol)) {
      if (k !== "closedPlusXClose" && k !== "zeroDollar") p.push(`duplicatePolicy.${k}: unknown policy (closedPlusXClose, zeroDollar)`);
      else if (!POLICY_VALUES.includes(v as string)) p.push(`duplicatePolicy.${k} must be "keep_both" or "review"`);
    }
  }
  d.displayNameOverrides!.forEach((x, i) => {
    if (!str(x?.fullName) && !str(x?.competitorId)) return p.push(`displayNameOverrides[${i}]: fullName or competitorId is required`);
    if (!isEnglishDisplayName(String(x.displayName ?? "").trim())) p.push(`displayNameOverrides[${i}] "${x.fullName}": displayName must be Latin letters, 2–40 characters`);
    if (!str(x.reason)) p.push(`displayNameOverrides[${i}] "${x.fullName}": a reason is required`);
  });
  return { decisions: p.length ? null : (d as ShadowDecisions), problems: p };
}

export function readDecisionsFile(file: string): { decisions: ShadowDecisions | null; problems: string[] } {
  if (!fs.existsSync(file)) return { decisions: null, problems: ["file not found"] };
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return { decisions: null, problems: [`not valid JSON (${(e as Error).message.split("\n")[0]})`] };
  }
  return validateDecisions(raw);
}

export const decisionsSummary = (d: ShadowDecisions) => {
  const dup = d.countOnceDuplicateGroups;
  const pol = d.duplicatePolicy ?? {};
  return `${d.exclusions.length} exclusions, ${d.mappings.filter((m) => m.status === "attach").length} mappings (+${d.mappings.filter((m) => m.status !== "attach").length} pending identification), ` +
    `${dup.filter((g) => g.status === "confirmed").length} duplicate groups confirmed, ${dup.filter((g) => g.status === "keep_both").length} keep both (+${dup.filter((g) => g.status === "pending_office_confirmation").length} pending office), ` +
    `policy: Closed+X close ${pol.closedPlusXClose ?? "review"}, $0 pairs ${pol.zeroDollar ?? "review"}, ${d.displayNameOverrides.length} display-name overrides`;
};

export interface PlannedResolution { caseId: string; resolution: Resolution; reason: string; label: string }
export interface DecisionPlan {
  apply: PlannedResolution[];
  alreadyInForce: string[];
  /** Local decision differs from the file: refuse until the owner reopens it. */
  conflicts: string[];
  notes: string[];
  /**
   * Cases of this week the decisions file does not cover at all (open in the
   * local database and in no list of the file): a CRM name nobody decided is a
   * STOP condition for the daily check; an undecided duplicate group blocks
   * that week's approval.
   */
  undecided: { names: string[]; duplicates: string[]; displayNames: string[] };
  /** Covered, but deliberately left open: pending identification / pending office confirmation. */
  pending: { names: string[]; duplicates: string[] };
}

const sameResolution = (a: Resolution | null, b: Resolution) => !!a && canonicalJson(a) === canonicalJson(b);

const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
/** All jobs Closed / X close, at least one of each: a normal two-part visit (D2). */
export const isClosedPlusXClose = (g: DuplicateCaseData) =>
  g.jobs.every((j) => j.status === "Closed" || j.status === "X close") && g.jobs.some((j) => j.status === "Closed") && g.jobs.some((j) => j.status === "X close");
/** Every job $0 profit (OOA, Estimate, No answer…): no money involved (D2). */
export const isZeroDollar = (g: DuplicateCaseData) => g.jobs.every((j) => near(j.profit, 0));

const dupLabel = (g: DuplicateCaseData) =>
  `${g.competitorName} ${g.date} [${g.jobs.map((j) => `${j.status} $${j.profit.toFixed(2)}`).join(" + ")}] (jobs ${g.jobs.map((j) => j.id).join(", ")})`;

/** Does a decisions-file duplicate entry name this detected group? */
export function matchesDuplicate(x: DecisionDuplicateGroup, g: DuplicateCaseData): boolean {
  const ids = g.jobs.map((j) => j.id);
  if (x.jobIds?.length) return x.jobIds.length === ids.length && x.jobIds.every((id) => ids.includes(id));
  if (x.status === "confirmed") return x.excludeJobIds.length > 0 && x.excludeJobIds.every((id) => ids.includes(id));
  const who = [g.competitorName, ...g.jobs.map((j) => j.tech)].map((s) => s.trim().toLowerCase());
  return g.date === x.date && who.includes(x.technician.trim().toLowerCase()) && (x.profit === null || g.jobs.every((j) => near(j.profit, x.profit!)));
}

/** Pure: which review cases the decisions file resolves, and how. */
export function planDecisions(cases: ReviewCaseDoc[], d: ShadowDecisions): DecisionPlan {
  const plan: DecisionPlan = { apply: [], alreadyInForce: [], conflicts: [], notes: [], undecided: { names: [], duplicates: [], displayNames: [] }, pending: { names: [], duplicates: [] } };
  const covered = new Set<string>();
  const consider = (c: ReviewCaseDoc, r: Resolution, reason: string, label: string) => {
    covered.add(c._id);
    if (c.status === "open") plan.apply.push({ caseId: c._id, resolution: r, reason: `decisions.json: ${reason}`, label });
    else if (sameResolution(c.resolution, r)) plan.alreadyInForce.push(label);
    else plan.conflicts.push(`${label}: the local database already has a different ${c.status.replace("_", " ")} decision (${JSON.stringify(c.resolution)}); reopen it or fix decisions.json`);
  };
  const byKind = (k: ReviewCaseDoc["kind"]) => cases.filter((c) => c.kind === k);
  const identity = new Map(byKind("identity_name").map((c) => [(c.data as IdentityCaseData).crmName.trim(), c]));

  for (const x of d.exclusions) {
    const c = identity.get(x.crmName.trim());
    if (!c) { plan.notes.push(`exclusion "${x.crmName}": no case this week (no jobs, or already handled)`); continue; }
    consider(c, { kind: "identity_not_competitor", category: x.category }, x.reason, `exclude "${x.crmName}" (${x.category})`);
  }
  for (const x of d.mappings) {
    const c = identity.get(x.crmName.trim());
    if (x.status === "pending_identification") {
      if (c) { covered.add(c._id); plan.pending.names.push(`${x.crmName} (${(c.data as IdentityCaseData).jobs} job(s))`); }
      plan.notes.push(c ? `"${x.crmName}" pending identification: ${(c.data as IdentityCaseData).jobs} job(s) this week, not credited to anyone and cannot win` : `"${x.crmName}" pending identification: no jobs this week`);
      continue;
    }
    if (!c) { plan.notes.push(`mapping "${x.crmName}": no case this week`); continue; }
    consider(c, { kind: "identity_attach", competitorId: x.competitorId! }, x.reason, `attach "${x.crmName}" → ${x.competitorId}`);
  }
  const dups = byKind("duplicate_group");
  for (const x of d.countOnceDuplicateGroups) {
    const label = `${x.technician} ${x.date}${x.profit !== null ? ` $${x.profit.toFixed(2)}` : ""}`;
    const c = dups.find((g) => matchesDuplicate(x, g.data as DuplicateCaseData));
    if (x.status === "confirmed") {
      if (!c) { plan.notes.push(`count once ${label}: its jobs are not a suspected group this week`); continue; }
      consider(c, { kind: "duplicate_confirmed", excludeJobIds: [...x.excludeJobIds].sort() }, x.reason, `count once ${label}`);
    } else if (x.status === "keep_both") {
      if (!c) { plan.notes.push(`keep both ${label}: not a suspected group this week`); continue; }
      consider(c, { kind: "duplicate_dismissed" }, x.reason, `keep both ${label}`);
    } else if (c) {
      covered.add(c._id);
      plan.pending.duplicates.push(dupLabel(c.data as DuplicateCaseData));
      plan.notes.push(`pending office confirmation ${label}: counted both ways for now — jobs ${(c.data as DuplicateCaseData).jobs.map((j) => j.id).join(", ")}; it blocks this week's approval until decided`);
    }
  }
  const pol = d.duplicatePolicy ?? {};
  for (const c of dups) {
    if (covered.has(c._id)) continue;
    const g = c.data as DuplicateCaseData;
    if (pol.closedPlusXClose === "keep_both" && isClosedPlusXClose(g))
      consider(c, { kind: "duplicate_dismissed" }, "D2 policy: Closed + X close is a normal two-part visit, keep both", `keep both (policy Closed + X close) ${dupLabel(g)}`);
    else if (pol.zeroDollar === "keep_both" && isZeroDollar(g))
      consider(c, { kind: "duplicate_dismissed" }, "D2 policy: $0 pair, no money involved, keep both", `keep both (policy $0) ${dupLabel(g)}`);
  }
  for (const c of byKind("display_name")) {
    const data = c.data as DisplayNameCaseData;
    const x = d.displayNameOverrides.find((o) =>
      (o.competitorId && o.competitorId === data.competitorId) ||
      (!o.competitorId && [data.fullName, data.currentName].some((n) => n && n.trim() === o.fullName.trim())));
    if (x) consider(c, { kind: "display_name", displayName: x.displayName.trim() }, x.reason, `display name "${x.displayName}" for ${data.fullName ?? data.currentName}`);
  }
  for (const c of cases) {
    if (covered.has(c._id) || c.status !== "open") continue;
    if (c.kind === "identity_name") { const x = c.data as IdentityCaseData; plan.undecided.names.push(`${x.crmName} (${x.jobs} job(s)${x.locations.length ? ` at ${x.locations.join(", ")}` : ""})`); }
    else if (c.kind === "duplicate_group") plan.undecided.duplicates.push(dupLabel(c.data as DuplicateCaseData));
    else { const x = c.data as DisplayNameCaseData; plan.undecided.displayNames.push(`${x.fullName ?? x.currentName} (${x.reason ?? "needs_english"})`); }
  }
  return plan;
}

/**
 * Pure: the engine inputs the plan WOULD produce, on top of the decisions already
 * in force (same mapping as review.ts reviewDecisions). Used by the daily
 * shadow run to show standings "with the decisions file applied" without
 * writing anything.
 */
export function projectDecisions(base: ReviewDecisions, cases: ReviewCaseDoc[], plan: DecisionPlan, by = "decisions.json", at = new Date(0).toISOString()): ReviewDecisions {
  const out: ReviewDecisions = {
    exclusions: [...base.exclusions], dismissedDuplicateGroups: [...base.dismissedDuplicateGroups], overrides: [...base.overrides], displayNames: { ...base.displayNames },
  };
  const byId = new Map(cases.map((c) => [c._id, c]));
  for (const a of plan.apply) {
    const c = byId.get(a.caseId);
    if (!c) continue;
    const r = a.resolution;
    if (r.kind === "duplicate_confirmed") for (const jobId of r.excludeJobIds) out.exclusions.push({ jobId, kind: "duplicate", reason: a.reason, by, at });
    else if (r.kind === "duplicate_dismissed") out.dismissedDuplicateGroups.push(c.key);
    else if (r.kind === "identity_attach") out.overrides.push({ crmName: (c.data as IdentityCaseData).crmName, competitorId: r.competitorId, reason: a.reason, by, at });
    else if (r.kind === "identity_not_competitor") out.overrides.push({ crmName: (c.data as IdentityCaseData).crmName, competitorId: null, reason: `${r.category}: ${a.reason}`, by, at });
    else if (r.kind === "display_name") out.displayNames[(c.data as DisplayNameCaseData).competitorId] = r.displayName;
  }
  return out;
}

/** Turn detected cases (detect.ts) into case documents for planning, keeping local decisions already recorded. */
export function asCaseDocs(found: { kind: ReviewCaseDoc["kind"]; key: string; data: ReviewCaseDoc["data"]; weeks: string[] }[], recorded: ReviewCaseDoc[] = []): ReviewCaseDoc[] {
  const rec = new Map(recorded.map((c) => [c._id, c]));
  return found.map((f) => {
    const id = `${f.kind}:${f.key}`;
    const r = rec.get(id);
    return r ? { ...r, data: f.data } : {
      _id: id, kind: f.kind, key: f.key, status: "open", data: f.data, weeks: f.weeks, firstSeenAt: "", lastSeenAt: "",
      resolution: null, reason: null, decidedBy: null, decidedAt: null, confirmedBy: null, confirmedAt: null, version: 0,
    } as ReviewCaseDoc;
  });
}

// ── clock gate for the simulated approval ──────────────────────────────────

/**
 * When shadow-approve may run on the REAL clock:
 *   - nothing before the week has ended (Sunday 23:59:59 in the rules timezone);
 *   - the Monday freeze (--stop-after freeze) as soon as the week has ended;
 *   - review / approval only once the review window opens (Tuesday 12:00).
 * `early` = the real clock is not enough; the caller refuses unless --allow-early (testing only).
 */
export function approvalClockGate(o: { now: Date; closesAt: Date; approvalOpensAt: Date; stopAfter: "freeze" | "review" | null }): { early: boolean; why: string | null } {
  if (o.now < o.closesAt) return { early: true, why: `the week has not ended (it closes ${o.closesAt.toISOString()})` };
  if (o.now < o.approvalOpensAt && o.stopAfter !== "freeze")
    return { early: true, why: `the review window opens ${o.approvalOpensAt.toISOString()} (Tuesday 12:00); before that only the freeze may run (--stop-after freeze)` };
  return { early: false, why: null };
}

// ── run archive ────────────────────────────────────────────────────────────

/** A filesystem-safe run stamp from an ISO time ("2026-11-09T14-05-00.000Z"). */
export const runStamp = (iso: string) => iso.replace(/:/g, "-");

/** Keep every run: <dir>/runs/<stamp>[-<suffix>]/<file> (mode 700 / 600). Returns the run folder. */
export function archiveRun(dir: string, stamp: string, files: Record<string, string>, suffix = ""): string {
  const runs = ensurePrivateDir(path.join(dir, "runs"));
  const run = ensurePrivateDir(path.join(runs, `${stamp}${suffix ? `-${suffix}` : ""}`));
  for (const [f, content] of Object.entries(files)) writePrivate(run, f, content);
  return run;
}

// ── accounts file ──────────────────────────────────────────────────────────

const ACCOUNT_STATES: readonly AccountState[] = ["eligible", "pending", "inactive", "unmapped", "not_competing_role", "unverified"];

/** `{ competitorId: "eligible" | "pending" | ... }` filled by the owner from the Weekly Balance admin screen. */
export function parseAccountsFile(raw: unknown): { states: Record<string, AccountState>; problems: string[] } {
  const problems: string[] = [];
  const states: Record<string, AccountState> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { states, problems: ["the accounts file must be a JSON object { competitorId: state }"] };
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!ACCOUNT_STATES.includes(v as AccountState)) problems.push(`${id}: "${String(v)}" is not one of ${ACCOUNT_STATES.join(", ")}`);
    else states[id] = v as AccountState;
  }
  return { states, problems };
}

/**
 * Account standings for the simulation. A competitor missing from the file is
 * `unverified`. Unverified never moves a prize; for the practice run it is
 * recorded as eligible (assumed) — the caller refuses the approval when a
 * PRIZE position is unverified, unless the owner explicitly accepts it.
 */
export function simulationAccounts(states: Readonly<Record<string, AccountState>>, checkedAt: string) {
  const assumed = new Set<string>();
  const lookup = (ids: readonly string[]): Record<string, AccountInput> => {
    const out: Record<string, AccountInput> = {};
    for (const id of ids) {
      const s = states[id] ?? "unverified";
      if (s === "unverified") {
        assumed.add(id);
        out[id] = { state: "eligible", checkedAt: null };
      } else out[id] = { state: s, checkedAt };
    }
    return out;
  };
  return { lookup, assumed, rawState: (id: string): AccountState => states[id] ?? "unverified" };
}

// ── rules ──────────────────────────────────────────────────────────────────

/** sha256 of the canonical JSON of the rules (equals rulesHash). */
export const rulesFingerprint = (rules: ArenaRules) => rulesHash(rules);

/**
 * The rules an official shadow command uses. There is NO default: every
 * command names its rules with `--template <id>` (owner decision 2026-11-02
 * changed the prizes, so a silent default could pay the wrong structure).
 *   - a code seed id (ARENA_RULE_SEEDS: "balanced-p2-2026-11" = current
 *     prizes, "balanced-v1" = the superseded 6-place prizes, for comparison);
 *   - else a template saved in the local Arena database (templateId, current).
 * A local template that reuses a code-seed id with DIFFERENT rules is refused
 * (ambiguous), never silently preferred.
 */
export const TEMPLATE_REQUIRED =
  `--template <id> is required: ${ARENA_RULE_SEEDS.map((s) => `"${s.id}" (${s.label})`).join(", ")}, or a template id saved in the local Arena database`;
export async function resolveShadowRules(
  templateId: string | null,
  findLocalTemplate: ((id: string) => Promise<Record<string, unknown> | null>) | null,
  localDbName: string,
): Promise<{ rules: ArenaRules; label: string; source: "seed" | "local" }> {
  if (!templateId) throw new Error(TEMPLATE_REQUIRED);
  const seed = ruleSeed(templateId);
  const local = findLocalTemplate ? await findLocalTemplate(templateId) : null;
  if (seed) {
    if (local && rulesHash(local.rules as ArenaRules) !== rulesHash(seed.rules))
      throw new Error(`template "${templateId}" is both a code seed and a DIFFERENT local template in ${localDbName}; refusing (ambiguous)`);
    return { rules: cloneRules(seed.rules), label: `${seed.label} (code seed ${seed.id}, ${seed.code})`, source: "seed" };
  }
  if (!findLocalTemplate) throw new Error(`template "${templateId}" is not a code seed and the local ${localDbName} database is unavailable`);
  if (!local) throw new Error(`template "${templateId}" not found: not a code seed (${ARENA_RULE_SEEDS.map((s) => s.id).join(", ")}) nor in the local ${localDbName} database`);
  return { rules: cloneRules(local.rules as ArenaRules), label: `${String(local.name)} v${String(local.version)} (local ${localDbName})`, source: "local" };
}

/** The fingerprint written in an owner-confirmed file (first 64-hex token). */
export function readFingerprintFile(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  const m = /\b([0-9a-f]{64})\b/i.exec(fs.readFileSync(file, "utf8"));
  return m ? m[1].toLowerCase() : "";
}

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export function rulesSummary(r: ArenaRules): string[] {
  const mi = r.mostImproved;
  const assigned = r.eligibility.jobCountBasis === "assigned";
  return [
    `methodology ${r.scoring.methodology ?? "WEIGHTED_V0 (field absent)"} · timezone ${r.timezone}`,
    `minimums: ${r.eligibility.minQualifyingJobs} ${assigned ? "assigned jobs (every status; jobCountBasis assigned)" : "qualifying jobs"} · AVG TICKET ≥ ${usd(r.eligibility.minAvgTicketCents)} · Closing Rate ≥ ${r.eligibility.minClosingRateBp / 100}%`,
    `targets: Closing Rate ${r.scoring.closingRate.targetBp / 100}% (cap ${r.scoring.closingRate.cap}) · AVG TICKET ${usd(r.scoring.avgTicket.targetCents)} (cap ${r.scoring.avgTicket.cap})` +
      ((r.scoring.methodology ?? "WEIGHTED_V0") === "WEIGHTED_V0" ? ` · weights ${r.scoring.closingRate.weight}/${r.scoring.avgTicket.weight}` : ""),
    `prizes: ${r.prizes.positionsCents.map((c, i) => `#${i + 1} ${usd(c)}`).join(" · ")} · budget ${usd(r.prizes.budgetCents)}`,
    `Most Improved: ${mi.enabled ? `${usd(mi.amountCents)}; baseline ${mi.baselineWeeks} weeks, ≥ ${mi.minValidWeeks} valid, ≥ ${mi.minQualifyingJobsPerWeek} ${assigned ? "assigned" : "qualifying"} jobs per baseline week, improvement > ${mi.minImprovement}` : "off"}`,
    `qualifying statuses: ${r.qualifying.statuses.join(", ")}${assigned ? " (not used by the job minimum under jobCountBasis assigned)" : ""}`,
    r.scoring.methodology === "BALANCED_PERFORMANCE_V1"
      ? "tie-break (fixed for BALANCED_PERFORMANCE_V1): unrounded final score → higher metric score → more assigned jobs → competitor id"
      : `tie-break: ${r.tieBreak.join(" → ")}`,
    `review window: approval opens ${r.review.approvalOpensDaysAfterWeekEnd} day(s) after the week ends, ${r.review.approvalOpensLocalTime} ${r.timezone}`,
  ];
}

// ── private output folders ─────────────────────────────────────────────────

/** The enclosing git work tree of `dir` (or of its nearest existing parent), if any. */
export function gitRootOf(dir: string): string | null {
  let cur = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(cur, ".git"))) return cur;
    const up = path.dirname(cur);
    if (up === cur) return null;
    cur = up;
  }
}

/** Problems with an output folder: must exist, be a directory, mode 700, outside any git repository. */
export function outputDirProblems(dir: string): string[] {
  const p: string[] = [];
  const abs = path.resolve(dir);
  const repo = gitRootOf(abs);
  if (repo) p.push(`inside the git repository ${repo} (the output contains technician names)`);
  if (!fs.existsSync(abs)) return [...p, `${abs} does not exist (create it: mkdir -m 700 ${abs})`];
  const st = fs.statSync(abs);
  if (!st.isDirectory()) return [...p, `${abs} is not a directory`];
  const mode = st.mode & 0o777;
  if (mode !== 0o700) p.push(`mode ${mode.toString(8)} (must be 700: chmod 700 ${abs})`);
  return p;
}

/** Create (if needed) a private output folder and refuse one inside a git repository. */
export function ensurePrivateDir(dir: string): string {
  const abs = path.resolve(dir);
  const repo = gitRootOf(abs);
  if (repo) throw new Error(`refusing: ${abs} is inside the git repository ${repo} (the output contains technician names)`);
  fs.mkdirSync(abs, { recursive: true, mode: 0o700 });
  fs.chmodSync(abs, 0o700);
  return abs;
}

export function writePrivate(dir: string, file: string, content: string) {
  const p = path.join(dir, file);
  fs.writeFileSync(p, content, { mode: 0o600 });
  fs.chmodSync(p, 0o600);
  return p;
}

// ── technician access OFF ──────────────────────────────────────────────────

/** Environment variables that would switch technician access on or connect Weekly Balance / Supabase. */
const TECH_OR_WB_ENV = /^(ARENA_TECH_ENABLED|ARENA_TECH_.*|ARENA_ROW_ID_SECRET|ARENA_WB_.*|ARENA_VERIFIER|ARENA_FAKE_VERIFIER_FILE|ARENA_PASS_.*|WB_.*|.*WEEKLY_BALANCE.*|.*SUPABASE.*)$/i;
export const techAccessEnvVars = (env: NodeJS.ProcessEnv) => Object.keys(env).filter((k) => TECH_OR_WB_ENV.test(k) && env[k] !== undefined).sort();

export interface Listener { address: string; port: number; process: string | null }

/** Parse `ss -ltnpH` (or `ss -ltnp`) output. */
export function parseListeners(ss: string): Listener[] {
  const out: Listener[] = [];
  for (const line of ss.split("\n")) {
    const cols = line.trim().split(/\s+/);
    if (cols[0] !== "LISTEN" || cols.length < 5) continue;
    const local = cols[3];
    const i = local.lastIndexOf(":");
    const port = Number(local.slice(i + 1));
    if (!Number.isInteger(port)) continue;
    const proc = /users:\(\("([^"]+)"/.exec(line)?.[1] ?? null;
    out.push({ address: local.slice(0, i).replace(/^\[|\]$/g, "").replace(/%.*$/, ""), port, process: proc });
  }
  return out;
}

const LOOPBACK = (a: string) => a === "::1" || /^127\./.test(a) || a === "localhost";

/** Listeners on a non-loopback address (0.0.0.0, ::, *, or a LAN IP) on an Arena port. */
export const publicArenaListeners = (ls: Listener[], ports: readonly number[]) =>
  ls.filter((l) => ports.includes(l.port) && !LOOPBACK(l.address));

// ── clock ──────────────────────────────────────────────────────────────────

export const MAX_CLOCK_SKEW_MS = 2 * 60_000;
export function clockSkew(localMs: number, httpDate: string | null): number | null {
  if (!httpDate) return null;
  const remote = Date.parse(httpDate);
  return Number.isFinite(remote) ? localMs - remote : null;
}

// ── local write tracking ───────────────────────────────────────────────────

const WRITE_METHOD = /^(insert|update|replace|delete|bulkWrite|findOneAnd|createIndex|dropIndex|drop|rename)/;

/** Wrap a LOCAL Db so every write method records `<db>.<collection>.<method>` before it runs. */
export function trackWrites(db: Db, log: string[]): Db {
  return new Proxy(db, {
    get(t, p, r) {
      const v = Reflect.get(t, p, r);
      if (p === "collection" && typeof v === "function")
        return (name: string, ...a: unknown[]) => {
          const coll = v.call(t, name, ...a);
          return new Proxy(coll, {
            get(c, q, rr) {
              const f = Reflect.get(c, q, rr);
              if (typeof q === "string" && typeof f === "function" && WRITE_METHOD.test(q))
                return (...args: unknown[]) => { log.push(`${t.databaseName}.${name}.${q}`); return f.apply(c, args); };
              return typeof f === "function" ? f.bind(c) : f;
            },
          });
        };
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}

/** Wrap an insert-only collection so every inserted document carries `simulated: true`. */
export function markSimulated<T extends object>(coll: T): T {
  return new Proxy(coll, {
    get(c, q, r) {
      const f = Reflect.get(c, q, r);
      if (q === "insertOne" && typeof f === "function") return (doc: object, ...rest: unknown[]) => f.call(c, { ...doc, simulated: true }, ...rest);
      return typeof f === "function" ? f.bind(c) : f;
    },
  });
}

// ── history integrity (same logic as ~/arena-dev/v1-proofs.ts integrity) ───

export interface IntegrityLine { verdict: "IDENTICAL" | "MISMATCH"; label: string; detail: string; counts: boolean }

/**
 * Recompute every APPROVED result (and the snapshot it approved) under its
 * ORIGINAL rule version with today's engine and compare field by field.
 *
 * A snapshot that stores its source (source-snapshot.ts) is recomputed from
 * THAT stored input — the job set read at the time, the decisions and account
 * standings in force — so a CRM edit made after approval cannot change the
 * verdict (it is reported as a late correction instead). The approved record's
 * content hash and its standings are checked against the snapshot too. Older
 * snapshots without a stored source fall back to today's CRM and today's
 * review decisions.
 *
 * Other frozen snapshots are listed for information only (`counts: false`).
 */
export async function integrityCheck(crm: Db, arena: Db): Promise<{ lines: IntegrityLine[]; identical: number; mismatched: number }> {
  const engineFor = async (rules: ArenaRules, weekStart: string, accounts: Record<string, AccountInput>, hash: string, nameFormat?: DisplayNameFormat) => {
    const weeks = rules.mostImproved.enabled ? previousWeekStarts(weekStart, rules.mostImproved.baselineWeeks) : [];
    const from = weeks.length ? weeks[weeks.length - 1] : weekStart;
    const jobs = await loadJobs(crm, [from, weekStart].sort()[0], addDays(weekStart, 7));
    const [mappings, technicians] = await Promise.all([loadMappings(crm), loadTechnicians(crm)]);
    const decisions = await reviewDecisions({ store: arenaStores(arena).review } as never);
    const competitors = buildCompetitorMap({ mappings, technicians, crmNamesInUse: [...new Set(jobs.map((j) => j.tech))], overrides: decisions.overrides, displayNames: decisions.displayNames, nameFormat });
    return computeCompetition({ rules, rulesHash: hash, weekStart, competitors, jobs, exclusions: decisions.exclusions, dismissedDuplicateGroups: decisions.dismissedDuplicateGroups, accounts });
  };
  const lines: IntegrityLine[] = [];
  type Row = Record<string, unknown> & { competitorId: string; displayName: string };
  const cmp = async (label: string, ruleVersionId: string, weekStart: string, stored: Row[], accountsFrom: Row[], nameFormat: DisplayNameFormat, counts: boolean) => {
    const rv = await arena.collection("arena_rule_version").findOne({ _id: ruleVersionId as never });
    if (!rv) { lines.push({ verdict: "MISMATCH", label, detail: `rule version ${ruleVersionId} missing`, counts }); return; }
    const accounts = Object.fromEntries(accountsFrom.map((s) => [s.competitorId,
      typeof s.account === "string" ? { state: s.account as AccountState, checkedAt: null } : (s.account as AccountInput) ?? { state: "eligible" as const, checkedAt: null }]));
    const r = await engineFor(rv.rules as ArenaRules, weekStart, accounts, rv.rulesHash as string, nameFormat);
    const now = r.results.map(toStanding) as unknown as Row[];
    const diffs: string[] = [];
    if (rulesHash(rv.rules as ArenaRules) !== rv.rulesHash) diffs.push("rules hash");
    for (const s of stored) {
      const n = now.find((x) => x.competitorId === s.competitorId);
      if (!n) { diffs.push(`${s.displayName}: missing`); continue; }
      for (const k of Object.keys(s)) if (JSON.stringify(s[k]) !== JSON.stringify(n[k])) diffs.push(`${s.displayName}.${k}: ${JSON.stringify(s[k])} vs ${JSON.stringify(n[k])}`);
    }
    if (now.length !== stored.length) diffs.push(`count ${stored.length} vs ${now.length}`);
    const methodology = (rv.rules as ArenaRules).scoring.methodology ?? "WEIGHTED_V0 (field absent)";
    lines.push({
      verdict: diffs.length ? "MISMATCH" : "IDENTICAL", counts,
      label, detail: `rules ${ruleVersionId} [${methodology}; names ${nameFormat}] ${stored.length} standings${diffs.length ? " — " + diffs.slice(0, 5).join("; ") : ""}`,
    });
  };
  const fmt = (r: { displayNameFormat?: DisplayNameFormat } | undefined): DisplayNameFormat => r?.displayNameFormat ?? "FULL_NAME_V0";
  const fromSource = async (label: string, snap: SnapshotDoc, counts: boolean, res?: ResultDoc & { simulated?: boolean }) => {
    const rv = (await arena.collection("arena_rule_version").findOne({ _id: snap.ruleVersionId as never })) as unknown as RuleVersionDoc | null;
    if (!rv) { lines.push({ verdict: "MISMATCH", label, detail: `rule version ${snap.ruleVersionId} missing`, counts }); return; }
    const v = verifySnapshotSource(snap, rv);
    const diffs = [...v.problems];
    if (rulesHash(rv.rules) !== rv.rulesHash) diffs.push("rules hash");
    if (res) {
      const { contentHash, simulated: _s, _id, ...rest } = res as ResultDoc & { simulated?: boolean };
      void _s;
      if (resultContentHash({ _id, ...rest } as Omit<ResultDoc, "contentHash">) !== contentHash) diffs.push("approved record content hash");
      const want = snap.result.results.map(toStanding);
      if (JSON.stringify(want) !== JSON.stringify(res.standings)) diffs.push("approved standings differ from the approved snapshot");
      if (res.snapshotResultHash && res.snapshotResultHash !== snap.resultHash) diffs.push("approved record names another result hash");
      if (res.sourceInputHash && res.sourceInputHash !== snap.source?.inputHash) diffs.push("approved record names another source");
    }
    const methodology = rv.rules.scoring.methodology ?? "WEIGHTED_V0 (field absent)";
    lines.push({
      verdict: diffs.length ? "MISMATCH" : "IDENTICAL", counts, label,
      detail: `rules ${rv._id} [${methodology}] recomputed from the STORED source snapshot (read ${snap.source?.readAt}, ${snap.source?.jobs.length} jobs, input ${snap.source?.inputHash.slice(0, 12)}…, result ${v.recomputedHash?.slice(0, 12)}…)${res ? `; record hash ${res.contentHash.slice(0, 12)}… verified` : ""}${diffs.length ? " — " + diffs.join("; ") : ""}`,
    });
  };
  const results = await arena.collection("arena_result").find({}).sort({ _id: 1 }).toArray();
  const approvedSnaps = new Set(results.map((r) => r.snapshotId as string));
  for (const res of results) {
    const snap = (await arena.collection("arena_snapshot").findOne({ _id: res.snapshotId })) as unknown as SnapshotDoc | null;
    if (snap?.source) await fromSource(`approved ${res._id}`, snap, true, res as unknown as ResultDoc);
    else await cmp(`approved ${res._id}`, res.ruleVersionId, res.weekStart, res.standings, res.standings, fmt(snap?.result), true);
  }
  const frozen = await arena.collection("arena_snapshot").find({ kind: { $in: ["provisional", "reconciled"] } }).sort({ _id: 1 }).toArray();
  for (const s of frozen) {
    const label = `snapshot ${s._id}${approvedSnaps.has(s._id as unknown as string) ? " (approved)" : " (informational)"}`;
    const counts = approvedSnaps.has(s._id as unknown as string);
    if (s.source) { await fromSource(label, s as unknown as SnapshotDoc, counts); continue; }
    const stored = s.result.results.map(toStanding);
    await cmp(label, s.ruleVersionId, s.weekStart, stored, s.result.results, fmt(s.result), counts);
  }
  const counted = lines.filter((l) => l.counts);
  return { lines, identical: counted.filter((l) => l.verdict === "IDENTICAL").length, mismatched: counted.filter((l) => l.verdict === "MISMATCH").length };
}

// ── late CRM changes (report rendering) ─────────────────────────────────────

const KIND_LABEL: Record<string, string> = {
  removed: "job removed", redated_out: "re-dated out of the week", redated_in: "re-dated into the week", reassigned: "re-assigned",
  status: "status edited", profit: "profit edited", location: "location edited", date: "re-dated within the week", added: "job added",
};
const sideText = (x: ImpactSide | null) =>
  x ? `#${x.rank} · ${x.score.toFixed(2)} · ${x.assignedJobs}/${x.closedJobs}/${x.qualifyingJobs} · $${x.profit.toFixed(2)} · ${x.prizePosition !== null ? `prize #${x.prizePosition} $${(x.prizeCents / 100).toFixed(0)}` : x.wonMostImproved ? `Most Improved $${(x.prizeCents / 100).toFixed(0)}` : "no prize"}${x.eligible ? "" : " · not eligible"}` : "—";

/** Markdown tables for a late-change report (owner-readable). */
export function renderLateChanges(r: LateChangeReport): string[] {
  const out: string[] = [];
  out.push(`Compared with \`${r.against.snapshotId}\` (read ${r.against.readAt}, jobs ${r.against.jobsHash.slice(0, 12)}…) · re-read ${r.read.readAt} (jobs ${r.read.jobsHash.slice(0, 12)}…)`);
  out.push(`CRM edit times: ${r.updateTimestampField ? `recorded by the CRM in \`${r.updateTimestampField}\`` : "**not recorded** — the CRM job documents carry no update-timestamp field, so the times below are when the Arena DETECTED each change, not when it was made"}.`);
  out.push("");
  if (!r.changes.length) { out.push("No job changed."); return out; }
  out.push(`| Job | Change | Week | Technician (freeze → now) | Before | After | Detected | CRM edit time |`);
  out.push(`|---|---|---|---|---|---|---|---|`);
  for (const c of r.changes)
    out.push(`| \`${c.jobId}\` | ${KIND_LABEL[c.kind] ?? c.kind} — ${c.detail} | ${c.week} | ${c.techBefore ?? "—"} → ${c.techAfter ?? "—"} | ${c.before ?? "—"} | ${c.after ?? "—"} | ${c.detectedAt} | ${c.crmUpdatedAt ?? "not recorded"} |`);
  out.push("");
  out.push(`**Effect on prizes:** ${r.impact.material ? `**MATERIAL** — ${r.impact.reasons.join("; ")}` : "none (no prize, Most Improved or prize-relevant eligibility changes)"}`);
  if (r.impact.rows.length) {
    out.push("");
    out.push(`| Technician | Freeze job set (rank · score · assigned/closed/qualifying · profit · prize) | Re-read | Material |`);
    out.push(`|---|---|---|---|`);
    for (const x of r.impact.rows) out.push(`| ${x.displayName} | ${sideText(x.before)} | ${sideText(x.after)} | ${x.material ? `YES — ${x.why.join(", ")}` : "no"} |`);
  }
  return out;
}
