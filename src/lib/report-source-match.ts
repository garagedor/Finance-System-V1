import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// Query-time derivation of the report's DATE and STATUS straight from the SOURCE
// fields (Job.date, Job.status).
//
// Why: the stored mirror fields `jobDateNormalized` / `statusCanonical` are
// written by /api/jobs, but the EXTERNAL writer (mobile/Lovable → ag.Job) edits
// jobs directly and never sets them. Any report that `$match`-es on the mirror
// therefore silently drops externally-written jobs until a heal happens to run —
// the recurring "missing jobs on the provider report" bug. Matching on these
// expressions instead recomputes the truth on every read, so the reports are
// structurally immune to mirror drift (no cron/heal timing dependence at all).
//
// These reproduce the JS helpers EXACTLY, so on fresh data the derived value is
// identical to the mirror and no report number moves — jobs only stop vanishing:
//   _srcDate   === normalizeJobDate(date)   (trim, first 10 chars, %Y-%m-%d → UTC midnight)
//   _srcStatus === canonicalStatus(status)  (trim + the one documented alias)
// ─────────────────────────────────────────────────────────────────────────────

/** Aggregation expr: Job.date → a Date at UTC midnight, or null (blank/unparseable). */
export const SRC_DATE_EXPR = {
  $dateFromString: {
    dateString: { $substrCP: [{ $trim: { input: { $ifNull: ["$date", ""] } } }, 0, 10] },
    format: "%Y-%m-%d",
    onError: null,
    onNull: null,
  },
} as const;

/** Aggregation expr: Job.status → canonical status (trim + the documented alias). */
export const SRC_STATUS_EXPR = {
  $let: {
    vars: { t: { $trim: { input: { $ifNull: ["$status", ""] } } } },
    in: { $cond: [{ $eq: ["$$t", "Customer Cenceled"] }, "Customer Canceled", "$$t"] },
  },
} as const;

/**
 * $addFields stage that materializes both derived fields. Insert it BEFORE any
 * `$match` that filters on date/status; downstream stages then match on the
 * ordinary fields `_srcDate` (Date) and `_srcStatus` (string).
 */
export const SRC_FIELDS_STAGE = {
  $addFields: { _srcDate: SRC_DATE_EXPR, _srcStatus: SRC_STATUS_EXPR },
} as const;
