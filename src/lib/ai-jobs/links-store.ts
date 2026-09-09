import "server-only";
import { aiJobLinksCollection } from "./collection";

// Manual AI↔production pairing overrides, mirroring the verify module's
// WeeklyReportJobLink pattern. Authoritative over fuzzy matching.

export async function getAllLinks(): Promise<Record<string, string>> {
  const coll = await aiJobLinksCollection();
  const rows = await coll.find({}).toArray();
  const map: Record<string, string> = {};
  for (const r of rows) map[String(r.aiJobId)] = String(r.prodJobId);
  return map;
}

export async function upsertLink(aiJobId: string, prodJobId: string, by: string) {
  const coll = await aiJobLinksCollection();
  const now = new Date().toISOString();
  await coll.updateOne(
    { aiJobId },
    { $set: { aiJobId, prodJobId, updatedAt: now, updatedBy: by || "unknown" } },
    { upsert: true },
  );
  return { ok: true, aiJobId, prodJobId };
}

export async function removeLink(aiJobId: string) {
  const coll = await aiJobLinksCollection();
  const res = await coll.deleteOne({ aiJobId });
  return { ok: true, removed: res.deletedCount ?? 0 };
}
