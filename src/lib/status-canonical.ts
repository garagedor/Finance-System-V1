// ─────────────────────────────────────────────────────────────────────────────
// Canonical Job.status mapping (NON-DESTRUCTIVE).
//
// The legacy `Job.status` strings contain whitespace and spelling variants of a
// few real statuses (e.g. "Client Fixed It " with a trailing space, " X close"
// with a leading space, "Customer Cenceled"). This module provides a canonical
// form WITHOUT mutating stored data: the original `status` is always preserved.
//
// IMPORTANT: only whitespace/typo variants that unambiguously mean the SAME
// thing are merged here. Statuses with genuinely different business meaning are
// never merged. Switching report queries to read the canonical form is a
// separate, owner-approved change (it would reclassify ~927 legacy jobs and
// therefore move dashboard numbers) — see perf-remediation/PHASE-LOG.md.
// ─────────────────────────────────────────────────────────────────────────────

/** Documented alias table: exact spelling/casing corrections (post-trim). */
export const STATUS_ALIASES: Record<string, string> = {
  "Customer Cenceled": "Customer Canceled",
};

/** The canonical status vocabulary (the real, intended statuses). */
export const KNOWN_STATUSES: readonly string[] = [
  "Closed",
  "Estimate",
  "X close",
  "Customer Canceled",
  "Cancel by Office",
  "OOA",
  "No answer",
  "Client Fixed It",
  "Pending",
  "Cancel Estimate",
  "Reschedule",
  "Cancel (Time Issue)",
  "Deposit",
  "Price Issue",
  "Refund",
  "Live",
];

const KNOWN_SET = new Set<string>(KNOWN_STATUSES);

/**
 * Canonicalize a raw status: trim surrounding whitespace, then apply the
 * documented alias table. Returns "" for null/blank. Never throws.
 * Deliberately does NOT invent a status for unknown values — it returns the
 * trimmed string so unknowns remain visible (see `isKnownStatus`).
 */
export function canonicalStatus(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return STATUS_ALIASES[trimmed] ?? trimmed;
}

/** True if the canonical form is a recognized status (blank counts as known/empty). */
export function isKnownStatus(raw: unknown): boolean {
  const c = canonicalStatus(raw);
  return c === "" || KNOWN_SET.has(c);
}
