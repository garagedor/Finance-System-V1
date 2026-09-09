import "server-only";
import { ObjectId } from "mongodb";
import { toNumber } from "@/app/api/utils/calculations";
import { normalizeApprovals } from "@/app/utils/jobUtils";
import { canonicalStatus } from "@/lib/status-canonical";
import { normalizeJobDate } from "@/lib/job-mirror";
import type { JobRow } from "@/types/job";
import { aiJobsCollection } from "./collection";
import type { AiEditEntry, AiJobDoc } from "./types";

// CRUD over ag.Job_ai for the Tables AI UI. Satisfies the same request/response
// contract the production /api/jobs uses (so the shared table components work
// unchanged), but is a self-contained implementation — production /api/jobs and
// ag.Job are NOT touched.

const NUMBER_FIELDS = new Set<string>([
  "totalAmount", "techPaidCash", "totalPaidCard", "totalPaidCompanyCheck",
  "totalPaidFinance", "totalPaidCompanyCash", "techParts", "companyParts",
  "lmParts", "lmCash", "lmCheck", "tipsCard", "tipsFinance", "tipsCompanyCash",
  "tipsCheck",
]);
const BOOLEAN_FIELDS = new Set<string>(["needTracking"]);
const TEXT_SEARCH_FIELDS = ["tech", "status", "address", "location", "provider", "clientName", "clientPhoneNumber", "invoiceNumber", "notes"];
// Provenance fields the UI must never send back as job data on save.
const RESERVED = new Set<string>(["aiOriginal", "aiMeta", "aiEditLog", "aiLastEditedAt", "aiLastEditedBy", "_firstIngestAt"]);

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function coerce(field: string, value: unknown): unknown {
  if (NUMBER_FIELDS.has(field)) return toNumber(value);
  if (BOOLEAN_FIELDS.has(field)) return Boolean(value);
  return value;
}

interface ListParams {
  page?: number;
  pageSize?: number;
  sortBy?: string | null;
  sortDir?: "asc" | "desc";
  filters?: Array<{ field: string; value: unknown; operator?: string }>;
  filterLogic?: "AND" | "OR";
  search?: string;
  limitFirst50?: boolean;
}

export async function listAiJobs(params: ListParams) {
  const coll = await aiJobsCollection();
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.max(1, Math.min(500, params.pageSize ?? 50));
  const limitFirst50 = Boolean(params.limitFirst50);

  const conditions: Record<string, any>[] = [];
  for (const rule of params.filters ?? []) {
    const field = (rule.field ?? "").toString().trim();
    if (!field) continue;
    const op = rule.operator ?? "contains";
    const val = coerce(field, rule.value);
    let cond: any = null;
    if (NUMBER_FIELDS.has(field) || BOOLEAN_FIELDS.has(field)) {
      if (["gt", "lt", "gte", "lte"].includes(op)) cond = { [`$${op}`]: val };
      else cond = { $eq: val };
    } else {
      const s = escapeRegex(String(val ?? ""));
      if (op === "equals") cond = { $eq: val };
      else if (op === "startsWith") cond = { $regex: `^${s}`, $options: "i" };
      else if (op === "endsWith") cond = { $regex: `${s}$`, $options: "i" };
      else cond = { $regex: s, $options: "i" };
    }
    if (cond) conditions.push({ [field]: cond });
  }

  const search = (params.search ?? "").trim();
  if (search.length >= 2) {
    const s = escapeRegex(search);
    conditions.push({ $or: TEXT_SEARCH_FIELDS.map((f) => ({ [f]: { $regex: s, $options: "i" } })) });
  }

  const logic = params.filterLogic === "OR" ? "$or" : "$and";
  const query: any = conditions.length ? { [logic]: conditions } : {};

  const sortBy = params.sortBy;
  const sortDir = params.sortDir === "asc" ? 1 : -1;

  const total = await coll.countDocuments(query);
  const effectivePageSize = limitFirst50 ? 50 : pageSize;
  const skip = limitFirst50 ? 0 : (page - 1) * effectivePageSize;

  let cursor = coll.find(query);
  if (sortBy === "date") cursor = cursor.sort({ date: sortDir, _id: sortDir });
  else if (sortBy) cursor = cursor.sort({ [sortBy]: sortDir });
  else cursor = cursor.sort({ _id: -1 });
  if (!limitFirst50) cursor = cursor.skip(skip);
  const rowsRaw = await cursor.limit(effectivePageSize).toArray();

  const rows = rowsRaw.map((r: any) => ({
    ...r,
    approvals: normalizeApprovals(r.approvals),
    _id: r._id?.toString(),
  }));
  return { rows, total, page: limitFirst50 ? 1 : page, pageSize: effectivePageSize, limited: limitFirst50 && total > effectivePageSize };
}

