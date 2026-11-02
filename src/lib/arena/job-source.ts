/**
 * The Arena's only reader of production jobs. READ-ONLY by construction: it
 * exposes no write path, never touches `Job_ai` (AI shadow records), and reuses
 * the CRM's own functions for every number so the Arena cannot drift from the
 * official KPIs:
 *   - service date  : SRC_FIELDS_STAGE (report-source-match.ts) for the query,
 *                     serviceDate() (same semantics) per row
 *   - status        : canonicalStatus() (status-canonical.ts)
 *   - profit        : calcJobBalances().totalProfit (Balance Report)
 * Customer data is reduced to one-way hashes used only for duplicate grouping.
 */
import { createHash } from "node:crypto";
import { ObjectId, type Db } from "mongodb";
import { calcJobBalances } from "@/app/api/utils/calculations";
import { canonicalStatus } from "@/lib/status-canonical";
import { SRC_FIELDS_STAGE } from "@/lib/report-source-match";
import type { ArenaJob } from "./types";
import type { JobLookup } from "./source-snapshot";
import { serviceDate } from "./week";

/** Production jobs collection. The shadow collection (`Job_ai`) is never read. */
export const PRODUCTION_JOB_COLLECTION = "Job";

const MONEY_FIELDS = [
  "techPaidCash",
  "totalPaidCard",
  "totalPaidCompanyCheck",
  "totalPaidFinance",
  "totalPaidCompanyCash",
  "lmCash",
  "lmCheck",
  "techParts",
  "companyParts",
  "lmParts",
] as const;

/**
 * Fields a CRM writer could use for an edit time. The CRM's own job API
 * (PUT /api/jobs) sets none of them today; they are read when present so a
 * late change can carry its real edit time instead of only its detection time.
 */
export const UPDATE_TIMESTAMP_FIELDS = ["updatedAt", "updated_at", "lastModified", "modifiedAt", "lastUpdated"] as const;

const PROJECTION: Record<string, 1> = Object.fromEntries(
  ["_id", "tech", "date", "status", "location", "clientPhoneNumber", "address", "invoiceNumber", ...MONEY_FIELDS, ...UPDATE_TIMESTAMP_FIELDS].map((f) => [f, 1]),
);

function updateTimestamp(doc: Record<string, unknown>): { field: string; at: string } | null {
  for (const f of UPDATE_TIMESTAMP_FIELDS) {
    const v = doc[f];
    const d = v instanceof Date ? v : typeof v === "string" || typeof v === "number" ? new Date(v) : null;
    if (d && Number.isFinite(d.getTime())) return { field: f, at: d.toISOString() };
  }
  return null;
}

const h = (kind: string, v: string) => `${kind}:${createHash("sha256").update(v).digest("hex").slice(0, 16)}`;

function duplicateKeys(doc: Record<string, unknown>): string[] {
  const keys: string[] = [];
  const phone = String(doc.clientPhoneNumber ?? "").replace(/\D/g, "").slice(-10);
  if (phone.length >= 7) keys.push(h("phone", phone));
  const address = String(doc.address ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (address.length >= 8) keys.push(h("addr", address));
  const invoice = String(doc.invoiceNumber ?? "").trim().toLowerCase();
  if (invoice) keys.push(h("inv", invoice));
  return keys;
}

/** Map one raw production Job document to an ArenaJob (null = no valid date). */
export function toArenaJob(doc: Record<string, unknown>): ArenaJob | null {
  const date = serviceDate(doc.date);
  if (!date) return null;
  return {
    id: String(doc._id),
    tech: typeof doc.tech === "string" ? doc.tech : "",
    date,
    status: canonicalStatus(doc.status),
    location: typeof doc.location === "string" ? doc.location : "",
    profit: calcJobBalances(doc as never, 0, 0).totalProfit,
    dupKeys: duplicateKeys(doc),
  };
}

/**
 * Load production jobs with a service date in [fromDay, toDayExclusive) and a
 * non-blank tech — the same population the Home Leaderboard groups by tech.
 */
export async function loadJobs(db: Db, fromDay: string, toDayExclusive: string): Promise<ArenaJob[]> {
  return (await readJobSource(db, fromDay, toDayExclusive)).jobs;
}

/** loadJobs plus the CRM edit timestamps, when the documents carry one. */
export async function readJobSource(
  db: Db,
  fromDay: string,
  toDayExclusive: string,
): Promise<{ jobs: ArenaJob[]; updateTimestamps: { field: string | null; byJobId: Record<string, string> } }> {
  const docs = await db
    .collection(PRODUCTION_JOB_COLLECTION)
    .aggregate([
      { $match: { tech: { $nin: [null, ""] } } },
      SRC_FIELDS_STAGE,
      { $match: { _srcDate: { $gte: new Date(fromDay), $lt: new Date(toDayExclusive) } } },
      { $project: PROJECTION },
    ])
    .toArray();
  const jobs: ArenaJob[] = [];
  const byJobId: Record<string, string> = {};
  const fields = new Set<string>();
  for (const d of docs) {
    const j = toArenaJob(d);
    if (j && j.date >= fromDay && j.date < toDayExclusive) {
      jobs.push(j);
      const u = updateTimestamp(d);
      if (u) {
        byJobId[j.id] = u.at;
        fields.add(u.field);
      }
    }
  }
  return {
    jobs: jobs.sort((a, b) => (a.id < b.id ? -1 : 1)),
    updateTimestamps: { field: fields.size ? [...fields].sort().join(",") : null, byJobId },
  };
}

/**
 * Look jobs up by id (read-only), to say where a job that left a read went:
 * deleted, re-dated (no valid date / another date) or unassigned.
 */
export async function lookupJobs(db: Db, ids: string[]): Promise<Record<string, JobLookup>> {
  const out: Record<string, JobLookup> = {};
  if (!ids.length) return out;
  const keys = ids.map((id) => (/^[0-9a-f]{24}$/.test(id) ? new ObjectId(id) : id));
  const docs = await db
    .collection(PRODUCTION_JOB_COLLECTION)
    .find({ _id: { $in: [...keys, ...ids] as never[] } }, { projection: PROJECTION })
    .toArray();
  const found = new Map(docs.map((d) => [String(d._id), d as Record<string, unknown>]));
  for (const id of ids) {
    const d = found.get(id);
    out[id] = !d ? "deleted" : (toArenaJob(d) ?? "no_date");
  }
  return out;
}
