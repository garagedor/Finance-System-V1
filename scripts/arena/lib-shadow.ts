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
import { canonicalJson, rulesHash } from "../../src/lib/arena/config.ts";
import { computeCompetition } from "../../src/lib/arena/engine.ts";
import { buildCompetitorMap } from "../../src/lib/arena/identity.ts";
import { loadJobs } from "../../src/lib/arena/job-source.ts";
import { arenaStores, loadMappings, loadTechnicians } from "../../src/lib/arena/mongo-store.ts";
import { reviewDecisions, isEnglishDisplayName, NON_COMPETITOR_CATEGORIES } from "../../src/lib/arena/review.ts";
import type {
  DisplayNameCaseData, DuplicateCaseData, IdentityCaseData, NonCompetitorCategory, Resolution, ReviewCaseDoc,
} from "../../src/lib/arena/review.ts";
import { toStanding } from "../../src/lib/arena/lifecycle.ts";
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
  /** confirmed: the office confirmed one invoice / one payment → count once. */
  status: "confirmed" | "pending_office_confirmation";
  /** Jobs to leave out of the count (required when confirmed; at least one job of the group stays counted). */
  excludeJobIds: string[];
  reason: string;
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
}

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
    if (x.status === "confirmed") {
      if (!x.excludeJobIds?.length) p.push(`${at} "${x.technician}" ${x.date}: a confirmed group needs excludeJobIds (the copy to leave out)`);
    } else if (x.status !== "pending_office_confirmation") p.push(`${at} "${x.technician}": status must be "confirmed" or "pending_office_confirmation"`);
    if (!str(x.reason)) p.push(`${at} "${x.technician}": a reason is required`);
  });
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
  return `${d.exclusions.length} exclusions, ${d.mappings.filter((m) => m.status === "attach").length} mappings (+${d.mappings.filter((m) => m.status !== "attach").length} pending identification), ` +
    `${dup.filter((g) => g.status === "confirmed").length} duplicate groups confirmed (+${dup.filter((g) => g.status !== "confirmed").length} pending office), ${d.displayNameOverrides.length} display-name overrides`;
};

export interface PlannedResolution { caseId: string; resolution: Resolution; reason: string; label: string }
export interface DecisionPlan {
  apply: PlannedResolution[];
  alreadyInForce: string[];
  /** Local decision differs from the file: refuse until the owner reopens it. */
  conflicts: string[];
  notes: string[];
}

const sameResolution = (a: Resolution | null, b: Resolution) => !!a && canonicalJson(a) === canonicalJson(b);

/** Pure: which review cases the decisions file resolves, and how. */
export function planDecisions(cases: ReviewCaseDoc[], d: ShadowDecisions): DecisionPlan {
  const plan: DecisionPlan = { apply: [], alreadyInForce: [], conflicts: [], notes: [] };
  const consider = (c: ReviewCaseDoc, r: Resolution, reason: string, label: string) => {
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
      plan.notes.push(c ? `"${x.crmName}" pending identification: ${(c.data as IdentityCaseData).jobs} job(s) this week, not credited to anyone and cannot win` : `"${x.crmName}" pending identification: no jobs this week`);
      continue;
    }
    if (!c) { plan.notes.push(`mapping "${x.crmName}": no case this week`); continue; }
    consider(c, { kind: "identity_attach", competitorId: x.competitorId! }, x.reason, `attach "${x.crmName}" → ${x.competitorId}`);
  }
  const dups = byKind("duplicate_group");
  for (const x of d.countOnceDuplicateGroups) {
    const label = `${x.technician} ${x.date}${x.profit !== null ? ` $${x.profit.toFixed(2)}` : ""}`;
    if (x.status === "confirmed") {
      const c = dups.find((g) => x.excludeJobIds.every((id) => (g.data as DuplicateCaseData).jobs.some((j) => j.id === id)));
      if (!c) { plan.notes.push(`count once ${label}: its jobs are not a suspected group this week`); continue; }
      consider(c, { kind: "duplicate_confirmed", excludeJobIds: [...x.excludeJobIds].sort() }, x.reason, `count once ${label}`);
    } else {
      const c = dups.find((g) => {
        const gd = g.data as DuplicateCaseData;
        const who = [gd.competitorName, ...gd.jobs.map((j) => j.tech)].map((s) => s.trim().toLowerCase());
        return gd.date === x.date && who.includes(x.technician.trim().toLowerCase()) &&
          (x.profit === null || gd.jobs.every((j) => Math.abs(j.profit - x.profit!) < 0.005));
      });
      if (c) plan.notes.push(`pending office confirmation ${label}: counted both ways for now — jobs ${(c.data as DuplicateCaseData).jobs.map((j) => j.id).join(", ")}`);
    }
  }
  for (const c of byKind("display_name")) {
    const data = c.data as DisplayNameCaseData;
    const x = d.displayNameOverrides.find((o) =>
      (o.competitorId && o.competitorId === data.competitorId) ||
      (!o.competitorId && [data.fullName, data.currentName].some((n) => n && n.trim() === o.fullName.trim())));
    if (x) consider(c, { kind: "display_name", displayName: x.displayName.trim() }, x.reason, `display name "${x.displayName}" for ${data.fullName ?? data.currentName}`);
  }
  return plan;
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

