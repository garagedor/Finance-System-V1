import type { JobRow } from "@/types/job";
import type { AiJobDoc, AiJobMeta, AiMediaRef, AiVersionEntry, IntegrationEnvironment } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// LBS App integration contract — the rules for rows written through the
// closing-dashboard SHADOW outbox doors (/api/ai-jobs/jobs*). Pure: no I/O, no
// path aliases at runtime, so `node --test` can exercise the real decisions.
//
// Provenance is SERVER-STAMPED: `aiMeta.channel` is set only by the dashboard
// doors (never from the request body), and `aiMeta.environment` only from an
// EXPLICIT payload flag (`is_test` boolean or `environment` "TEST"/"PRODUCTION").
// Nothing is ever inferred from customer / technician / invoice / address text.
// ─────────────────────────────────────────────────────────────────────────────

export const LBS_APP_CHANNEL = "lbs_app_outbox";

/** The explicit test/production marker on one payload. Absent, malformed or
 *  self-contradicting → UNKNOWN (which can never be cleaned up). */
export function readEnvironment(p: Record<string, unknown>): IntegrationEnvironment {
  const flag = p.is_test;
  const fromFlag = flag === true ? "TEST" : flag === false ? "PRODUCTION" : flag === undefined || flag === null ? undefined : "UNKNOWN";
  const envRaw = p.environment;
  let fromEnv: IntegrationEnvironment | undefined;
  if (envRaw === undefined || envRaw === null) fromEnv = undefined;
  else if (typeof envRaw === "string" && envRaw.trim().toUpperCase() === "TEST") fromEnv = "TEST";
  else if (typeof envRaw === "string" && envRaw.trim().toUpperCase() === "PRODUCTION") fromEnv = "PRODUCTION";
  else fromEnv = "UNKNOWN";
  if (fromFlag && fromEnv && fromFlag !== fromEnv) return "UNKNOWN";
  return fromFlag ?? fromEnv ?? "UNKNOWN";
}

/** Environment is sticky per logical job: once any version disagrees (or lacks
 *  the flag), the job is ambiguous for good. */
export function mergeEnvironment(prev: IntegrationEnvironment, next: IntegrationEnvironment): IntegrationEnvironment {
  return prev === next ? prev : "UNKNOWN";
}

/** Media identifiers from a payload (`evidence` from payload_for(), or a bare
 *  `media` list / array from the media door). Identifiers only — the bytes
 *  live in the LBS App and are never copied or deleted here. */
export function readMedia(p: unknown): Omit<AiMediaRef, "firstSeenVersion" | "receivedAt">[] {
  const list: unknown[] = Array.isArray(p)
    ? p
    : p && typeof p === "object"
      ? ((p as Record<string, unknown>).evidence ?? (p as Record<string, unknown>).media ?? []) as unknown[]
      : [];
  if (!Array.isArray(list)) return [];
  const out: Omit<AiMediaRef, "firstSeenVersion" | "receivedAt">[] = [];
  for (const m of list) {
    if (!m || typeof m !== "object") continue;
    const r = m as Record<string, unknown>;
    const id = r.media_id ?? r.id;
    if (id === undefined || id === null || id === "") continue;
    out.push({
      media_id: String(id),
      kind: r.kind != null ? String(r.kind) : null,
      content_type: r.content_type != null ? String(r.content_type) : null,
      bytes: typeof r.bytes === "number" ? r.bytes : typeof r.byte_size === "number" ? r.byte_size : null,
      sha256: r.sha256 != null ? String(r.sha256) : null,
      status: r.status != null ? String(r.status) : "referenced",
    });
  }
  return out;
}

/** Merge by media_id; first sighting wins (keeps firstSeenVersion stable). */
export function mergeMedia(existing: AiMediaRef[], incoming: ReturnType<typeof readMedia>, version: number, now: string): AiMediaRef[] {
  const out = existing.map((m) => ({ ...m }));
  const seen = new Set(out.map((m) => m.media_id));
  for (const m of incoming) {
    if (seen.has(m.media_id)) continue;
    seen.add(m.media_id);
    out.push({ ...m, firstSeenVersion: version, receivedAt: now });
  }
  return out;
}

export interface LbsAppExtras {
  environment: IntegrationEnvironment;
  version: number;
  operation: string;
  idempotencyKey: string | null;
  media: ReturnType<typeof readMedia>;
  /** true for the media door: attach identifiers, never touch job fields. */
  mediaOnly: boolean;
  /** media-only write that carried NO environment flag at all: it makes no
   *  claim about the job, so it inherits the job's stamped environment. */
  inheritEnvironment?: boolean;
}

export type IngestPlan =
  | { op: "insert"; doc: AiJobDoc }
  | { op: "update"; set: Record<string, unknown>; push: AiVersionEntry; liveUpdated: boolean }
  | { op: "noop"; reason: "duplicate_version" }
  | { op: "reject"; status: number; reason: string };

