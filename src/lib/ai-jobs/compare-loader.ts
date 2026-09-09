import "server-only";
import type { JobRow } from "@/types/job";
import { aiJobsCollection, prodJobsReadonly } from "./collection";
import { getAllLinks } from "./links-store";
import { buildCompare } from "./compare";
import type { AiJobDoc, CompareResult } from "./types";

// Loads AI jobs (Job_ai) + production jobs (READ-ONLY Job) for a window and runs
// the pure comparator. Production is only ever read here.

interface CompareParams {
  startDate?: string | null;
  endDate?: string | null;
  prodCap?: number;
}

export async function runCompare(params: CompareParams = {}): Promise<CompareResult> {
  const aiColl = await aiJobsCollection();
  const prodColl = await prodJobsReadonly(); // read-only surface (no write methods)

  const dateRange: Record<string, string> = {};
  if (params.startDate) dateRange.$gte = params.startDate;
  if (params.endDate) dateRange.$lte = params.endDate;
  const hasWindow = Object.keys(dateRange).length > 0;
  const query = hasWindow ? { date: dateRange } : {};

  const [aiRaw, prodRaw, links] = await Promise.all([
    aiColl.find(query as any).limit(5000).toArray(),
    prodColl
      .find(query as any)
      .limit(params.prodCap ?? 20000)
      .toArray(),
    getAllLinks(),
  ]);

  const aiJobs = aiRaw.map((r: any) => ({ ...r, _id: r._id?.toString() })) as AiJobDoc[];
  const prodJobs = prodRaw.map((r: any) => ({ ...r, _id: r._id?.toString() })) as JobRow[];

  return buildCompare(aiJobs, prodJobs, links);
}