function stripReserved(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (RESERVED.has(k)) continue;
    out[k] = v;
  }
  return out;
}

/** Human-created row in the sandbox. Freezes aiOriginal from the created values. */
export async function createAiJob(body: Record<string, unknown>, actor: string) {
  const coll = await aiJobsCollection();
  const clean = stripReserved(body);
  delete clean._id;
  const doc: AiJobDoc = { ...(clean as JobRow), approvals: normalizeApprovals((clean as any).approvals) };
  if (typeof doc.date === "string") {
    const d = normalizeJobDate(doc.date);
    if (d) doc.jobDateNormalized = d;
  }
  if (typeof doc.status === "string" && doc.status.trim()) doc.statusCanonical = canonicalStatus(doc.status);
  const now = new Date().toISOString();
  doc.aiOriginal = { ...(clean as Partial<JobRow>) };
  doc.aiMeta = { source: "manual", eventType: "other", ingestId: `manual_${now}`, ingestIdKind: "generated", ingestedAt: now, refs: {}, validation: [] };
  doc.aiEditLog = [];
  doc.aiLastEditedAt = null;
  doc.aiLastEditedBy = actor || "unknown";
  const res = await coll.insertOne(doc as any);
  return { created: { ...doc, _id: res.insertedId.toString() } };
}

/** Reviewer edit. NEVER mutates aiOriginal; records the change in aiEditLog. */
export async function updateAiJob(id: string, body: Record<string, unknown>, actor: string) {
  const coll = await aiJobsCollection();
  const filter: any = ObjectId.isValid(id) && String(id).length === 24 ? { _id: new ObjectId(id) } : { _id: id };
  const current = (await coll.findOne(filter)) as AiJobDoc | null;
  if (!current) return { notFound: true as const };

  const update = stripReserved(body);
  delete update._id;
  delete (update as any).id;
  if ("date" in update) update.jobDateNormalized = normalizeJobDate(update.date as string) as any;
  if ("status" in update) update.statusCanonical = canonicalStatus(update.status) as any;
  if ("approvals" in update) update.approvals = normalizeApprovals((update as any).approvals) as any;

  // Diff for the edit log (only fields actually changing).
  const changes: AiEditEntry["changes"] = {};
  for (const [k, v] of Object.entries(update)) {
    if (k === "jobDateNormalized" || k === "statusCanonical") continue;
    if ((current as any)[k] !== v) changes[k] = { from: (current as any)[k] ?? null, to: v };
  }
  const now = new Date().toISOString();
  const editEntry: AiEditEntry = { at: now, by: actor || "unknown", changes };

  const setDoc: any = { ...update, aiLastEditedAt: now, aiLastEditedBy: actor || "unknown" };
  const result = await coll.findOneAndUpdate(
    filter,
    // aiOriginal is intentionally never in $set. $push appends the edit entry.
    { $set: setDoc, $push: { aiEditLog: editEntry } } as any,
    { returnDocument: "after" as any },
  );
  const doc: any = (result as any)?.value ?? result;
  if (!doc) return { notFound: true as const };
  return { updated: { ...doc, _id: doc._id?.toString() } };
}

export async function deleteAiJob(id: string) {
  const coll = await aiJobsCollection();
  const filter: any = ObjectId.isValid(id) && String(id).length === 24 ? { _id: new ObjectId(id) } : { _id: id };
  const res = await coll.deleteOne(filter);
  return { deleted: res.deletedCount ?? 0 };
}
