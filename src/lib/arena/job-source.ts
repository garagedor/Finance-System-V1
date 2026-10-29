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
import type { Db } from "mongodb";
import { calcJobBalances } from "@/app/api/utils/calculations";
import { canonicalStatus } from "@/lib/status-canonical";
import { SRC_FIELDS_STAGE } from "@/lib/report-source-match";
import type { ArenaJob } from "./types";
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

const PROJECTION: Record<string, 1> = Object.fromEntries(
  ["_id", "tech", "date", "status", "location", "clientPhoneNumber", "address", "invoiceNumber", ...MONEY_FIELDS].map((f) => [f, 1]),
);

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
  for (const d of docs) {
    const j = toArenaJob(d);
    if (j && j.date >= fromDay && j.date < toDayExclusive) jobs.push(j);
  }
  return jobs.sort((a, b) => (a.id < b.id ? -1 : 1));
}
