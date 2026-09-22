import type { JobRow } from "@/types/job";

// ─────────────────────────────────────────────────────────────────────────────
// Tables AI — types. An isolated, bot-owned MIRROR of the production Job.
// Nothing here reads or writes ag.Job except the read-only compare feature.
// ─────────────────────────────────────────────────────────────────────────────

export type AiEventType = "closing" | "estimate" | "update" | "other";

export interface AiValidationFlag {
  field: string;
  code: string;
  message: string;
}

/** Provenance envelope stamped by the ingest endpoint. Deliberately flexible:
 *  the real technician app / bot is NOT integrated yet, so identifiers land in
 *  `refs` verbatim and a stable idempotency key is finalized at integration. */
export interface AiJobMeta {
  source: string; // "bot" | "manual" | "test" | …
  eventType: AiEventType; // Phase 1: "closing"
  agentVersion?: string | null;
  ingestId: string; // idempotency key (client-supplied stable id, or generated)
  ingestIdKind: "client" | "generated"; // "generated" gives NO duplicate protection
  ingestedAt: string; // ISO
  refs?: Record<string, unknown>; // any identifiers the bot sent — future match keys
  validation?: AiValidationFlag[];
  /** SERVER-STAMPED by the LBS App outbox doors only (never from the body). */
  channel?: string;
  /** From an EXPLICIT payload flag only; sticky UNKNOWN once ambiguous. */
  environment?: IntegrationEnvironment;
}

export type IntegrationEnvironment = "TEST" | "PRODUCTION" | "UNKNOWN";

/** One received LBS App write (append-only history on the same logical job). */
export interface AiVersionEntry {
  version: number;
  operation: string;
  receivedAt: string;
  environment: IntegrationEnvironment;
  idempotencyKey: string | null;
  /** normalized job fields as sent in this version (null for a media-only write) */
  job: Record<string, unknown> | null;
  mediaIds: string[];
}

/** A media IDENTIFIER the LBS App reported — the bytes are never stored here. */
export interface AiMediaRef {
  media_id: string;
  kind: string | null;
  content_type: string | null;
  bytes: number | null;
  sha256: string | null;
  status: string;
  firstSeenVersion: number;
  receivedAt: string;
}

export interface AiEditEntry {
  at: string;
  by: string;
  changes: Record<string, { from: unknown; to: unknown }>;
}

/** A Tables AI job = full JobRow mirror + provenance + a FROZEN original. */
export type AiJobDoc = JobRow & {
  _id?: string;
  /** Reserved future shared key with production Job. Null in Phase 1 — enabled
   *  once the technician app provides a stable id present on both sides. */
  externalJobId?: string | null;
  /** FROZEN snapshot of what the bot first ingested (or what created the row).
   *  Human edits NEVER mutate this — it is the ground truth for accuracy. */
  aiOriginal?: Partial<JobRow>;
  aiMeta?: AiJobMeta;
  aiEditLog?: AiEditEntry[];
  aiLastEditedAt?: string | null;
  aiLastEditedBy?: string | null;
  _firstIngestAt?: string;
  /** LBS App rows only: append-only version history + media identifiers. */
  aiVersions?: AiVersionEntry[];
  aiMedia?: AiMediaRef[];
};

export interface AiJobLinkDoc {
  _id?: string;
  aiJobId: string;
  prodJobId: string;
  updatedAt: string;
  updatedBy: string;
}

// ── Ingest ──────────────────────────────────────────────────────────────────

export interface IngestEnvelope {
  job: Partial<JobRow> & Record<string, unknown>;
  meta?: {
    source?: string;
    eventType?: AiEventType;
    agentVersion?: string;
    /** Stable event/message id from the technician app, when available. When
     *  present it is the TRUE idempotency key; when absent, dedup is disabled. */
    ingestId?: string;
    refs?: Record<string, unknown>;
    externalJobId?: string;
  };
}

export interface IngestResult {
  ok: boolean;
  status: "created" | "updated";
  id: string;
  ingestId: string;
  ingestIdKind: "client" | "generated";
  validation: AiValidationFlag[];
  /** true ONLY when a client-supplied stable ingestId was used. A generated id
   *  cannot prevent the same event being ingested twice — see the ingest lib. */
  duplicateProtection: boolean;
  /** LBS App door: true when this exact version was already received (no-op). */
  duplicate?: boolean;
}

// ── Compare / QA ──────────────────────────────────────────────────────────────

export type CompareCategory =
  | "matched-clean"
  | "matched-mismatch"
  | "ai-only"
  | "production-only";

export interface FieldDiff {
  field: string;
  label: string;
  production: unknown;
  ai: unknown;
  match: boolean;
  kind: "money" | "text" | "date" | "other";
}

export interface ComparePair {
  aiJobId: string | null;
  prodJobId: string | null;
  confidence: number; // 0..1
  matchBy: string; // "link" | "externalJobId" | "date+address+tech" | …
  category: CompareCategory;
  diffs: FieldDiff[];
  mismatchCount: number;
  ai?: Partial<JobRow> & { _id?: string };
  production?: Partial<JobRow> & { _id?: string };
}

export interface CompareResult {
  counts: Record<CompareCategory, number> & { total: number };
  pairs: ComparePair[];
}
