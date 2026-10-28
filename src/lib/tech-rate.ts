// A technician's profit % on a given job date.
//
// Technician.profitPercent is the CURRENT rate. When a rate changes, the old
// rate is kept in Technician.pastRates as { until: 'YYYY-MM-DD', percent }:
// jobs dated on or before `until` use that percent, later jobs use the next
// entry (or the current rate). So a raise never rewrites past reports.
//
//   Ofek: profitPercent 32, pastRates [{ until: '2026-09-06', percent: 30 }]
//     → 30% through 9/6, 32% from 9/7 (owner 2026-10-28).

export type PastRate = { until: string; percent: number | string };

type TechRateDoc = { profitPercent?: unknown; pastRates?: unknown } | null | undefined;

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

export function techPctOn(tech: TechRateDoc, date: unknown): number {
  if (!tech) return 0;
  const day = typeof date === 'string' && ISO_DAY.test(date) ? date.slice(0, 10) : '';
  const past = Array.isArray(tech.pastRates) ? (tech.pastRates as PastRate[]) : [];
  if (day && past.length) {
    const hit = past
      .filter((r) => typeof r?.until === 'string' && ISO_DAY.test(r.until))
      .sort((a, b) => a.until.localeCompare(b.until))
      .find((r) => day <= r.until.slice(0, 10));
    if (hit) return num(hit.percent);
  }
  return num(tech.profitPercent);
}
