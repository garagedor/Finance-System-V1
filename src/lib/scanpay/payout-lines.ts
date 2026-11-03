// Pure helpers for ScanPay payouts (no I/O — safe to unit-test and import anywhere).
//
// A payout is what ScanPay sends to the bank. GET /connect/v1/payouts/{id}/details
// lists every line in it: customer payments ("Collected"), ScanPay's fee per
// payment ("Fees", a positive number that is SUBTRACTED), refunds ("Refunds",
// negative), dispute deductions/returns ("Adjustments", signed) and more.
//   payout amount = Collected − Fees + Refunds + Adjustments (+ any other signed line)
// Verified to the cent on 40 payouts, 2026-11-03.

export interface ScanpayPayoutLineRaw {
  type: string;
  name: string;
  amount: string;
  date: string;               // MM/DD/YYYY
  description?: string;
  relatedPaymentId?: string;  // receipt id of the original customer payment (SP…)
  relatedRefundId?: string;
  relatedDisputeId?: string;
}

export interface PayoutTotals {
  collected: number;
  fees: number;        // positive: what ScanPay kept
  refunds: number;     // negative
  adjustments: number; // signed
  other: number;       // any line type not listed above, signed as given
  net: number;         // what should reach the bank
}

const num = (s: unknown): number => {
  const n = parseFloat(String(s ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** "11/02/2026" → "2026-11-02" (null if it isn't that shape). */
export function payoutDate(s: string | null | undefined): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s ?? '').trim());
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
}

/** "2026-11-02" → "11/02/2026", the format the payouts list filter takes. */
export function toPayoutQueryDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${m}/${d}/${y}`;
}

/** The signed effect of one line on the payout (fees are listed positive but deducted). */
export function lineEffect(l: Pick<ScanpayPayoutLineRaw, 'type' | 'amount'>): number {
  const a = num(l.amount);
  return /^fees?$/i.test(l.type.trim()) ? -Math.abs(a) : a;
}

export function payoutTotals(lines: ScanpayPayoutLineRaw[]): PayoutTotals {
  const t: PayoutTotals = { collected: 0, fees: 0, refunds: 0, adjustments: 0, other: 0, net: 0 };
  for (const l of lines) {
    const type = l.type.trim().toLowerCase();
    const a = num(l.amount);
    if (type === 'collected') t.collected += a;
    else if (type === 'fees' || type === 'fee') t.fees += Math.abs(a);
    else if (type === 'refunds' || type === 'refund') t.refunds += a;
    else if (type === 'adjustments' || type === 'adjustment') t.adjustments += a;
    else t.other += a;
    t.net += lineEffect(l);
  }
  return {
    collected: r2(t.collected), fees: r2(t.fees), refunds: r2(t.refunds),
    adjustments: r2(t.adjustments), other: r2(t.other), net: r2(t.net),
  };
}

/** "Payment SP261101-04233 for invoice IN-1793576591-104" → the invoice number. */
export function invoiceOfCollectedLine(l: ScanpayPayoutLineRaw): string | null {
  return /for invoice\s+(IN-[\w-]+)/i.exec(l.description ?? '')?.[1] ?? null;
}

export interface PaymentRefund {
  paymentId: string;
  amount: number;          // positive: total refunded on this payment
  firstDate: string | null;
  lastDate: string | null;
  refundIds: string[];
}

/** Every refund line, summed per original payment (a payment can be refunded in parts). */
export function refundsByPayment(lines: Array<ScanpayPayoutLineRaw>): Map<string, PaymentRefund> {
  const out = new Map<string, PaymentRefund>();
  const seen = new Set<string>();
  for (const l of lines) {
    if (!/^refunds?$/i.test(l.type.trim()) || !l.relatedPaymentId) continue;
    // A refund line can only be counted once, even if a payout is read twice.
    const key = l.relatedRefundId || `${l.relatedPaymentId}|${l.amount}|${l.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const d = payoutDate(l.date);
    const cur = out.get(l.relatedPaymentId) ?? { paymentId: l.relatedPaymentId, amount: 0, firstDate: null, lastDate: null, refundIds: [] };
    cur.amount = r2(cur.amount + Math.abs(num(l.amount)));
    if (d && (!cur.firstDate || d < cur.firstDate)) cur.firstDate = d;
    if (d && (!cur.lastDate || d > cur.lastDate)) cur.lastDate = d;
    if (l.relatedRefundId) cur.refundIds.push(l.relatedRefundId);
    out.set(l.relatedPaymentId, cur);
  }
  return out;
}
