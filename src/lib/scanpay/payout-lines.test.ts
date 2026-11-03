import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invoiceOfCollectedLine, payoutDate, payoutTotals, refundsByPayment, toPayoutQueryDate, type ScanpayPayoutLineRaw } from './payout-lines';

const L = (type: string, amount: string, extra: Partial<ScanpayPayoutLineRaw> = {}): ScanpayPayoutLineRaw =>
  ({ type, name: type, amount, date: '11/02/2026', ...extra });

test('dates', () => {
  assert.equal(payoutDate('11/02/2026'), '2026-11-02');
  assert.equal(payoutDate('1/5/2026'), '2026-01-05');
  assert.equal(payoutDate('2026-11-02'), null);
  assert.equal(toPayoutQueryDate('2026-10-26'), '10/26/2026');
});

test('payout adds up: collected − fees + refunds + adjustments (real payout PO-1793664706-616)', () => {
  const t = payoutTotals([
    L('Collected', '72083.81'), L('Fees', '2155.92'),
    L('Adjustments', '1285.41'), L('Adjustments', '-185.00'),
  ]);
  assert.equal(t.collected, 72083.81);
  assert.equal(t.fees, 2155.92);
  assert.equal(t.adjustments, 1100.41);
  assert.equal(t.net, 71028.3);
});

test('refunds are summed per payment, newest date kept, each refund counted once', () => {
  const lines = [
    L('Refunds', '-835.70', { date: '10/02/2026', relatedPaymentId: 'SP1', relatedRefundId: 'R1' }),
    L('Refunds', '-100.00', { date: '10/05/2026', relatedPaymentId: 'SP1', relatedRefundId: 'R2' }),
    L('Refunds', '-100.00', { date: '10/05/2026', relatedPaymentId: 'SP1', relatedRefundId: 'R2' }), // same refund read twice
    L('Refunds', '-50.00', { relatedPaymentId: 'SP2', relatedRefundId: 'R3' }),
    L('Collected', '500', { relatedPaymentId: 'SP3' }),
  ];
  const m = refundsByPayment(lines);
  assert.equal(m.size, 2);
  assert.deepEqual(m.get('SP1'), { paymentId: 'SP1', amount: 935.7, firstDate: '2026-10-02', lastDate: '2026-10-05', refundIds: ['R1', 'R2'] });
  assert.equal(m.get('SP2')!.amount, 50);
});

test('a Collected line names its invoice', () => {
  assert.equal(invoiceOfCollectedLine(L('Collected', '523.95', { description: 'Payment SP261101-04233 for invoice IN-1793576591-104' })), 'IN-1793576591-104');
  assert.equal(invoiceOfCollectedLine(L('Collected', '1', { description: 'something else' })), null);
});
