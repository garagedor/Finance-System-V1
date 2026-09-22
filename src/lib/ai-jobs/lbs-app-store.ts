import type { AiJobDoc, AiJobMeta, AiValidationFlag, IngestResult } from "./types";
import type { JobRow } from "@/types/job";
import {
  cleanupDecision,
  isLbsAppRecord,
  mediaReleasePlan,
  planLbsAppIngest,
  toReadback,
  type LbsAppExtras,
} from "./lbs-app.ts";

// ─────────────────────────────────────────────────────────────────────────────
// The LBS App doors' database steps, written against the minimal collection
// surface they use so the regression suite can run them against an in-memory
// double (src/lib/ai-jobs/lbs-app.test.ts). Server code passes the real
// ag.Job_ai / AiJobLink / AiJobCleanup collections. Never ag.Job.
// ─────────────────────────────────────────────────────────────────────────────

/** The subset of a Mongo Collection these steps call. */
export interface StoreColl {
  findOne(filter: any): Promise<any>;
  find(filter: any): { limit(n: number): { toArray(): Promise<any[]> }; toArray(): Promise<any[]> };
  insertOne(doc: any): Promise<{ insertedId: unknown }>;
  updateOne(filter: any, update: any): Promise<unknown>;
  deleteOne(filter: any): Promise<{ deletedCount?: number }>;
  deleteMany(filter: any): Promise<{ deletedCount?: number }>;
}

export interface StoreResponse {
  status: number;
  body: Record<string, unknown>;
}

export async function executeLbsAppIngest(
  jobs: StoreColl,
  input: {
    ingestId: string;
    normalized: Partial<JobRow>;
    aiMeta: AiJobMeta;
    externalJobId: string;
    lbs: LbsAppExtras;
    validation: AiValidationFlag[];
    now: string;
  },
): Promise<IngestResult | { ok: false; status: number; error: string }> {
  const { ingestId, normalized, aiMeta, externalJobId, lbs, validation, now } = input;
  const existing = (await jobs.findOne({ "aiMeta.ingestId": ingestId })) as AiJobDoc | null;
  const plan = planLbsAppIngest(existing, { normalized, aiMeta, externalJobId, lbs }, now);
  const base = { ok: true as const, ingestId, ingestIdKind: "client" as const, validation, duplicateProtection: true };

  if (plan.op === "reject") return { ok: false, status: plan.status, error: plan.reason };
  if (plan.op === "noop") return { ...base, status: "updated", id: String(existing!._id), duplicate: true };
  if (plan.op === "update") {
    // Job writes: guard the push on version+operation being absent so two
    // racing retries of the same version cannot both append.
    const guard =
      plan.push.job === null
        ? {}
        : { aiVersions: { $not: { $elemMatch: { version: plan.push.version, operation: plan.push.operation } } } };
    await jobs.updateOne({ _id: existing!._id, ...guard }, { $set: plan.set, $push: { aiVersions: plan.push } });
    return { ...base, status: "updated", id: String(existing!._id), duplicate: false };
  }
  try {
    const res = await jobs.insertOne(plan.doc);
    return { ...base, status: "created", id: String(res.insertedId), duplicate: false };
  } catch (e: any) {
    // Racing first sends: with a unique index on aiMeta.ingestId the loser
    // becomes a duplicate rather than a second row.
    if (e?.code === 11000) {
      const winner = await jobs.findOne({ "aiMeta.ingestId": ingestId });
      return { ...base, status: "updated", id: String(winner?._id), duplicate: true };
    }
    throw e;
  }
}

/** Rows carrying this logical job id that belong to the LBS App integration.
 *  Anything else (human rows, other writers) is invisible through these doors. */
export async function findLbsAppRows(jobs: StoreColl, logicalJobId: string): Promise<AiJobDoc[]> {
  const rows = (await jobs
    .find({ $or: [{ externalJobId: logicalJobId }, { "aiMeta.ingestId": logicalJobId }] })
    .limit(5)
    .toArray()) as AiJobDoc[];
  return rows.filter(isLbsAppRecord);
}

