// Schedule math for recurring expenses.
//
// All dates are ISO `YYYY-MM-DD` strings interpreted in UTC.
// `currentDue` is the date that's about to be generated. Returns the date
// AFTER it, given the template's frequency.

import type { RecurringExpenseRecord, RecurringFrequency } from "@/types/finance";

const DAY_MS = 86_400_000;

function parse(d: string): Date {
  // Use UTC midnight to avoid timezone drift across DST etc.
  return new Date(`${d}T00:00:00Z`);
}
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function lastDayOfMonth(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}
/** Advance by N months, preserving the day-of-month rule (or last-day if specified). */
function addMonthsPreservingDay(d: Date, months: number, dayOfMonth?: number): Date {
  const y = d.getUTCFullYear();
  const m0 = d.getUTCMonth();
  const newY = y + Math.floor((m0 + months) / 12);
  const newM0 = ((m0 + months) % 12 + 12) % 12;
  const lastDay = lastDayOfMonth(newY, newM0);
  let day: number;
  if (dayOfMonth === -1) day = lastDay;
  else if (dayOfMonth !== undefined && dayOfMonth >= 1 && dayOfMonth <= 31) {
    day = Math.min(dayOfMonth, lastDay);
  } else {
    day = Math.min(d.getUTCDate(), lastDay);
  }
  return new Date(Date.UTC(newY, newM0, day));
}

/** Compute the FIRST due date based on a template's start_date + rules. */
export function firstDueDate(t: {
  frequency: RecurringFrequency;
  start_date: string;
  day_of_month?: number;
  day_of_week?: number;
}): string {
  const start = parse(t.start_date);

  if (t.frequency === "weekly" || t.frequency === "biweekly") {
    if (t.day_of_week !== undefined) {
      const startDow = start.getUTCDay();
      const diff = (t.day_of_week - startDow + 7) % 7;
      return iso(new Date(start.getTime() + diff * DAY_MS));
    }
    return iso(start);
  }

  if (t.frequency === "monthly" || t.frequency === "quarterly" || t.frequency === "annual") {
    if (t.day_of_month !== undefined) {
      const y = start.getUTCFullYear();
      const m0 = start.getUTCMonth();
      const lastDay = lastDayOfMonth(y, m0);
      const day = t.day_of_month === -1 ? lastDay : Math.min(t.day_of_month, lastDay);
      let d = new Date(Date.UTC(y, m0, day));
      // If the chosen day is BEFORE the start_date, push forward one period
      if (d.getTime() < start.getTime()) {
        if (t.frequency === "monthly") d = addMonthsPreservingDay(d, 1, t.day_of_month);
        else if (t.frequency === "quarterly") d = addMonthsPreservingDay(d, 3, t.day_of_month);
        else d = addMonthsPreservingDay(d, 12, t.day_of_month);
      }
      return iso(d);
    }
  }

  return iso(start);
}

/** Compute the next due date AFTER `currentDue`. */
export function nextDueAfter(t: {
  frequency: RecurringFrequency;
  custom_interval_days?: number;
  day_of_month?: number;
}, currentDue: string): string {
  const d = parse(currentDue);
  switch (t.frequency) {
    case "daily":
      return iso(new Date(d.getTime() + DAY_MS));
    case "weekly":
      return iso(new Date(d.getTime() + 7 * DAY_MS));
    case "biweekly":
      return iso(new Date(d.getTime() + 14 * DAY_MS));
    case "monthly":
      return iso(addMonthsPreservingDay(d, 1, t.day_of_month));
    case "quarterly":
      return iso(addMonthsPreservingDay(d, 3, t.day_of_month));
    case "annual":
      return iso(addMonthsPreservingDay(d, 12, t.day_of_month));
    case "custom": {
      const days = Math.max(1, t.custom_interval_days ?? 30);
      return iso(new Date(d.getTime() + days * DAY_MS));
    }
  }
}

/** Returns all due dates from `next_due_date` up to and including `today`,
 *  optionally bounded by `end_date`. */
export function dueDatesUpTo(
  t: Pick<RecurringExpenseRecord, "frequency" | "custom_interval_days" | "day_of_month" | "next_due_date" | "end_date">,
  today: string,
  maxIterations = 366 // safety net
): string[] {
  const out: string[] = [];
  let cur = t.next_due_date;
  for (let i = 0; i < maxIterations; i++) {
    if (cur > today) break;
    if (t.end_date && cur > t.end_date) break;
    out.push(cur);
    cur = nextDueAfter(t, cur);
  }
  return out;
}
