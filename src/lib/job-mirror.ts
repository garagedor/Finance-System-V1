import "server-only";
import type { AnyBulkWriteOperation } from "mongodb";
import { getDb } from "@/lib/finance-db";
import { canonicalStatus } from "@/lib/status-canonical";

// Keeps the report/stats mirror fields (jobDateNormalized, statusCanonical) in
// sync with the source date/status. The mirrors are maintained on every /api/jobs
// write, but an EXTERNAL writer (the mobile/Lovable → Supabase → ag.Job sync)
// edits jobs directly and never sets them, so they drift stale and jobs drop off
// the provider report / skew stats. This resync heals that drift on a schedule.
// It ONLY touches the mirror fields — never the real date/status.

interface JobMirrorDoc {
  _id: unknown;
  date?: string;
  jobDateNormalized?: Date | null;
  status?: string;
  statusCanonical?: string;
}

/** Same date-only semantics as /api/jobs: 'YYYY-MM-DD' → UTC midnight, else null. */
export function normalizeJobDate(raw: unknown): Date | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  const d = new Date(s.slice(0, 10));
  return Number.isNaN(d.getTime()) ? null : d;
}

const isoDay = (d: Date | null | undefined): string | null =>
  d ? new Date(d).toISOString().slice(0, 10) : null;

export interface JobMirrorResult {
  scanned: number;
  dateFixed: number;
  statusFixed: number;
  opsApplied: number;
}

/** Scan all jobs and correct any stale/missing mirror field. Idempotent. */
export async function resyncJobMirrors(): Promise<JobMirrorResult> {
  const db = await getDb();
  const Job = db.collection<JobMirrorDoc>("Job");
  const cursor = Job.find({}, { projection: { date: 1, jobDateNormalized: 1, status: 1, statusCanonical: 1 } });

  let scanned = 0, dateFixed = 0, statusFixed = 0, opsApplied = 0;
  let ops: AnyBulkWriteOperation<JobMirrorDoc>[] = [];
  const flush = async () => {
    if (ops.length) { await Job.bulkWrite(ops, { ordered: false }); opsApplied += ops.length; ops = []; }
  };

  for await (const j of cursor) {
    scanned++;
    const set: Partial<JobMirrorDoc> = {};
    const wantDate = normalizeJobDate(j.date);
    if (wantDate && isoDay(j.jobDateNormalized ?? null) !== isoDay(wantDate)) { set.jobDateNormalized = wantDate; dateFixed++; }
    const wantStatus = canonicalStatus(j.status);
    if (wantStatus && (j.statusCanonical ?? "") !== wantStatus) { set.statusCanonical = wantStatus; statusFixed++; }
    if (Object.keys(set).length) ops.push({ updateOne: { filter: { _id: j._id }, update: { $set: set } } } as AnyBulkWriteOperation<JobMirrorDoc>);
    if (ops.length >= 1000) await flush();
  }
  await flush();
  return { scanned, dateFixed, statusFixed, opsApplied };
}

// Heal-on-read: called by the report/stats routes so the mirror fields are
// fresh before every query — the definitive fix for the recurring drift, with
// NO dependence on a cron. Debounced + atomically claimed via a meta doc so at
// most one resync runs per `maxAgeMs` window no matter how many requests hit at
// once, and it never runs on back-to-back loads. Best-effort: callers ignore
// errors so a heal hiccup can never break the report.
export async function ensureJobMirrorsFresh(maxAgeMs = 5 * 60_000): Promise<boolean> {
  const db = await getDb();
  const meta = db.collection<{ _id: string; last_heal?: string }>("finance_meta");
  const nowIso = new Date().toISOString();
  const cutoffIso = new Date(Date.now() - maxAgeMs).toISOString();

  // Try to claim a stale existing marker atomically.
  const claim = await meta.updateOne(
    { _id: "job_mirror_heal", last_heal: { $lt: cutoffIso } },
    { $set: { last_heal: nowIso } },
  );
  if (claim.modifiedCount > 0) { await resyncJobMirrors(); return true; }

  // No stale marker matched — either it's fresh (skip) or it doesn't exist yet.
  const seed = await meta.updateOne(
    { _id: "job_mirror_heal" },
    { $setOnInsert: { last_heal: nowIso } },
    { upsert: true },
  );
  if (seed.upsertedCount > 0) { await resyncJobMirrors(); return true; }

  return false; // recently healed by another request → skip
}
