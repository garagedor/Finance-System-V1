/**
 * Weekly SOURCE snapshots and late CRM changes.
 *
 * A frozen/reviewed snapshot stores, next to its result, the exact engine input
 * it was computed from: every CRM job read (id, tech, date, status, location,
 * profit), the competitor map, the review decisions in force, the account
 * standings, when the read happened and who/what was read. Re-running the
 * engine on that stored input reproduces the stored result hash-identically,
 * whatever the CRM looks like today.
 *
 * Every later re-read is diffed job by job against the freeze snapshot
 * (`diffJobs`), and the effect on prizes is measured by recomputing the freeze
 * job set with today's other inputs (`lateImpact`): only the CRM job edits are
 * measured, never review decisions taken meanwhile.
 *
 * Pure: no I/O, no clock.
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "./config";
import { computeCompetition } from "./engine";
import { addDays } from "./week";
import type { AccountInput, ArenaJob, ArenaRules, CompetitionResult, CompetitorMap, CompetitorResult, JobExclusion } from "./types";

export const SOURCE_SCHEMA = "arena-source/1" as const;

/** Where the jobs were read from. Never contains a password or a connection string. */
export interface SourceIdentity {
  system: "crm";
  database: string;
  collection: string;
  /** The database user the read was made as, when known (null = the app's own connection, user not exposed). */
  user: string | null;
  /** Free text: which code path read it (e.g. "admin-service", "shadow-approve (read-only guard)"). */
  via: string;
}

export interface SerializedCompetitorMap {
  competitors: CompetitorMap["competitors"];
  byCrmName: [string, string][];
  issues: CompetitorMap["issues"];
  nameFormat?: CompetitorMap["nameFormat"];
  publicNames?: [string, NonNullable<CompetitorMap["publicNames"]> extends Map<string, infer V> ? V : never][];
  /** Owner-excluded competitor ids (absent when none: older sources hash as before). */
  notParticipating?: string[];
}

export interface SourceSnapshot {
  schema: typeof SOURCE_SCHEMA;
  /** When the CRM was read (the moment the job set below was true). */
  readAt: string;
  identity: SourceIdentity;
  /** Service-date window read: the competition week plus the Most Improved baseline weeks. */
  window: { from: string; toExclusive: string };
  /** Every job read, sorted by id. */
  jobs: ArenaJob[];
  /** sha256 of the canonical job list. */
  jobsHash: string;
  /**
   * CRM edit timestamps, when the job documents carry one. `field` is null when
   * none of the read documents has an update-timestamp field: then only the
   * DETECTION time of a change is known, never the edit time.
   */
  updateTimestamps: { field: string | null; byJobId: Record<string, string> };
  competitors: SerializedCompetitorMap;
  exclusions: JobExclusion[];
  dismissedDuplicateGroups: string[];
  accounts: Record<string, AccountInput>;
  /** Set when the job list was taken from an earlier snapshot (owner chose "keep freeze snapshot"). */
  jobsFrom?: { snapshotId: string; readAt: string } | null;
  /** sha256 of everything above except this field. */
  inputHash: string;
}

/** JSON-plain copy (drops `undefined`, so what is hashed is exactly what MongoDB stores). */
export const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
export const hashOf = (x: unknown) => createHash("sha256").update(canonicalJson(plain(x))).digest("hex");
/** Hash of a computed result (the reproducibility fingerprint stored on a snapshot). */
export const resultHash = (r: CompetitionResult) => hashOf(r);

export function serializeCompetitorMap(m: CompetitorMap): SerializedCompetitorMap {
  return plain({
    competitors: m.competitors,
    byCrmName: [...m.byCrmName.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    issues: m.issues,
    ...(m.nameFormat ? { nameFormat: m.nameFormat } : {}),
    ...(m.publicNames ? { publicNames: [...m.publicNames.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)) } : {}),
    ...(m.notParticipating?.length ? { notParticipating: [...m.notParticipating].sort() } : {}),
  }) as SerializedCompetitorMap;
}

