/**
 * Official competition week: Monday 00:00 → end of Sunday, in one configured
 * IANA timezone (DST-aware). Week membership of a job is decided by its service
 * date (`Job.date`, a calendar date with no time), so every location shares the
 * same boundaries and each job belongs to exactly one week. The timezone only
 * decides the real-world instants (freeze, countdown, approval window).
 */

const DAY_MS = 86_400_000;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDay(day: string): number {
  const m = ISO_DAY.exec(day);
  if (!m) throw new Error(`invalid day "${day}"`);
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if (new Date(t).toISOString().slice(0, 10) !== day) throw new Error(`invalid day "${day}"`);
  return t;
}

export function addDays(day: string, n: number): string {
  return new Date(parseDay(day) + n * DAY_MS).toISOString().slice(0, 10);
}

export function isMonday(day: string): boolean {
  return new Date(parseDay(day)).getUTCDay() === 1;
}

/** The Monday that starts the week containing `day`. */
export function weekStartOf(day: string): string {
  const dow = new Date(parseDay(day)).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

/** Half-open membership: weekStart <= day < next Monday. */
export function inWeek(day: string, weekStart: string): boolean {
  return day >= weekStart && day < addDays(weekStart, 7);
}

/** Previous `n` week starts, most recent first. */
export function previousWeekStarts(weekStart: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(weekStart, -7 * (i + 1)));
}

/** Offset (ms) of `zone` from UTC at the instant `utcMs`. */
function zoneOffsetMs(utcMs: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - utcMs;
}

/** The UTC instant of local wall time `day hh:mm` in `zone`. */
export function zonedInstant(day: string, time: string, zone: string): Date {
  const [h, m] = time.split(":").map(Number);
  const wall = parseDay(day) + (h * 60 + m) * 60_000;
  let utc = wall - zoneOffsetMs(wall, zone);
  utc = wall - zoneOffsetMs(utc, zone); // second pass settles DST edges
  return new Date(utc);
}

export function isValidTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export interface WeekWindow {
  weekStart: string;
  /** Next Monday (exclusive end, as a service date). */
  weekEndExclusive: string;
  /** Monday 00:00 local, as UTC. */
  startsAt: Date;
  /** Next Monday 00:00 local, as UTC — the period closes immediately before. */
  closesAt: Date;
  /** Earliest regular winner approval. */
  approvalOpensAt: Date;
}

export function weekWindow(
  weekStart: string,
  zone: string,
  review: { approvalOpensDaysAfterWeekEnd: number; approvalOpensLocalTime: string },
): WeekWindow {
  if (!isMonday(weekStart)) throw new Error(`week must start on a Monday: ${weekStart}`);
  const weekEndExclusive = addDays(weekStart, 7);
  return {
    weekStart,
    weekEndExclusive,
    startsAt: zonedInstant(weekStart, "00:00", zone),
    closesAt: zonedInstant(weekEndExclusive, "00:00", zone),
    approvalOpensAt: zonedInstant(
      addDays(weekEndExclusive, review.approvalOpensDaysAfterWeekEnd),
      review.approvalOpensLocalTime,
      zone,
    ),
  };
}

/**
 * Service date of a raw `Job.date`, parsed exactly like SRC_DATE_EXPR
 * (src/lib/report-source-match.ts): trim; first 10 chars as %Y-%m-%d; else the
 * whole string as %m/%d/%Y; else null.
 */
export function serviceDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const d = raw.trim();
  const iso = d.slice(0, 10);
  if (ISO_DAY.test(iso)) {
    try {
      parseDay(iso);
      return iso;
    } catch {
      /* fall through */
    }
  }
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(d);
  if (us) {
    const day = `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
    try {
      parseDay(day);
      return day;
    } catch {
      return null;
    }
  }
  return null;
}
