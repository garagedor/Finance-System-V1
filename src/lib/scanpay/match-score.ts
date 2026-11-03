// Pure scoring helpers for ScanPay → CRM job matching (unit-tested).
//
// ScanPay names people in full ("Oren Kadosh"); the CRM keeps a short tech name
// ("Oren", sometimes "Oren K"). Customer names differ the same way.

const tokens = (s: unknown) =>
  String(s ?? "").toLowerCase().replace(/[^a-z֐-׿ ]/g, " ").split(/\s+/).filter(Boolean);

/** Does the CRM tech name refer to one of these ScanPay people? */
export function techMatches(crmTech: unknown, scanpayNames: unknown[]): boolean {
  const t = tokens(crmTech);
  if (!t.length) return false;
  const crmFull = t.join(" ");
  for (const n of scanpayNames) {
    const p = tokens(n);
    if (!p.length) continue;
    if (p.join(" ") === crmFull) return true;
    // "Oren" ↔ "Oren Kadosh": first names agree (and the last initial, if the CRM gives one).
    if (p[0] === t[0] && (t.length === 1 || (p[1] ?? "").startsWith(t[1][0]))) return true;
  }
  return false;
}

/** Customer names agree on the first name, or share a longer word. */
export function nameMatches(a: unknown, b: unknown): boolean {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.length || !y.length) return false;
  return x[0] === y[0] || x.some((w) => w.length > 2 && y.includes(w));
}

export const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** The payment amount equals the job's card (with or without the card tip). */
export function cardAmountMatches(job: { totalPaidCard?: unknown; tipsCard?: unknown; totalAmount?: unknown }, amount: number, tip = 0): boolean {
  const card = num(job.totalPaidCard);
  const t = num(job.tipsCard);
  return [card, card + t, card + tip, num(job.totalAmount)].some((v) => v > 0 && Math.abs(v - amount) <= 1);
}

/** Pick the best candidate only when it is strong AND clearly ahead. */
export function clearWinner<T extends { score: number }>(sorted: T[], min: number, lead: number): T | null {
  if (!sorted.length || sorted[0].score < min) return null;
  if (sorted.length > 1 && sorted[0].score - sorted[1].score < lead) return null;
  return sorted[0];
}