export function deserializeCompetitorMap(s: SerializedCompetitorMap): CompetitorMap {
  return {
    competitors: s.competitors,
    byCrmName: new Map(s.byCrmName),
    issues: s.issues,
    ...(s.nameFormat ? { nameFormat: s.nameFormat } : {}),
    ...(s.publicNames ? { publicNames: new Map(s.publicNames) } : {}),
    ...(s.notParticipating?.length ? { notParticipating: [...s.notParticipating] } : {}),
  } as CompetitorMap;
}

const sortJobs = (jobs: ArenaJob[]) => [...jobs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export interface SourceInput {
  readAt: string;
  identity: SourceIdentity;
  window: { from: string; toExclusive: string };
  jobs: ArenaJob[];
  updateTimestamps?: { field: string | null; byJobId: Record<string, string> };
  competitors: CompetitorMap;
  exclusions?: JobExclusion[];
  dismissedDuplicateGroups?: string[];
  accounts: Readonly<Record<string, AccountInput>>;
  jobsFrom?: { snapshotId: string; readAt: string } | null;
}

export function buildSource(i: SourceInput): SourceSnapshot {
  const jobs = plain(sortJobs(i.jobs));
  const base: Omit<SourceSnapshot, "inputHash"> = plain({
    schema: SOURCE_SCHEMA,
    readAt: i.readAt,
    identity: i.identity,
    window: i.window,
    jobs,
    jobsHash: hashOf(jobs),
    updateTimestamps: i.updateTimestamps ?? { field: null, byJobId: {} },
    competitors: serializeCompetitorMap(i.competitors),
    exclusions: i.exclusions ?? [],
    dismissedDuplicateGroups: [...(i.dismissedDuplicateGroups ?? [])].sort(),
    accounts: { ...i.accounts },
    ...(i.jobsFrom ? { jobsFrom: i.jobsFrom } : {}),
  });
  return { ...base, inputHash: hashOf(base) };
}

/** The same source with another job list (other inputs unchanged), re-hashed. */
export function withJobs(s: SourceSnapshot, jobs: ArenaJob[], jobsFrom: SourceSnapshot["jobsFrom"]): SourceSnapshot {
  const { inputHash: _drop, ...rest } = s;
  void _drop;
  const sorted = plain(sortJobs(jobs));
  const base = plain({ ...rest, jobs: sorted, jobsHash: hashOf(sorted), jobsFrom: jobsFrom ?? null });
  return { ...base, inputHash: hashOf(base) };
}

/** Problems with a stored source (tampered or corrupted): empty = the hashes hold. */
export function sourceProblems(s: SourceSnapshot): string[] {
  const p: string[] = [];
  if (s.schema !== SOURCE_SCHEMA) p.push(`unknown source schema ${String(s.schema)}`);
  if (hashOf(s.jobs) !== s.jobsHash) p.push("job list does not match its hash");
  const { inputHash, ...rest } = s;
  if (hashOf(rest) !== inputHash) p.push("source input does not match its hash");
  return p;
}

/** Run the engine on a stored source. Same inputs → the same result, bit for bit. */
export function computeFromSource(s: SourceSnapshot, rules: ArenaRules, rulesHashValue: string, weekStart: string): CompetitionResult {
  return computeCompetition({
    rules,
    rulesHash: rulesHashValue,
    weekStart,
    competitors: deserializeCompetitorMap(s.competitors),
    jobs: s.jobs,
    exclusions: s.exclusions,
    dismissedDuplicateGroups: s.dismissedDuplicateGroups,
    accounts: s.accounts,
  });
}

// ── job diff ───────────────────────────────────────────────────────────────

export type JobChangeKind =
  | "removed" // gone from the CRM (deleted), or no longer returned and not found by id
  | "redated_out" // moved out of its week (or its date cleared)
  | "redated_in" // moved into the competition week from a baseline week
  | "reassigned" // a different technician (or none)
  | "status"
  | "profit"
  | "location"
  | "date" // re-dated within the same week (no effect on any count)
  | "added"; // new in the read: a late entry, or re-dated / re-assigned into the window

export interface JobChange {
  jobId: string;
  kind: JobChangeKind;
  /** Which week of the window the job belongs to (by its freeze date; for "added", its new date). */
  week: "competition" | "baseline";
  techBefore: string | null;
  techAfter: string | null;
  before: string | null;
  after: string | null;
  detail: string;
  /** When the Arena noticed (the re-read time). NOT the CRM edit time. */
  detectedAt: string;
  /** The CRM document's own update timestamp, when it has one (null = not recorded by the CRM). */
  crmUpdatedAt: string | null;
}

/** What a by-id lookup of a job that vanished from the read found. */
export type JobLookup = ArenaJob | "no_date" | "deleted";

const MONEY_EPS = 0.005;
const money = (x: number) => `$${x.toFixed(2)}`;

export function diffJobs(
  before: SourceSnapshot,
  after: SourceSnapshot,
  weekStart: string,
  detectedAt: string,
  lookup: Readonly<Record<string, JobLookup>> = {},
): JobChange[] {
  const weekEnd = addDays(weekStart, 7);
  const inWeek = (d: string) => d >= weekStart && d < weekEnd;
  const weekOf = (d: string): JobChange["week"] => (inWeek(d) ? "competition" : "baseline");
  const B = new Map(before.jobs.map((j) => [j.id, j]));
  const A = new Map(after.jobs.map((j) => [j.id, j]));
  const upd = (id: string) => after.updateTimestamps?.byJobId?.[id] ?? null;
  const out: JobChange[] = [];
  const push = (c: Omit<JobChange, "detectedAt" | "crmUpdatedAt">) => out.push({ ...c, detectedAt, crmUpdatedAt: upd(c.jobId) });

  for (const [id, b] of B) {
    const a = A.get(id);
    if (!a) {
      const l = lookup[id];
      const base = { jobId: id, week: weekOf(b.date), techBefore: b.tech };
      if (l === "deleted")
        push({ ...base, kind: "removed", techAfter: null, before: `${b.date} · ${b.status} · ${money(b.profit)}`, after: null, detail: "deleted from the CRM" });
      else if (l === "no_date")
        push({ ...base, kind: "redated_out", techAfter: null, before: b.date, after: null, detail: "service date cleared or invalid now" });
      else if (l && typeof l === "object" && !l.tech.trim())
        push({ ...base, kind: "reassigned", techAfter: "", before: b.tech, after: "(nobody)", detail: "unassigned: no technician on the job now" });
      else if (l && typeof l === "object" && (l.date < before.window.from || l.date >= before.window.toExclusive))
        push({ ...base, kind: "redated_out", techAfter: l.tech, before: b.date, after: l.date, detail: `re-dated out of the ${weekOf(b.date)} week to ${l.date}` });
      else
        push({ ...base, kind: "removed", techAfter: null, before: `${b.date} · ${b.status} · ${money(b.profit)}`, after: null, detail: l ? "no longer returned by the read" : "no longer in the read (not looked up by id)" });
      continue;
    }
    const wk = weekOf(b.date);
    const base = { jobId: id, week: wk, techBefore: b.tech, techAfter: a.tech };
    if (inWeek(b.date) && !inWeek(a.date))
      push({ ...base, kind: "redated_out", before: b.date, after: a.date, detail: `re-dated out of the competition week to ${a.date}` });
    else if (!inWeek(b.date) && inWeek(a.date))
      push({ ...base, kind: "redated_in", before: b.date, after: a.date, detail: `re-dated into the competition week from ${b.date}` });
    else if (b.date !== a.date)
      push({ ...base, kind: "date", before: b.date, after: a.date, detail: "re-dated within the same week" });
    if (b.tech !== a.tech) push({ ...base, kind: "reassigned", before: b.tech, after: a.tech, detail: `re-assigned ${b.tech} → ${a.tech}` });
    if (b.status !== a.status) push({ ...base, kind: "status", before: b.status, after: a.status, detail: `status ${b.status} → ${a.status}` });
    if (Math.abs(b.profit - a.profit) > MONEY_EPS)
      push({ ...base, kind: "profit", before: money(b.profit), after: money(a.profit), detail: `profit ${money(b.profit)} → ${money(a.profit)}` });
    if (b.location !== a.location) push({ ...base, kind: "location", before: b.location, after: a.location, detail: `location ${b.location} → ${a.location}` });
  }
  for (const [id, a] of A) {
    if (B.has(id)) continue;
    push({
      jobId: id, kind: "added", week: weekOf(a.date), techBefore: null, techAfter: a.tech, before: null,
      after: `${a.date} · ${a.status} · ${money(a.profit)}`, detail: "new in the read (late entry, or re-dated / re-assigned into the window)",
    });
  }
  return out.sort((x, y) => (x.jobId < y.jobId ? -1 : x.jobId > y.jobId ? 1 : x.kind < y.kind ? -1 : x.kind > y.kind ? 1 : 0));
}

/** Identity of a set of changes (what changed, not when it was seen). */
export const changeSetHash = (changes: JobChange[]) =>
  hashOf(changes.map(({ detectedAt: _d, crmUpdatedAt: _u, ...c }) => c));

// ── impact on prizes ───────────────────────────────────────────────────────

export interface ImpactSide {
  rank: number;
  score: number;
  eligible: boolean;
  prizeEligible: boolean;
  prizePosition: number | null;
  prizeCents: number;
  wonMostImproved: boolean;
  assignedJobs: number;
  closedJobs: number;
  qualifyingJobs: number;
  profit: number;
}

export interface ImpactRow {
  competitorId: string;
  displayName: string;
  before: ImpactSide | null;
  after: ImpactSide | null;
  /** This row changes a prize, Most Improved, or a prize-relevant eligibility. */
  material: boolean;
  why: string[];
}

export interface LateImpact {
  material: boolean;
  reasons: string[];
  rows: ImpactRow[];
}

const side = (r: CompetitorResult | undefined): ImpactSide | null =>
  r
    ? {
        rank: r.rank, score: r.score, eligible: r.eligible, prizeEligible: r.prizeEligible ?? r.eligible,
        prizePosition: r.prizePosition, prizeCents: r.prizeCents, wonMostImproved: r.wonMostImproved,
        assignedJobs: r.assignedJobs, closedJobs: r.closedJobs, qualifyingJobs: r.qualifyingJobs, profit: r.profitMicro / 1e6,
      }
    : null;

const holds = (s: ImpactSide | null) => !!s && (s.prizePosition !== null || s.wonMostImproved || s.prizeCents > 0);
const prizeLabel = (s: ImpactSide | null) =>
  !s ? "not in the standings" : s.prizePosition !== null ? `#${s.prizePosition} ($${(s.prizeCents / 100).toFixed(0)})` : s.wonMostImproved ? `Most Improved ($${(s.prizeCents / 100).toFixed(0)})` : "no prize";

/**
 * Compare the result computed from the frozen job set (`base`) with the one
 * from the new read (`now`), other inputs identical. Material = any prize
 * position or amount changes hands, the Most Improved winner changes, or a
 * prize-relevant competitor (holds a prize in either result, or ranks at or
 * above the last prize holder) gains or loses eligibility.
 */
export function lateImpact(base: CompetitionResult, now: CompetitionResult): LateImpact {
  const a = new Map(base.results.map((r) => [r.competitorId, r]));
  const b = new Map(now.results.map((r) => [r.competitorId, r]));
  const cutoff = (r: CompetitionResult) => Math.max(0, ...r.results.filter((x) => x.prizePosition !== null || x.wonMostImproved).map((x) => x.rank));
  const cut = Math.max(cutoff(base), cutoff(now));
  const rows: ImpactRow[] = [];
  const reasons: string[] = [];
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const before = side(a.get(id));
    const after = side(b.get(id));
    if (canonicalJson(before) === canonicalJson(after)) continue;
    const name = (b.get(id) ?? a.get(id))!.displayName;
    const why: string[] = [];
    if ((before?.prizePosition ?? null) !== (after?.prizePosition ?? null) || (before?.prizeCents ?? 0) !== (after?.prizeCents ?? 0))
      why.push(`prize ${prizeLabel(before)} → ${prizeLabel(after)}`);
    if ((before?.wonMostImproved ?? false) !== (after?.wonMostImproved ?? false))
      why.push(after?.wonMostImproved ? "now wins Most Improved" : "no longer wins Most Improved");
    const relevant = holds(before) || holds(after) || (before?.rank ?? Infinity) <= cut || (after?.rank ?? Infinity) <= cut;
    if (relevant && ((before?.eligible ?? false) !== (after?.eligible ?? false) || (before?.prizeEligible ?? false) !== (after?.prizeEligible ?? false)))
      why.push(after?.prizeEligible ? "becomes prize-eligible" : "loses prize eligibility");
    rows.push({ competitorId: id, displayName: name, before, after, material: why.length > 0, why });
    if (why.length) reasons.push(`${name}: ${why.join(", ")}`);
  }
  if (base.mostImprovedWinner !== now.mostImprovedWinner && !reasons.some((r) => /Most Improved/.test(r)))
    reasons.push(`Most Improved winner ${base.mostImprovedWinner ?? "none"} → ${now.mostImprovedWinner ?? "none"}`);
  rows.sort((x, y) => (x.after?.rank ?? x.before?.rank ?? Infinity) - (y.after?.rank ?? y.before?.rank ?? Infinity));
  return { material: reasons.length > 0, reasons, rows };
}

