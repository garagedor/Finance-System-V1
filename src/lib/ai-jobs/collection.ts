import "server-only";
import type { Collection, Db } from "mongodb";
import { MongoClient } from "mongodb";
import { getMongoClient } from "@/lib/mongo";
import type { JobRow } from "@/types/job";
import type { AiJobDoc, AiJobLinkDoc } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Tables AI data access — HARD ISOLATION.
//
// The bot / Tables AI write path touches ONLY `Job_ai` (and `AiJobLink`). The
// production `Job` collection is reachable here through exactly ONE accessor
// (`prodJobsReadonly`) that is used solely by the compare feature and must only
// ever be read from — never `.insertOne` / `.updateOne` / `.deleteOne` /
// `.findOneAndUpdate` / bulk writes. That invariant is asserted by the
// isolation test.
// ─────────────────────────────────────────────────────────────────────────────

export const DB_NAME = "ag";
export const AI_JOB_COLLECTION = "Job_ai";
export const AI_JOB_LINK_COLLECTION = "AiJobLink";
export const PROD_JOB_COLLECTION = "Job"; // READ-ONLY from anywhere in ai-jobs/*

let cached: MongoClient | null = null;
async function client(): Promise<MongoClient> {
  if (cached) return cached;
  const c = await getMongoClient();
  await c.connect();
  cached = c;
  return c;
}

export async function aiDb(): Promise<Db> {
  return (await client()).db(DB_NAME);
}

export async function aiJobsCollection(): Promise<Collection<AiJobDoc>> {
  return (await aiDb()).collection<AiJobDoc>(AI_JOB_COLLECTION);
}

export async function aiJobLinksCollection(): Promise<Collection<AiJobLinkDoc>> {
  return (await aiDb()).collection<AiJobLinkDoc>(AI_JOB_LINK_COLLECTION);
}

/**
 * READ-ONLY accessor for the production Job collection — used ONLY by the
 * compare/QA feature to grade the bot against employee entries. NEVER call a
 * write method on the returned collection. Typed as a read-only surface to make
 * accidental writes a compile error.
 */
export type ReadonlyJobCollection = Pick<
  Collection<JobRow>,
  "find" | "findOne" | "countDocuments" | "aggregate" | "distinct"
>;
export async function prodJobsReadonly(): Promise<ReadonlyJobCollection> {
  return (await aiDb()).collection<JobRow>(PROD_JOB_COLLECTION);
}
