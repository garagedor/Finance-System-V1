// Shared, isomorphic (client + server) helpers for building report download
// filenames from a user-editable pattern. The PATTERNS themselves are stored
// server-side (see report-filenames.ts); this file only knows how to turn a
// pattern + token values into a safe ".pdf" filename, and carries the token
// catalog the settings UI renders. No DB / server-only imports here so both the
// client report pages and the server PDF routes can use it.

export type ReportKind = "balance" | "stats" | "finance" | "custom";

export type ReportFilenamePatterns = {
  balance: string;
  stats: string;
  finance: string;
  custom: string;
};

// Defaults reproduce the previous hard-coded filenames exactly (empty tokens
// collapse away, so e.g. stats with no subject → "Statistics_Report_<start>_to_<end>").
export const REPORT_FILENAME_DEFAULTS: ReportFilenamePatterns = {
  balance: "{mode}_Report_{subject}_{start}_to_{end}",
  stats: "Statistics_Report_{subject}_{start}_to_{end}",
  finance: "Financial_Report_{subject}_{start}_to_{end}",
  custom: "Custom_Report_{subject}_{start}_to_{end}",
};

export const REPORT_LABELS: Record<ReportKind, string> = {
  balance: "Balance report (Tech / Location)",
  stats: "Statistics report",
  finance: "Financial report",
  custom: "Custom report",
};

// Token catalog per report — drives the settings UI (clickable chips + help)
// and documents exactly what each report can fill in.
export const REPORT_TOKENS: Record<ReportKind, { token: string; desc: string }[]> = {
  balance: [
    { token: "mode", desc: "Tech or Location" },
    { token: "subject", desc: "The tech or location the report is for" },
    { token: "tech", desc: "Technician name" },
    { token: "location", desc: "Location name" },
    { token: "start", desc: "Start date (YYYY-MM-DD)" },
    { token: "end", desc: "End date (YYYY-MM-DD)" },
    { token: "today", desc: "Today's date (YYYY-MM-DD)" },
  ],
  stats: [
    { token: "subject", desc: "Report title / scope" },
    { token: "start", desc: "Start date" },
    { token: "end", desc: "End date" },
    { token: "today", desc: "Today's date" },
  ],
  finance: [
    { token: "subject", desc: "Report title" },
    { token: "preparedFor", desc: "Prepared-for name" },
    { token: "start", desc: "Start date" },
    { token: "end", desc: "End date" },
    { token: "today", desc: "Today's date" },
  ],
  custom: [
    { token: "subject", desc: "Report title" },
    { token: "preparedFor", desc: "Prepared-for name" },
    { token: "start", desc: "Start date" },
    { token: "end", desc: "End date" },
    { token: "today", desc: "Today's date" },
  ],
};

// Keep spaces, letters, digits, _ and - (matches the old safeSubject rules);
// strip everything a filesystem would choke on.
function sanitizeValue(s: string): string {
  return String(s ?? "").replace(/[^A-Za-z0-9_\- ]/g, "").replace(/\s+/g, " ").trim();
}

// Build a ".pdf" filename from a pattern and token values.
//  - {token} (case-insensitive) → sanitized value; unknown or empty tokens
//    expand to "" and the separators they leave behind are collapsed.
//  - never returns an empty name (falls back), and always ends in one ".pdf".
export function buildReportFilename(
  pattern: string,
  tokens: Record<string, string | null | undefined>,
  fallback = "Report",
): string {
  const byName: Record<string, string> = {};
  for (const [k, v] of Object.entries(tokens)) byName[k.toLowerCase()] = sanitizeValue(v ?? "");

  let out = String(pattern || "").replace(/\{(\w+)\}/g, (_m, name: string) => byName[name.toLowerCase()] ?? "");
  // Collapse the gaps blank tokens leave: repeated separators, and stray
  // leading/trailing separators (incl. a dangling "_to_" with no end date).
  out = out
    .replace(/[ _]{2,}/g, "_")
    .replace(/[-_]*\bto\b[-_]*$/i, "")
    .replace(/^[\s_\-]+|[\s_\-]+$/g, "")
    .trim();
  if (!out) out = fallback;
  out = out.replace(/\.pdf$/i, "");
  return `${out}.pdf`;
}