// Job writes dedup on version + operation; media writes also on WHICH media, so
// two different media batches for the same version both land.
const entryKey = (e: Pick<AiVersionEntry, "version" | "operation" | "job" | "mediaIds">) =>
  e.job === null ? `${e.version}:${e.operation}:media:${[...e.mediaIds].sort().join(",")}` : `${e.version}:${e.operation}`;
const storedVersion = (doc: AiJobDoc): number | null => {
  const v = (doc.aiMeta?.refs as Record<string, unknown> | undefined)?.version;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Decide what one LBS App write does to the mirror. Idempotency is on
 * logical job (lbs_job_id → one row) + version + operation: re-sending the same
 * version is a no-op (no new row, no new history entry, no duplicate media); a
 * correction (new version) appends to aiVersions on the SAME row. aiOriginal is
 * frozen at insert. Legacy rows with no stamped environment stay UNKNOWN.
 */
export function planLbsAppIngest(
  existing: AiJobDoc | null,
  input: { normalized: Partial<JobRow>; aiMeta: AiJobMeta; externalJobId: string | null; lbs: LbsAppExtras },
  now: string,
): IngestPlan {
  const { normalized, externalJobId, lbs } = input;
  // A row that predates stamping has no proven environment → UNKNOWN forever.
  const prevEnv: IntegrationEnvironment = existing?.aiMeta?.environment ?? "UNKNOWN";
  const incomingEnv: IntegrationEnvironment = lbs.mediaOnly && lbs.inheritEnvironment ? prevEnv : lbs.environment;
  const entry: AiVersionEntry = {
    version: lbs.version,
    operation: lbs.operation,
    receivedAt: now,
    environment: incomingEnv,
    idempotencyKey: lbs.idempotencyKey,
    job: lbs.mediaOnly ? null : { ...normalized },
    mediaIds: lbs.media.map((m) => m.media_id),
  };

  if (!existing) {
    if (lbs.mediaOnly) return { op: "reject", status: 404, reason: "media for an unknown job" };
    const aiMeta: AiJobMeta = { ...input.aiMeta, channel: LBS_APP_CHANNEL, environment: lbs.environment };
    return {
      op: "insert",
      doc: {
        ...(normalized as JobRow),
        externalJobId,
        aiOriginal: { ...normalized }, // FROZEN
        aiMeta,
        aiVersions: [entry],
        aiMedia: mergeMedia([], lbs.media, lbs.version, now),
        aiEditLog: [],
        aiLastEditedAt: null,
        aiLastEditedBy: null,
        _firstIngestAt: now,
      } as AiJobDoc,
    };
  }

  const history = existing.aiVersions ?? [];
  if (history.some((v) => entryKey(v) === entryKey(entry))) {
    return { op: "noop", reason: "duplicate_version" };
  }

  const environment = mergeEnvironment(prevEnv, incomingEnv);
  const sv = storedVersion(existing);
  const stale = sv != null && lbs.version < sv;
  const liveUpdate = !lbs.mediaOnly && !stale && !existing.aiLastEditedAt;

  const aiMeta: AiJobMeta = liveUpdate
    ? { ...input.aiMeta, channel: LBS_APP_CHANNEL, environment }
    : { ...(existing.aiMeta as AiJobMeta), channel: LBS_APP_CHANNEL, environment };
  const set: Record<string, unknown> = {
    aiMeta,
    aiMedia: mergeMedia(existing.aiMedia ?? [], lbs.media, lbs.version, now),
  };
  if (liveUpdate) Object.assign(set, normalized, { externalJobId });
  return { op: "update", set, push: entry, liveUpdated: liveUpdate };
}

// ── Read-back scope ──────────────────────────────────────────────────────────

/** Was this row written by the LBS App outbox? Stamped rows: yes. Rows from the
 *  same door before stamping existed are recognised by their full door
 *  signature (bot source, client key == external id, payload_source LBS_APP). */
export function isLbsAppRecord(doc: AiJobDoc | null | undefined): boolean {
  const m = doc?.aiMeta;
  if (!doc || !m) return false;
  if (m.channel === LBS_APP_CHANNEL) return true;
  const refs = (m.refs ?? {}) as Record<string, unknown>;
  return (
    m.source === "bot" &&
    m.ingestIdKind === "client" &&
    refs.payload_source === "LBS_APP" &&
    !!doc.externalJobId &&
    doc.externalJobId === m.ingestId
  );
}

const n0 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The read-back view: the integration's own record, nothing else (no edit-log
 *  actors, no links to production jobs, no secrets). */
