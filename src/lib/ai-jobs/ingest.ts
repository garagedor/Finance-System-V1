import "server-only";
import { randomUUID } from "crypto";
import { toNumber } from "@/app/api/utils/calculations";
import { normalizeApprovals } from "@/app/utils/jobUtils";
import { canonicalStatus } from "@/lib/status-canonical";
import { normalizeJobDate } from "@/lib/job-mirror";
import type { JobRow } from "@/types/job";
import { aiJobsCollection, aiDb } from "./collection";
import type {
  AiJobDoc,
  AiJobMeta,
  AiValidationFlag,
  IngestEnvelope,
  IngestResult,
} from "./types";

// Money / number fields on a Job (mirror of the CRM's numeric columns).
const NUMBER_FIELDS = [
  "totalAmount", "techPaidCash", "totalPaidCard", "totalPaidCompanyCheck",
  "totalPaidFinance", "totalPaidCompanyCash", "techParts", "companyParts",
  "lmParts", "lmCash", "lmCheck", "tipsCard", "tipsFinance", "tipsCompanyCash",
  "tipsCheck",
] as const;
const STRING_FIELDS = [
  "tech", "status", "date", "address", "location", "provider", "clientName",
  "clientPhoneNumber", "invoiceNumber", "notes",
] as const;
const BOOLEAN_FIELDS = ["needTracking"] as const;

const str = (v: unknown): string | undefined =>
  v === undefined || v === null ? undefined : String(v).trim();

/** Parse the dashboard job `version` out of a meta.refs bag, if present.
 *  Used to reject a stale (out-of-order) correction — see ingestAiJob. */
