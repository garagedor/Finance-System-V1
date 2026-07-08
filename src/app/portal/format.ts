// Formatting helpers shared across all Finance Portal pages.

export function fmt$(n: number | string | null | undefined, options?: { showSign?: boolean }): string {
  if (n === null || n === undefined) return "—";
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return "—";
  const formatted = Math.abs(v)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (v < 0) return `-$${formatted}`;
  if (v > 0 && options?.showSign) return `+$${formatted}`;
  return `$${formatted}`;
}

export function fmtPct(n: number | null | undefined, decimals = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(decimals)}%`;
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dd = typeof d === "string" ? new Date(d) : d;
  if (!Number.isFinite(dd.getTime())) return "—";
  return dd.toISOString().slice(0, 10);
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dd = typeof d === "string" ? new Date(d) : d;
  if (!Number.isFinite(dd.getTime())) return "—";
  return dd.toISOString().slice(0, 16).replace("T", " ");
}

export function moneyClass(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "money money-zero";
  if (n > 0.01) return "money money-pos";
  if (n < -0.01) return "money money-neg";
  return "money money-zero";
}

/** Compute the last-N-days window (returns ISO date strings). */
export function lastNDays(days: number): { from: string; to: string } {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const fromD = new Date(today);
  fromD.setDate(fromD.getDate() - days);
  const from = fromD.toISOString().slice(0, 10);
  return { from, to };
}

/** Current month bounds. */
export function thisMonth(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

export function lastMonth(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);
  return { from, to };
}
