import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchPayoutsToBank, type DepositForMatch, type PayoutForMatch } from './payout-bank-match';

const P = (id: string, amount: number, expectedBy: string, status = 'SUCCESS', team = 1): PayoutForMatch => ({ id, amount, expectedBy, status, team });
const D = (id: string, amount: number, date: string): DepositForMatch => ({ id, amount, date, account: 'LBS 3359' });

test('one payout ↔ one deposit, within the window', () => {
  const r = matchPayoutsToBank([P('PO-1', 71028.3, '2026-11-02')], [D('b1', 71028.3, '2026-11-03')], '2026-11-03');
  assert.deepEqual(r.matched, [{ depositId: 'b1', payoutIds: ['PO-1'], dayDiff: 1 }]);
  assert.equal(r.missing.length + r.pending.length + r.unexplained.length, 0);
});

test('same amount twice: each payout takes the deposit closest to its date', () => {
  const r = matchPayoutsToBank(
    [P('A', 500, '2026-10-01'), P('B', 500, '2026-10-08')],
    [D('x', 500, '2026-10-08'), D('y', 500, '2026-10-02')],
    '2026-10-20',
  );
  const by = Object.fromEntries(r.matched.map((m) => [m.payoutIds[0], m.depositId]));
  assert.deepEqual(by, { A: 'y', B: 'x' });
});

test('several payouts booked as one deposit', () => {
  const r = matchPayoutsToBank(
    [P('T1', 24489.76, '2026-11-02', 'SUCCESS', 2), P('T2', 32476.06, '2026-11-02', 'SUCCESS', 3)],
    [D('b', 56965.82, '2026-11-03')],
    '2026-11-03',
  );
  assert.equal(r.matched.length, 1);
  assert.deepEqual(r.matched[0].payoutIds.sort(), ['T1', 'T2']);
});

test('missing vs pending vs unexplained', () => {
  const r = matchPayoutsToBank(
    [P('old', 100, '2026-10-01'), P('new', 200, '2026-11-02', 'IN TRANSIT'), P('zero', 0, '2026-10-01')],
    [D('stray', 999, '2026-10-15')],
    '2026-11-03',
  );
  assert.deepEqual(r.missing.map((p) => p.id), ['old']);
  assert.deepEqual(r.pending.map((p) => p.id), ['new']);
  assert.deepEqual(r.unexplained.map((d) => d.id), ['stray']);
});

test('a deposit outside the window is not matched', () => {
  const r = matchPayoutsToBank([P('A', 300, '2026-10-01')], [D('late', 300, '2026-10-20')], '2026-10-25');
  assert.equal(r.matched.length, 0);
  assert.deepEqual(r.missing.map((p) => p.id), ['A']);
});