/** The fingerprint written in an owner-confirmed file (first 64-hex token). */
export function readFingerprintFile(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  const m = /\b([0-9a-f]{64})\b/i.exec(fs.readFileSync(file, "utf8"));
  return m ? m[1].toLowerCase() : "";
}

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export function rulesSummary(r: ArenaRules): string[] {
  const mi = r.mostImproved;
  return [
    `methodology ${r.scoring.methodology ?? "WEIGHTED_V0 (field absent)"} · timezone ${r.timezone}`,
    `minimums: ${r.eligibility.minQualifyingJobs} qualifying jobs · AVG TICKET ≥ ${usd(r.eligibility.minAvgTicketCents)} · Closing Rate ≥ ${r.eligibility.minClosingRateBp / 100}%`,
    `targets: Closing Rate ${r.scoring.closingRate.targetBp / 100}% (cap ${r.scoring.closingRate.cap}) · AVG TICKET ${usd(r.scoring.avgTicket.targetCents)} (cap ${r.scoring.avgTicket.cap})` +
      ((r.scoring.methodology ?? "WEIGHTED_V0") === "WEIGHTED_V0" ? ` · weights ${r.scoring.closingRate.weight}/${r.scoring.avgTicket.weight}` : ""),
    `prizes: ${r.prizes.positionsCents.map((c, i) => `#${i + 1} ${usd(c)}`).join(" · ")} · budget ${usd(r.prizes.budgetCents)}`,
    `Most Improved: ${mi.enabled ? `${usd(mi.amountCents)}; baseline ${mi.baselineWeeks} weeks, ≥ ${mi.minValidWeeks} valid, ≥ ${mi.minQualifyingJobsPerWeek} qualifying jobs per baseline week, improvement > ${mi.minImprovement}` : "off"}`,
    `qualifying statuses: ${r.qualifying.statuses.join(", ")}`,
    `tie-break: ${r.tieBreak.join(" → ")}`,
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
const TECH_OR_WB_ENV = /^(ARENA_TECH_ENABLED|ARENA_TECH_.*|ARENA_WB_.*|ARENA_VERIFIER|ARENA_FAKE_VERIFIER_FILE|ARENA_PASS_.*|WB_.*|.*WEEKLY_BALANCE.*|.*SUPABASE.*)$/i;
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
 * ORIGINAL rule version with today's engine and today's review decisions, and
 * compare field by field. Other frozen snapshots are listed for information
 * only (`counts: false`): a snapshot taken before later review decisions is
 * expected to differ and is never what was approved.
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
  const results = await arena.collection("arena_result").find({}).sort({ _id: 1 }).toArray();
  const approvedSnaps = new Set(results.map((r) => r.snapshotId as string));
  for (const res of results) {
    const snap = await arena.collection("arena_snapshot").findOne({ _id: res.snapshotId });
    await cmp(`approved ${res._id}`, res.ruleVersionId, res.weekStart, res.standings, res.standings, fmt(snap?.result), true);
  }
  const frozen = await arena.collection("arena_snapshot").find({ kind: { $in: ["provisional", "reconciled"] } }).sort({ _id: 1 }).toArray();
  for (const s of frozen) {
    const stored = s.result.results.map(toStanding);
    await cmp(`snapshot ${s._id}${approvedSnaps.has(s._id as unknown as string) ? " (approved)" : " (informational)"}`, s.ruleVersionId, s.weekStart, stored, s.result.results, fmt(s.result), approvedSnaps.has(s._id as unknown as string));
  }
  const counted = lines.filter((l) => l.counts);
  return { lines, identical: counted.filter((l) => l.verdict === "IDENTICAL").length, mismatched: counted.filter((l) => l.verdict === "MISMATCH").length };
}
