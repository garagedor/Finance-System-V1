// ScanPay payouts ↔ bank deposits (pure — no I/O, unit-tested).
//
// A payout should land in the bank as one "SCANPAY USA" deposit for the same
// amount, around the date ScanPay expects it. Sometimes the bank books several
// payouts as one deposit, so after the one-to-one pass we also try small groups
// of payouts (same window) that add up to a deposit to the cent.

export interface PayoutForMatch {
  id: string;
  team: number;
  amount: number;
  expectedBy: string | null; // ISO date
  status: string;
}

export interface DepositForMatch {
  id: string;
  date: string;              // ISO date posted
  amount: number;            // positive = money in
  account: string;
}

export interface PayoutBankResult {
  /** deposit → the payout(s) it covers */
  matched: Array<{ depositId: string; payoutIds: string[]; dayDiff: number }>;
  /** Paid out by ScanPay a while ago, no deposit found. */
  missing: PayoutForMatch[];
  /** Not due yet, or still in transit. */
  pending: PayoutForMatch[];
  /** Bank deposits from ScanPay that no payout explains. */
  unexplained: DepositForMatch[];
}

const cents = (n: number) => Math.round(n * 100);
const dayNum = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000);

/** Deposit may post this many days before / after the expected date. */
export const WINDOW = { before: 2, after: 5 } as const;
/** A payout this many days past its expected date with no deposit is "missing". */
export const GRACE_DAYS = 4;

export function matchPayoutsToBank(
  payouts: PayoutForMatch[],
  deposits: DepositForMatch[],
  today: string,
): PayoutBankResult {
  const usedP = new Set<string>();
  const usedD = new Set<string>();
  const matched: PayoutBankResult['matched'] = [];

  const inWindow = (p: PayoutForMatch, d: DepositForMatch) => {
    if (!p.expectedBy) return false;
    const diff = dayNum(d.date) - dayNum(p.expectedBy);
    return diff >= -WINDOW.before && diff <= WINDOW.after;
  };

  // 1) One payout ↔ one deposit, closest date first.
  const pairs: Array<{ p: PayoutForMatch; d: DepositForMatch; gap: number }> = [];
  for (const p of payouts) {
    for (const d of deposits) {
      if (cents(p.amount) === cents(d.amount) && inWindow(p, d)) {
        pairs.push({ p, d, gap: Math.abs(dayNum(d.date) - dayNum(p.expectedBy!)) });
      }
    }
  }
  pairs.sort((a, b) => a.gap - b.gap || a.d.date.localeCompare(b.d.date));
  for (const { p, d } of pairs) {
    if (usedP.has(p.id) || usedD.has(d.id)) continue;
    usedP.add(p.id);
    usedD.add(d.id);
    matched.push({ depositId: d.id, payoutIds: [p.id], dayDiff: dayNum(d.date) - dayNum(p.expectedBy!) });
  }

  // 2) Several payouts booked as one deposit (2–4 payouts, exact to the cent).
  for (const d of deposits) {
    if (usedD.has(d.id)) continue;
    const pool = payouts.filter((p) => !usedP.has(p.id) && inWindow(p, d) && p.amount > 0);
    if (pool.length < 2 || pool.length > 40) continue;
    const target = cents(d.amount);
    const combo = findCombo(pool, target, 4);
    if (combo) {
      combo.forEach((p) => usedP.add(p.id));
      usedD.add(d.id);
      const latest = combo.reduce((m, p) => (p.expectedBy! > m ? p.expectedBy! : m), combo[0].expectedBy!);
      matched.push({ depositId: d.id, payoutIds: combo.map((p) => p.id), dayDiff: dayNum(d.date) - dayNum(latest) });
    }
  }

  const todayN = dayNum(today);
  const missing: PayoutForMatch[] = [];
  const pending: PayoutForMatch[] = [];
  for (const p of payouts) {
    if (usedP.has(p.id) || cents(p.amount) === 0) continue;
    const overdue = p.expectedBy != null && todayN - dayNum(p.expectedBy) > GRACE_DAYS;
    (overdue && /success/i.test(p.status) ? missing : pending).push(p);
  }
  return { matched, missing, pending, unexplained: deposits.filter((d) => !usedD.has(d.id)) };
}

function findCombo(pool: PayoutForMatch[], target: number, maxSize: number): PayoutForMatch[] | null {
  const items = [...pool].sort((a, b) => b.amount - a.amount);
  const pick: PayoutForMatch[] = [];
  const walk = (start: number, left: number): boolean => {
    if (left === 0 && pick.length >= 2) return true;
    if (pick.length === maxSize || left <= 0) return false;
    for (let i = start; i < items.length; i++) {
      const c = cents(items[i].amount);
      if (c > left) continue;
      pick.push(items[i]);
      if (walk(i + 1, left - c)) return true;
      pick.pop();
    }
    return false;
  };
  return walk(0, target) ? [...pick] : null;
}
