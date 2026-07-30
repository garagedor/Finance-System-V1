import "server-only";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { createTtlCache } from "@/lib/ttl-cache";

// Per-detector overrides: independently enable/disable and tune thresholds
// without code changes. Absent = use the definition's defaults.

type CfgDoc = { _id: string; enabled?: boolean; config?: Record<string, number | boolean> };
export type DetectorConfigMap = Record<string, { enabled?: boolean; config?: Record<string, number | boolean> }>;

// Global (not per-user) detector config that changes rarely — cache 60s, clear on write.
const _cfgCache = createTtlCache<DetectorConfigMap>(60_000);

export async function getAllDetectorConfig(): Promise<DetectorConfigMap> {
  return _cfgCache.get(async () => {
    await ensureFinanceIndexes();
    const rows = await coll<CfgDoc>(FINANCE_COLLECTIONS.aiDetectorConfig).find({}).toArray();
    const out: DetectorConfigMap = {};
    for (const r of rows) out[r._id] = { enabled: r.enabled, config: r.config };
    return out;
  });
}

export async function setDetectorConfig(
  id: string,
  patch: { enabled?: boolean; config?: Record<string, number | boolean> },
): Promise<void> {
  await ensureFinanceIndexes();
  const set: Record<string, unknown> = {};
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.config !== undefined) set.config = patch.config;
  if (Object.keys(set).length === 0) return;
  await coll<CfgDoc>(FINANCE_COLLECTIONS.aiDetectorConfig).updateOne({ _id: id }, { $set: set }, { upsert: true });
  _cfgCache.clear(); // reflect the write immediately
}
