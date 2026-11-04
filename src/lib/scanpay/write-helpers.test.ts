import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRefundableStatus, majorityTeam, parseUsAddress, pickMember, refundable, splitName, type ScanpayMember } from './write-helpers';

const M = (id: string, first: string, last: string, role = 'member', status = 'ACTIVE'): ScanpayMember => ({ memberId: id, firstName: first, lastName: last, role, status });

test('member: the job tech when matched, else the owner, else an admin', () => {
  const ms = [M('o', 'Yehonatan', 'Cohen', 'owner'), M('a', 'Malik', 'A', 'admin'), M('t', 'Ofek', 'Elisha')];
  assert.deepEqual(pickMember(ms, 'Ofek'), { member: ms[2], why: 'tech' });
  assert.deepEqual(pickMember(ms, 'Unknown'), { member: ms[0], why: 'owner' });
  assert.deepEqual(pickMember([ms[1]], null), { member: ms[1], why: 'admin' });
  // two people with the same first name → not sure → owner
  assert.equal(pickMember([...ms, M('t2', 'Ofek', 'Levi')], 'Ofek')!.why, 'owner');
  // inactive members are never picked
  assert.equal(pickMember([M('x', 'Ofek', 'E', 'member', 'INACTIVE'), ms[0]], 'Ofek')!.why, 'owner');
});

test('majority account for a location', () => {
  assert.equal(majorityTeam(new Map([[1, 3], [2, 40], [3, 5]])), 2);
  assert.equal(majorityTeam(new Map()), null);
});

test('US address parsing', () => {
  assert.deepEqual(parseUsAddress('3110 Crosby St, Rockford, IL 61107'), { street: '3110 Crosby St', city: 'Rockford', state: 'IL', zipCode: '61107' });
  assert.deepEqual(parseUsAddress('2329 N Diamond St, Kokomo, Indiana, 46901'), { street: '2329 N Diamond St', city: 'Kokomo', state: 'Indiana', zipCode: '46901' });
  assert.equal(parseUsAddress('somewhere'), null);
});

test('names and refundable amount', () => {
  assert.deepEqual(splitName('Danny'), { firstName: 'Danny', lastName: '-' });
  assert.deepEqual(splitName('Mary Ann Lopez'), { firstName: 'Mary', lastName: 'Ann Lopez' });
  assert.equal(refundable(1618.02, 250), 1368.02);
  assert.equal(refundable(100, 150), 0);
});

test('only successful payments are refundable', () => {
  assert.equal(isRefundableStatus('SUCCESS'), true);
  assert.equal(isRefundableStatus('PARTIALLY_REFUNDED'), true);
  assert.equal(isRefundableStatus('FAILED'), false);
  assert.equal(isRefundableStatus('DECLINED'), false);
  assert.equal(isRefundableStatus(''), false);
});
