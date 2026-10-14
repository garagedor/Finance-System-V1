import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combineFilterParts, type FilterPart } from './filter-combine';

const eq = (field: string, value: unknown): FilterPart => ({ field, condition: { [field]: { $eq: value } }, range: false });
const gt = (field: string, value: number): FilterPart => ({ field, condition: { [field]: { $gt: value } }, range: true });
const lt = (field: string, value: number): FilterPart => ({ field, condition: { [field]: { $lt: value } }, range: true });

test('two statuses add up instead of matching nothing', () => {
  assert.deepEqual(combineFilterParts([eq('status', 'Closed'), eq('status', 'Estimate')], 'AND'), [
    { $or: [{ status: { $eq: 'Closed' } }, { status: { $eq: 'Estimate' } }] },
  ]);
});

test('different fields still narrow each other', () => {
  assert.deepEqual(
    combineFilterParts([eq('status', 'Closed'), eq('tech', 'Yaniv'), eq('status', 'Estimate')], 'AND'),
    [
      { $or: [{ status: { $eq: 'Closed' } }, { status: { $eq: 'Estimate' } }] },
      { tech: { $eq: 'Yaniv' } },
    ],
  );
});

test('ranges on one field keep narrowing (100 < amount < 500)', () => {
  assert.deepEqual(combineFilterParts([gt('totalAmount', 100), lt('totalAmount', 500)], 'AND'), [
    { totalAmount: { $gt: 100 } },
    { totalAmount: { $lt: 500 } },
  ]);
});

test('OR switch makes every filter an alternative', () => {
  assert.deepEqual(combineFilterParts([eq('status', 'Closed'), eq('tech', 'Yaniv')], 'OR'), [
    { $or: [{ status: { $eq: 'Closed' } }, { tech: { $eq: 'Yaniv' } }] },
  ]);
});

test('single filter and no filters', () => {
  assert.deepEqual(combineFilterParts([eq('status', 'Closed')], 'AND'), [{ status: { $eq: 'Closed' } }]);
  assert.deepEqual(combineFilterParts([], 'AND'), []);
});