export function toReadback(doc: AiJobDoc) {
  const m = (doc.aiMeta ?? {}) as AiJobMeta;
  const refs = (m.refs ?? {}) as Record<string, unknown>;
  const environment: IntegrationEnvironment = m.environment ?? "UNKNOWN";
  const updatedCandidates = [m.ingestedAt, doc.aiLastEditedAt].filter(Boolean) as string[];
  return {
    logical_job_id: doc.externalJobId ?? null,
    current_version: storedVersion(doc),
    versions: (doc.aiVersions ?? []).map((v) => ({ ...v })),
    origin: {
      source: m.source ?? null,
      channel: m.channel ?? null,
      provenance: m.channel === LBS_APP_CHANNEL ? "lbs_app_outbox" : "lbs_app_outbox_legacy_unstamped",
      payload_source: refs.payload_source ?? null,
      event_type: m.eventType ?? null,
      verdict: refs.verdict ?? null,
    },
    is_test: environment === "TEST",
    environment,
    technician: doc.tech ?? null,
    market: doc.location ?? null,
    customer: { name: doc.clientName ?? null, phone: doc.clientPhoneNumber ?? null },
    invoice: doc.invoiceNumber ?? null,
    provider: doc.provider ?? null,
    address: doc.address ?? null,
    date: doc.date ?? null,
    status: doc.status ?? null,
    payments: {
      tech_paid_cash: n0(doc.techPaidCash),
      paid_card: n0(doc.totalPaidCard),
      paid_company_check: n0(doc.totalPaidCompanyCheck),
      paid_finance: n0(doc.totalPaidFinance),
      paid_company_cash: n0(doc.totalPaidCompanyCash),
      paid_lm_cash: n0(doc.lmCash),
      paid_lm_check: n0(doc.lmCheck),
    },
    tips: {
      tips_card: n0(doc.tipsCard),
      tips_finance: n0(doc.tipsFinance),
      tips_check: n0(doc.tipsCheck),
      tips_company_cash: n0(doc.tipsCompanyCash),
    },
    parts: { tech_parts: n0(doc.techParts), company_parts: n0(doc.companyParts), lm_parts: n0(doc.lmParts) },
    total: n0(doc.totalAmount),
    work_done: doc.notes ?? null,
    media: (doc.aiMedia ?? []).map((x) => ({ ...x })),
    validation: m.validation ?? [],
    human_edited: Boolean(doc.aiLastEditedAt),
    created_at: doc._firstIngestAt ?? null,
    updated_at: updatedCandidates.sort().at(-1) ?? null,
  };
}

// ── Test-only cleanup fence ──────────────────────────────────────────────────

export type CleanupDecision =
  | { allowed: true }
  | { allowed: false; code: string; reason: string };

/** The ONLY gate for deleting a mirror row through the integration. Every
 *  condition must be proven by server-stamped metadata; anything else refuses. */
export function cleanupDecision(doc: AiJobDoc): CleanupDecision {
  const m = doc.aiMeta;
  if (!m || m.source === "manual") {
    return { allowed: false, code: "human_created", reason: "Row was created by a person, not the LBS App" };
  }
  if (m.channel !== LBS_APP_CHANNEL) {
    return { allowed: false, code: "ambiguous_provenance", reason: "Row has no server-stamped LBS App channel (legacy or other writer)" };
  }
  if (m.environment === "PRODUCTION") {
    return { allowed: false, code: "production_record", reason: "Row is marked PRODUCTION" };
  }
  if (m.environment !== "TEST") {
    return { allowed: false, code: "ambiguous_environment", reason: "Row is not provably TEST (flag missing or contradictory)" };
  }
  const versions = doc.aiVersions ?? [];
  if (!versions.length || versions.some((v) => v.environment !== "TEST")) {
    return { allowed: false, code: "ambiguous_environment", reason: "Not every recorded version was sent as TEST" };
  }
  if (doc.aiLastEditedAt || (doc.aiEditLog ?? []).length) {
    return { allowed: false, code: "human_edited", reason: "A person has edited this row; preserving their work" };
  }
  return { allowed: true };
}

/** Which of this row's media references are also held by a preserved row.
 *  Physical media is never deleted here either way (it lives in the LBS App);
 *  this reports what the cleanup releases vs. what stays referenced. */
export function mediaReleasePlan(doc: AiJobDoc, others: AiJobDoc[]) {
  const held = new Set<string>();
  for (const o of others) {
    for (const m of o.aiMedia ?? []) {
      held.add(`id:${m.media_id}`);
      if (m.sha256) held.add(`sha:${m.sha256}`);
    }
  }
  const released: string[] = [];
  const retainedShared: string[] = [];
  for (const m of doc.aiMedia ?? []) {
    const shared = held.has(`id:${m.media_id}`) || (!!m.sha256 && held.has(`sha:${m.sha256}`));
    (shared ? retainedShared : released).push(m.media_id);
  }
  return { released, retainedShared, physicalMediaDeleted: false as const };
}