const readVersion = (refs: unknown): number | null => {
  const v = refs && typeof refs === "object" ? (refs as Record<string, unknown>).version : undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Coerce an arbitrary incoming job payload into the canonical Job shape. Numbers
 * are made numeric, booleans boolean, strings trimmed, plus the report/stats
 * mirror fields (jobDateNormalized, statusCanonical) so the AI table behaves
 * exactly like production. Unknown extra keys are dropped (they live in
 * aiMeta.refs instead). Pure — no I/O.
 */
export function normalizeJobPayload(raw: Record<string, unknown>): Partial<JobRow> {
  const out: Record<string, unknown> = {};
  for (const f of STRING_FIELDS) {
    const v = str(raw[f]);
    if (v !== undefined) out[f] = v;
  }
  for (const f of NUMBER_FIELDS) {
    if (raw[f] !== undefined && raw[f] !== null && raw[f] !== "") out[f] = toNumber(raw[f]);
  }
  for (const f of BOOLEAN_FIELDS) {
    if (raw[f] !== undefined) out[f] = Boolean(raw[f]);
  }
  if (raw.approvals !== undefined) out.approvals = normalizeApprovals(raw.approvals);
  // Mirror fields (kept in sync, same semantics as /api/jobs).
  if (typeof out.date === "string") {
    const d = normalizeJobDate(out.date);
    if (d) out.jobDateNormalized = d;
  }
  if (typeof out.status === "string" && out.status.trim()) {
    out.statusCanonical = canonicalStatus(out.status);
  }
  return out as Partial<JobRow>;
}

interface RefSets {
  statuses: Set<string>;
  techs: Set<string>;
  locations: Set<string>;
  providers: Set<string>;
}

async function loadRefSets(): Promise<RefSets> {
  const db = await aiDb();
  const ids = async (name: string) =>
    new Set(
      (await db.collection(name).find({}, { projection: { _id: 1 } }).toArray()).map((d: any) =>
        String(d._id).trim(),
      ),
    );
  const [statuses, techs, locations, providers] = await Promise.all([
    ids("JobStatus"),
    ids("Technician"),
    ids("Location"),
    ids("Provider"),
  ]);
  return { statuses, techs, locations, providers };
}

/**
 * Flag — never reject — the classic AI/external-writer mistakes so a reviewer
 * can see exactly where the bot went wrong. Storing bad data is the whole point
 * of Tables AI, so validation is advisory.
 */
export function validateJob(
  raw: Record<string, unknown>,
  normalized: Partial<JobRow>,
  refs: RefSets,
): AiValidationFlag[] {
  const flags: AiValidationFlag[] = [];
  const status = str(normalized.status);
  if (status && !refs.statuses.has(canonicalStatus(status))) {
    flags.push({ field: "status", code: "unknown_status", message: `Unknown status "${status}"` });
  }
  const tech = str(normalized.tech);
  if (tech && !refs.techs.has(tech)) {
    flags.push({ field: "tech", code: "unknown_tech", message: `Unknown technician "${tech}"` });
  }
  const location = str(normalized.location);
  if (location && !refs.locations.has(location)) {
    flags.push({ field: "location", code: "unknown_location", message: `Unknown location "${location}"` });
  }
  const provider = str(normalized.provider);
  if (provider && !refs.providers.has(provider)) {
    flags.push({ field: "provider", code: "unknown_provider", message: `Unknown provider "${provider}"` });
  }
  const rawDate = str(raw.date);
  if (rawDate && !normalizeJobDate(rawDate)) {
    flags.push({ field: "date", code: "bad_date", message: `Unparseable date "${rawDate}"` });
  }
  for (const f of NUMBER_FIELDS) {
    const v = raw[f];
    if (v !== undefined && v !== null && v !== "" && typeof v !== "number" && Number.isNaN(Number(v))) {
      flags.push({ field: f, code: "non_numeric_money", message: `Non-numeric ${f}: "${String(v)}"` });
    }
  }
  return flags;
}

/**
 * Ingest one closing/estimate/update event into ag.Job_ai (the ONLY write path
 * for the bot). Freezes aiOriginal on first insert; live fields update on
 * re-ingest UNLESS a human has edited the row.
 *
 * Idempotency: only a CLIENT-SUPPLIED stable `meta.ingestId` provides real
 * duplicate protection (upsert on it). If none is supplied we generate an
 * internal id for traceability and ALWAYS INSERT a new row — a random id cannot
 * dedup. When the technician app is integrated, its stable event id becomes the
 * ingestId and dedup switches on with zero code change here.
 */
export async function ingestAiJob(envelope: IngestEnvelope): Promise<IngestResult> {
  const meta = envelope.meta ?? {};
  const normalized = normalizeJobPayload(envelope.job ?? {});
  const refs = await loadRefSets();
  const validation = validateJob(envelope.job ?? {}, normalized, refs);

  const clientKey = str(meta.ingestId);
  const ingestId = clientKey ?? randomUUID();
  const ingestIdKind: "client" | "generated" = clientKey ? "client" : "generated";
  const now = new Date().toISOString();

  const aiMeta: AiJobMeta = {
    source: str(meta.source) ?? "bot",
    eventType: meta.eventType ?? "closing",
    agentVersion: str(meta.agentVersion) ?? null,
    ingestId,
    ingestIdKind,
    ingestedAt: now,
    refs: meta.refs ?? {},
    validation,
  };
  const externalJobId = str(meta.externalJobId) ?? null;
  const coll = await aiJobsCollection();

  const buildInsert = (): AiJobDoc =>
    ({
      ...(normalized as JobRow),
      externalJobId,
      aiOriginal: { ...normalized }, // FROZEN
      aiMeta,
      aiEditLog: [],
      aiLastEditedAt: null,
      aiLastEditedBy: null,
      _firstIngestAt: now,
    }) as AiJobDoc;

  // No stable key → cannot dedup → always insert (per idempotency policy).
  if (ingestIdKind === "generated") {
    const res = await coll.insertOne(buildInsert() as any);
    return { ok: true, status: "created", id: String(res.insertedId), ingestId, ingestIdKind, validation, duplicateProtection: false };
  }

  // Stable key → idempotent upsert keyed on aiMeta.ingestId.
  const existing = await coll.findOne({ "aiMeta.ingestId": ingestId } as any);
  if (existing) {
    // Out-of-order guard: corrections arrive as separate sends and could retry
    // out of order. A write whose version is OLDER than what we already stored
    // must not clobber the newer live fields — treat it as an idempotent no-op.
    const storedVersion = readVersion(existing.aiMeta?.refs);
    const incomingVersion = readVersion(meta.refs);
    if (incomingVersion != null && storedVersion != null && incomingVersion < storedVersion) {
      return { ok: true, status: "updated", id: String(existing._id), ingestId, ingestIdKind, validation, duplicateProtection: true };
    }
    // Never overwrite a human-corrected row's live fields on re-ingest; always
    // refresh provenance. aiOriginal stays frozen either way.
    const setFields: Record<string, unknown> = existing.aiLastEditedAt
      ? { aiMeta, externalJobId }
      : { ...normalized, externalJobId, aiMeta };
    await coll.updateOne({ _id: existing._id } as any, { $set: setFields });
    return { ok: true, status: "updated", id: String(existing._id), ingestId, ingestIdKind, validation, duplicateProtection: true };
  }
  const res = await coll.insertOne(buildInsert() as any);
  return { ok: true, status: "created", id: String(res.insertedId), ingestId, ingestIdKind, validation, duplicateProtection: true };
}