// ── the report stored on a snapshot ────────────────────────────────────────

export interface LateChangeReport {
  /** The snapshot the re-read is compared with (the freeze, or the approved one). */
  against: { snapshotId: string; readAt: string; jobsHash: string };
  read: { readAt: string; jobsHash: string };
  detectedAt: string;
  changes: JobChange[];
  changeSetHash: string;
  impact: LateImpact;
  /** The CRM field that carried edit times, or null (then only detection times are known). */
  updateTimestampField: string | null;
}

export function lateChangeReport(input: {
  against: { snapshotId: string; source: SourceSnapshot };
  read: SourceSnapshot;
  weekStart: string;
  detectedAt: string;
  lookup?: Readonly<Record<string, JobLookup>>;
  /** Result of the frozen jobs under the read's other inputs, and of the read itself. */
  baseResult: CompetitionResult;
  readResult: CompetitionResult;
}): LateChangeReport {
  const changes = diffJobs(input.against.source, input.read, input.weekStart, input.detectedAt, input.lookup);
  return {
    against: { snapshotId: input.against.snapshotId, readAt: input.against.source.readAt, jobsHash: input.against.source.jobsHash },
    read: { readAt: input.read.readAt, jobsHash: input.read.jobsHash },
    detectedAt: input.detectedAt,
    changes,
    changeSetHash: changeSetHash(changes),
    impact: changes.length ? lateImpact(input.baseResult, input.readResult) : { material: false, reasons: [], rows: [] },
    updateTimestampField: input.read.updateTimestamps?.field ?? null,
  };
}

/** Ids that vanished from a read relative to `before` (to look up by id). */
export const vanishedIds = (before: SourceSnapshot, after: SourceSnapshot) => {
  const now = new Set(after.jobs.map((j) => j.id));
  return before.jobs.filter((j) => !now.has(j.id)).map((j) => j.id);
};
