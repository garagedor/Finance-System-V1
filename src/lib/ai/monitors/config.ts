import "server-only";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";

// Per-detector overrides: independently enable/disable and tune thresholds
// without code changes. Absent = use the definition's defaults.

type CfgDoc = { _id: string; enabled?: boolean; config?: Record<string, number | boolean> };
export type DetectorConfigMap = Record<string, { enabled?: boolean; config?: Record<string, number | boolean> }>;

export async function getAllDetectorConfig(): Promise<DetectorConfigMap> {
  await ensureFinanceIndexes();
  const rows = await coll<CfgDoc>(FINANCE_COLLECTIONS.aiDetectorConfig).find({}).toArray();
  const out: DetectorConfigMap = {};
  for (const r of rows) out[r._id] = { enabled: r.enabled, config: r.config };
  return out;
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
}
