// Small client helpers shared by the Arena admin screens.

export class ApiError extends Error {
  constructor(message: string, readonly problems: string[] = []) {
    super(message);
  }
}

export async function api<T = unknown>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const r = await fetch(url, {
    method: init?.method ?? "GET",
    headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const j = (await r.json().catch(() => ({}))) as { error?: string; problems?: string[] };
  if (!r.ok) throw new ApiError(j.error ?? `Request failed (${r.status})`, j.problems ?? []);
  return j as T;
}

export const dollars = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 ? 2 : 0 });

export const pct = (bp: number) => `${(bp / 100).toFixed(bp % 100 ? 2 : 0)}%`;

export const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET" : "—";

/** "2026-11-02" → "Nov 2 – Nov 8" */
export function weekLabel(weekStart: string): string {
  const d = new Date(`${weekStart}T12:00:00Z`);
  const e = new Date(d.getTime() + 6 * 86_400_000);
  const f = (x: Date) => x.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${f(d)} – ${f(e)}`;
}

/** Monday of the week after today (America/New_York). */
export function nextMonday(): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + (8 - dow));
  return d.toISOString().slice(0, 10);
}

/** Monday of the last fully completed week (America/New_York). */
export function lastCompletedMonday(): string {
  const d = new Date(`${nextMonday()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 14);
  return d.toISOString().slice(0, 10);
}

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft", scheduled: "Scheduled", active: "Active", suspended: "Suspended", provisional: "Provisional",
  in_review: "In review", approved: "Approved", cancelled: "Cancelled",
  open: "Open", pending_owner: "Waiting for owner", resolved: "Resolved",
};

export const statusPill = (s: string) =>
  s === "active" || s === "approved" || s === "resolved" ? "pill pill-paid"
  : s === "suspended" || s === "cancelled" ? "pill pill-unpaid"
  : s === "pending_owner" || s === "scheduled" || s === "in_review" ? "pill pill-pending"
  : s === "open" ? "pill pill-open"
  : "pill pill-draft";
