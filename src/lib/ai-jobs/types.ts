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
