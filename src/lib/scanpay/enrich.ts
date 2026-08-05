import "server-only";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/finance-db";

// Enrich matched CRM jobs with the context the inbox wants to show: provider,
// technician, location + assigned Area Manager, and total collected. Batched:
// one Job query + one Location query for the whole page.

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export interface JobEnrichment {
  provider: string | null;
  tech: string | null;
  location: string | null;
  areaManager: string | null;      // null when the location has no AM assigned
  areaManagerMissing: boolean;      // true when matched but location has no AM
  collected: number;                // totalAmount + all tips
}

export async function enrichJobs(jobIds: (string | null | undefined)[]): Promise<Map<string, JobEnrichment>> {
  const ids = [...new Set(jobIds.filter((x): x is string => !!x))];
  const map = new Map<string, JobEnrichment>();
  if (!ids.length) return map;

  const db = await getDb();
  const objIds = ids.filter((id) => /^[0-9a-fA-F]{24}$/.test(id)).map((id) => new ObjectId(id));
  const or: Record<string, unknown>[] = [];
  if (objIds.length) or.push({ _id: { $in: objIds } });
  or.push({ _id: { $in: ids } });

  const jobs = await db.collection("Job")
    .find({ $or: or })
    .project({ provider: 1, tech: 1, location: 1, totalAmount: 1, tipsCard: 1, tipsFinance: 1, tipsCompanyCash: 1, tipsCheck: 1 })
    .toArray();

  const locNames = [...new Set(jobs.map((j) => j.location).filter(Boolean))] as string[];
  const locs = locNames.length
    ? await db.collection<{ _id: string; areaManagerName?: string }>("Location")
        .find({ _id: { $in: locNames } })
        .project({ areaManagerName: 1 })
        .toArray()
    : [];
  const amMap = new Map<string, string | null>(
    locs.map((l): [string, string | null] => [String(l._id), (l as { areaManagerName?: string }).areaManagerName || null]),
  );

  for (const j of jobs) {
    const tips = num(j.tipsCard) + num(j.tipsFinance) + num(j.tipsCompanyCash) + num(j.tipsCheck);
    const areaManager = j.location ? (amMap.get(j.location) ?? null) : null;
    map.set(String(j._id), {
      provider: j.provider ?? null,
      tech: j.tech ?? null,
      location: j.location ?? null,
      areaManager,
      areaManagerMissing: !!j.location && !areaManager,
      collected: num(j.totalAmount) + tips,
    });
  }
  return map;
}
