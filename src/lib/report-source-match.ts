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

/**
 * Aggregation expr: Job.date → a Date at UTC midnight, or null (blank/garbage).
 *
 * Multi-format robust (do NOT narrow this back to a single format): the external
 * writer has historically drifted the `date` format (ISO ↔ M/D/YYYY — see the
 * 13,174-row date normalization). A single-format parse silently nulls anything
 * off-format, which drops those jobs from every date-range report/stat — the
 * recurring "missing jobs" bug. This tries, in order:
 *   1. ISO first-10 "%Y-%m-%d"  — "2026-09-07" and "2026-09-07T..Z"
 *   2. US "%m/%d/%Y"            — "9/8/2026" / "09/08/2026"
 * Verified against the whole collection: byte-identical to the old ISO-only expr
 * on all current data (no report/stat number moves), and it rescues any future
 * M/D/YYYY row instead of dropping it. Only truly blank/garbage → null.
 */
export const SRC_DATE_EXPR = {
  $let: {
    vars: { d: { $trim: { input: { $ifNull: ["$date", ""] } } } },
    in: {
      $ifNull: [
        { $dateFromString: { dateString: { $substrCP: ["$$d", 0, 10] }, format: "%Y-%m-%d", onError: null, onNull: null } },
        { $dateFromString: { dateString: "$$d", format: "%m/%d/%Y", onError: null, onNull: null } },
      ],
    },
  },
} as const;

/**
 * Aggregation expr: Job.status → canonical status. Reproduces canonicalStatus()
 * EXACTLY: trim, then case/spacing-tolerant folding of the CLOSED family
 * ("closed"/"X-Close"/"xclose"/… → "Closed"/"X close"), then the documented
 * "Customer Cenceled" alias. The closed-family fold means a future writer that
 * changes the spelling/casing of a closed status can't silently drop those jobs
 * off the report. No-op on current data; never merges any other status.
 */
export const SRC_STATUS_EXPR = {
  $let: {
    vars: {
      t: { $trim: { input: { $ifNull: ["$status", ""] } } },
    },
    in: {
      $let: {
        vars: {
          // lower(strip spaces/dashes/underscores) — the fold key
          key: {
            $toLower: {
              $replaceAll: {
                input: {
                  $replaceAll: {
                    input: { $replaceAll: { input: "$$t", find: " ", replacement: "" } },
                    find: "-",
                    replacement: "",
                  },
                },
                find: "_",
                replacement: "",
              },
            },
          },
        },
        in: {
          $switch: {
            branches: [
              { case: { $eq: ["$$key", "closed"] }, then: "Closed" },
              { case: { $eq: ["$$key", "xclose"] }, then: "X close" },
              { case: { $eq: ["$$t", "Customer Cenceled"] }, then: "Customer Canceled" },
            ],
            default: "$$t",
          },
        },
      },
    },
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