/** GET /jobs/{id}: the integration's own record, or 404 (never reveals whether
 *  a non-integration row with that id exists). */
export async function readLbsApp(jobs: StoreColl, logicalJobId: string): Promise<StoreResponse> {
  const rows = await findLbsAppRows(jobs, logicalJobId);
  if (rows.length === 0) return { status: 404, body: { ok: false, error: "Not found" } };
  if (rows.length > 1) return { status: 409, body: { ok: false, error: "Ambiguous: more than one row for this id" } };
  return { status: 200, body: { ok: true, id: logicalJobId, job: toReadback(rows[0]) } };
}

/**
 * DELETE /jobs/{id}: TEST-only cleanup. Deletes the mirror row (its version
 * history + media identifiers live inside it) and its AiJobLink comparison
 * rows, after writing an audit tombstone to AiJobCleanup. Refuses unless
 * cleanupDecision() proves LBS App channel + TEST on every version + no human
 * edits; the delete filter re-asserts the fence so a concurrent edit wins.
 * Physical media is never touched (it lives in the LBS App). Idempotent: a
 * repeat returns `already_cleaned`.
 */
export async function cleanupLbsApp(
  colls: { jobs: StoreColl; links: StoreColl; log: StoreColl },
  logicalJobId: string,
  now: string,
): Promise<StoreResponse> {
  const { jobs, links, log } = colls;
  const rows = await findLbsAppRows(jobs, logicalJobId);
  if (rows.length === 0) {
    const tomb = await log.findOne({ logical_job_id: logicalJobId });
    if (tomb) return { status: 200, body: { ok: true, id: logicalJobId, status: "already_cleaned", cleanedAt: tomb.cleanedAt } };
    return { status: 404, body: { ok: false, error: "Not found" } };
  }
  if (rows.length > 1) {
    return { status: 409, body: { ok: false, refused: true, code: "ambiguous_provenance", reason: "More than one row for this id" } };
  }
  const doc = rows[0];
  const decision = cleanupDecision(doc);
  if (!decision.allowed) {
    return { status: 409, body: { ok: false, refused: true, id: logicalJobId, code: decision.code, reason: decision.reason } };
  }

  const mediaIds = (doc.aiMedia ?? []).map((m) => m.media_id);
  const shas = (doc.aiMedia ?? []).map((m) => m.sha256).filter(Boolean);
  const others = mediaIds.length
    ? ((await jobs
        .find({ _id: { $ne: doc._id }, $or: [{ "aiMedia.media_id": { $in: mediaIds } }, { "aiMedia.sha256": { $in: shas } }] })
        .toArray()) as AiJobDoc[])
    : [];
  const media = mediaReleasePlan(doc, others);
  const rowId = String(doc._id);

  await log.insertOne({
    logical_job_id: logicalJobId,
    rowId,
    cleanedAt: now,
    environment: doc.aiMeta?.environment,
    channel: doc.aiMeta?.channel,
    versions: (doc.aiVersions ?? []).map((v) => ({ version: v.version, operation: v.operation, receivedAt: v.receivedAt })),
    media,
  });
  const del = await jobs.deleteOne({
    _id: doc._id,
    "aiMeta.channel": doc.aiMeta?.channel,
    "aiMeta.environment": "TEST",
    aiLastEditedAt: null,
  });
  if (!del.deletedCount) {
    return { status: 409, body: { ok: false, refused: true, code: "changed_during_cleanup", reason: "Row changed during cleanup; preserved" } };
  }
  const removedLinks = await links.deleteMany({ aiJobId: rowId });
  return {
    status: 200,
    body: {
      ok: true,
      id: logicalJobId,
      status: "cleaned",
      removed: { job: 1, versions: doc.aiVersions?.length ?? 0, comparisonLinks: removedLinks.deletedCount ?? 0 },
      media,
    },
  };
}
