/**
 * Mongo-backed Arena store. Arena collections live in their own database
 * (ARENA_MONGODB_DB, see env.ts), never in the CRM database. The CRM database
 * is only ever handed to the read-only job source and the read-only identity
 * loaders below.
 */
import type { Db } from "mongodb";
import type { ArenaStore } from "./config-store";
import type { ReviewStore } from "./review";
import type { MappingRecord, TechnicianRecord } from "./identity";
import type { LifecycleCollections } from "./lifecycle";
import { RATE_LIMIT_TTL_INDEX } from "./tech/rate-limit";

export const ARENA_COLLECTIONS = {
  settings: "arena_settings",
  templates: "arena_config_template",
  ruleVersions: "arena_rule_version",
  competitions: "arena_competition",
  notices: "arena_notice",
  audit: "arena_audit",
  reviewCases: "arena_review_case",
  reviewEvents: "arena_review_event",
  snapshots: "arena_snapshot",
  results: "arena_result",
  approvals: "arena_approval",
  techEvents: "arena_tech_event",
  claims: "arena_claim",
  /** Last known Weekly Balance account state per competitor (live fallback only). */
  accountStatus: "arena_account_status",
  /** Shared exchange rate-limit windows (TTL-indexed). */
  rateLimit: "arena_rate_limit",
} as const;

/** Lifecycle collections (lifecycle.ts). Results, approvals and non-live snapshots are insert-only. */
export function lifecycleCollections(db: Db): LifecycleCollections {
  const c = <T>(name: string) => db.collection(name) as never as T;
  return {
    snapshots: c(ARENA_COLLECTIONS.snapshots),
    results: c(ARENA_COLLECTIONS.results),
    approvals: c(ARENA_COLLECTIONS.approvals),
    events: c(ARENA_COLLECTIONS.techEvents),
    claims: c(ARENA_COLLECTIONS.claims),
  };
}

export function arenaStores(db: Db): { config: ArenaStore; review: ReviewStore } {
  const c = <T>(name: string) => db.collection(name) as never as T;
  const audit = c<ArenaStore["audit"]>(ARENA_COLLECTIONS.audit);
  return {
    config: {
      settings: c(ARENA_COLLECTIONS.settings),
      templates: c(ARENA_COLLECTIONS.templates),
      ruleVersions: c(ARENA_COLLECTIONS.ruleVersions),
      competitions: c(ARENA_COLLECTIONS.competitions),
      notices: c(ARENA_COLLECTIONS.notices),
      audit,
    },
    review: {
      cases: c(ARENA_COLLECTIONS.reviewCases),
      events: c(ARENA_COLLECTIONS.reviewEvents),
      audit,
    },
  };
}

let indexed: Promise<void> | null = null;
export function ensureArenaIndexes(db: Db): Promise<void> {
  indexed ??= (async () => {
    await Promise.all([
      db.collection(ARENA_COLLECTIONS.settings).createIndex({ current: 1 }),
      db.collection(ARENA_COLLECTIONS.templates).createIndex({ templateId: 1, current: 1 }),
      db.collection(ARENA_COLLECTIONS.ruleVersions).createIndex({ competitionId: 1, n: -1 }),
      db.collection(ARENA_COLLECTIONS.competitions).createIndex({ weekStart: -1 }),
      db.collection(ARENA_COLLECTIONS.notices).createIndex({ competitionId: 1, at: 1 }),
      db.collection(ARENA_COLLECTIONS.audit).createIndex({ at: -1 }),
      db.collection(ARENA_COLLECTIONS.audit).createIndex({ target: 1, at: -1 }),
      db.collection(ARENA_COLLECTIONS.reviewCases).createIndex({ kind: 1, status: 1 }),
      db.collection(ARENA_COLLECTIONS.reviewEvents).createIndex({ caseId: 1, at: 1 }),
      db.collection(ARENA_COLLECTIONS.snapshots).createIndex({ competitionId: 1, kind: 1, n: -1 }),
      db.collection(ARENA_COLLECTIONS.results).createIndex({ weekStart: -1 }),
      db.collection(ARENA_COLLECTIONS.approvals).createIndex({ competitionId: 1, at: 1 }),
      db.collection(ARENA_COLLECTIONS.techEvents).createIndex({ competitorId: 1, key: 1 }),
      db.collection(ARENA_COLLECTIONS.rateLimit).createIndex(RATE_LIMIT_TTL_INDEX.key, RATE_LIMIT_TTL_INDEX.options),
    ]);
  })().catch((e) => {
    indexed = null;
    throw e;
  });
  return indexed;
}

/** Read-only: verified people (one TechNameMapping record each). */
export async function loadMappings(crm: Db): Promise<MappingRecord[]> {
  const rows = await crm
    .collection("TechNameMapping")
    .find({}, { projection: { supabaseUserId: 1, supabaseFullName: 1, crmTechNames: 1 } })
    .toArray();
  return rows as unknown as MappingRecord[];
}

/** Read-only: CRM technicians (name and location only). */
export async function loadTechnicians(crm: Db): Promise<TechnicianRecord[]> {
  const rows = await crm.collection("Technician").find({}, { projection: { _id: 1, location: 1 } }).toArray();
  return rows as unknown as TechnicianRecord[];
}

/** Read-only: the one verified-person record for a balance-app account, if any. */
export async function loadMappingFor(crm: Db, supabaseUserId: string): Promise<MappingRecord | null> {
  const row = await crm
    .collection("TechNameMapping")
    .findOne({ supabaseUserId }, { projection: { supabaseUserId: 1, supabaseFullName: 1, crmTechNames: 1 } });
  return (row as unknown as MappingRecord | null) ?? null;
}
