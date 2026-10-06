import "server-only";
import { coll, ensureFinanceIndexes, FINANCE_COLLECTIONS } from "@/lib/finance-db";
import { createTtlCache } from "@/lib/ttl-cache";
import { REPORT_FILENAME_DEFAULTS, type ReportFilenamePatterns } from "@/lib/report-filename-format";

// Global (not per-user) config for how downloaded report PDFs are named.
// Stored as a single singleton doc, mirroring the voice-settings pattern.

type ReportFilenameDoc = { _id: "report-filenames" } & Partial<ReportFilenamePatterns>;

// Same transient-TLS retry the voice settings use (Atlas/Node 24 flake).
async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (!/SSL|TLS|ENOTFOUND|querySrv|EAI_AGAIN|ECONNRESET|ETIMEDOUT|topology|pool|socket/i.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, 120 * (i + 1)));
    }
  }
  throw lastErr;
}

const _cache = createTtlCache<ReportFilenamePatterns>(60_000);

export async function getReportFilenames(): Promise<ReportFilenamePatterns> {
  return _cache.get(() =>
    withRetry(async () => {
      await ensureFinanceIndexes();
      const d = await coll<ReportFilenameDoc>(FINANCE_COLLECTIONS.reportFilenameSettings).findOne({ _id: "report-filenames" });
      return {
        balance: d?.balance?.trim() || REPORT_FILENAME_DEFAULTS.balance,
        stats: d?.stats?.trim() || REPORT_FILENAME_DEFAULTS.stats,
        finance: d?.finance?.trim() || REPORT_FILENAME_DEFAULTS.finance,
        custom: d?.custom?.trim() || REPORT_FILENAME_DEFAULTS.custom,
      };
    }),
  );
}

export async function setReportFilenames(patch: Partial<ReportFilenamePatterns>): Promise<void> {
  const set: Record<string, unknown> = {};
  for (const k of ["balance", "stats", "finance", "custom"] as const) {
    const v = patch[k];
    if (typeof v === "string") set[k] = v.trim().slice(0, 200);
  }
  if (Object.keys(set).length === 0) return;
  await withRetry(async () => {
    await ensureFinanceIndexes();
    await coll<ReportFilenameDoc>(FINANCE_COLLECTIONS.reportFilenameSettings).updateOne(
      { _id: "report-filenames" },
      { $set: set },
      { upsert: true },
    );
  });
  _cache.clear();
}
