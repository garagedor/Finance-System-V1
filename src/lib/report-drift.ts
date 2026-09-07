import "server-only";
import { getDb } from "@/lib/finance-db";
import { SRC_STATUS_EXPR, SRC_DATE_EXPR } from "@/lib/report-source-match";
import { sendTelegram, telegramConfigured } from "@/lib/telegram";
import { sendEmail, isEmailConfigured } from "@/lib/email";

// Report-drift monitor. The provider report / stats read jobs by SOURCE date +
// status (SRC_DATE_EXPR / SRC_STATUS_EXPR), which is immune to the mirror-field
// drift that used to drop jobs. The ONLY remaining way a job could silently fall
// out is if the external writer emits something we've never seen:
//   1. a NEW "closed" status spelling that doesn't fold to Closed / X close, or
//   2. a NEW date format that SRC_DATE_EXPR can't parse (→ null → unrangeable).
// This monitor finds those cases so they surface as an alert instead of vanishing.

const CLOSED = ["Closed", "X close"];

export interface DriftJob {
  id: string;
  status: string;
  date: string;
}
export interface ReportDriftResult {
  unrecognizedClosedish: DriftJob[]; // status LOOKS closed but doesn't fold to a bucket
  unparseableDate: DriftJob[]; // closed/x-close job whose non-blank date won't parse
  total: number;
}

const mapJobs = (rows: any[]): DriftJob[] =>
  rows.map((j) => ({ id: String(j._id), status: String(j.status ?? ""), date: String(j.date ?? "") }));

export async function detectReportDrift(): Promise<ReportDriftResult> {
  const db = await getDb();
  const Job = db.collection("Job");

  // 1) Collapsed status key contains "clos" (looks closed-ish) but the canonical
  //    value is NOT an exact report bucket → an unmapped new spelling.
  const unrecognized = await Job.aggregate([
    {
      $addFields: {
        _c: SRC_STATUS_EXPR,
        _k: {
          $toLower: {
            $replaceAll: {
              input: { $replaceAll: { input: { $trim: { input: { $ifNull: ["$status", ""] } } }, find: " ", replacement: "" } },
              find: "-",
              replacement: "",
            },
          },
        },
      },
    },
    { $match: { _k: { $regex: "clos" }, _c: { $nin: CLOSED } } },
    { $project: { _id: 1, status: 1, date: 1 } },
    { $limit: 50 },
  ]).toArray();

  // 2) Closed / X-close job with a NON-blank date that SRC_DATE_EXPR can't parse
  //    → an unrecognized date format that drops it from every date-range query.
  const unparseable = await Job.aggregate([
    {
      $addFields: {
        _c: SRC_STATUS_EXPR,
        _d: SRC_DATE_EXPR,
        _raw: { $trim: { input: { $ifNull: ["$date", ""] } } },
      },
    },
    { $match: { _c: { $in: CLOSED }, _d: null, _raw: { $ne: "" } } },
    { $project: { _id: 1, status: 1, date: 1 } },
    { $limit: 50 },
  ]).toArray();

  const unrecognizedClosedish = mapJobs(unrecognized);
  const unparseableDate = mapJobs(unparseable);
  return { unrecognizedClosedish, unparseableDate, total: unrecognizedClosedish.length + unparseableDate.length };
}

function buildMessage(res: ReportDriftResult): string {
  const lines: string[] = [];
  lines.push(`⚠️ LBS report drift: ${res.total} job(s) may be missing from the provider report / stats.`);
  if (res.unrecognizedClosedish.length) {
    lines.push("", `Unrecognized "closed" status spelling (${res.unrecognizedClosedish.length}):`);
    for (const j of res.unrecognizedClosedish.slice(0, 10)) {
      lines.push(`  • ${j.date || "(no date)"} — status "${j.status}" — id ${j.id}`);
    }
  }
  if (res.unparseableDate.length) {
    lines.push("", `Closed job with an unrecognized date format (${res.unparseableDate.length}):`);
    for (const j of res.unparseableDate.slice(0, 10)) {
      lines.push(`  • status "${j.status}" — date "${j.date}" — id ${j.id}`);
    }
  }
  lines.push("", "Send the status / date format above to Claude and it will add support in minutes.");
  return lines.join("\n");
}

export interface DriftAlertResult {
  checked: true;
  drift: number;
  alerted: boolean;
  channel?: "telegram" | "email";
  reason?: string;
}

/**
 * Detect drift and, if any, alert the owner (Telegram preferred, email fallback).
 * Debounced to at most one alert per ~20h via a finance_meta marker unless
 * `force` is set (manual "check now"). Best-effort — never throws.
 */
export async function alertReportDrift(opts?: { force?: boolean }): Promise<DriftAlertResult> {
  let res: ReportDriftResult;
  try {
    res = await detectReportDrift();
  } catch (e) {
    return { checked: true, drift: -1, alerted: false, reason: e instanceof Error ? e.message : "detect failed" };
  }
  if (res.total === 0) return { checked: true, drift: 0, alerted: false };

  if (!opts?.force) {
    try {
      const db = await getDb();
      const meta = db.collection<{ _id: string; last_alert?: string; last_total?: number }>("finance_meta");
      const nowIso = new Date().toISOString();
      const cutoff = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
      const claim = await meta.updateOne(
        { _id: "report_drift_alert", $or: [{ last_alert: { $exists: false } }, { last_alert: { $lt: cutoff } }] },
        { $set: { last_alert: nowIso, last_total: res.total } },
        { upsert: true },
      );
      if (!claim.upsertedCount && !claim.modifiedCount) {
        return { checked: true, drift: res.total, alerted: false, reason: "debounced (alerted within 20h)" };
      }
    } catch {
      // If the debounce marker fails, fall through and still try to alert.
    }
  }

  const text = buildMessage(res);

  if (telegramConfigured()) {
    const r = await sendTelegram(text);
    if (r.ok) return { checked: true, drift: res.total, alerted: true, channel: "telegram" };
  }
  const to = process.env.DRIFT_ALERT_EMAIL;
  if (to && isEmailConfigured()) {
    const r = await sendEmail({ to, subject: `⚠️ LBS report drift: ${res.total} job(s) may be missing`, text });
    if (r.ok) return { checked: true, drift: res.total, alerted: true, channel: "email" };
    return { checked: true, drift: res.total, alerted: false, reason: r.reason };
  }
  return { checked: true, drift: res.total, alerted: false, reason: "no alert channel configured (set TELEGRAM_* or DRIFT_ALERT_EMAIL)" };
}
