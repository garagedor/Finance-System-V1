import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardAmountMatches, clearWinner, nameMatches, techMatches } from './match-score';

test('tech: CRM short name vs ScanPay full name', () => {
  assert.equal(techMatches('Oren', ['Oren Kadosh']), true);
  assert.equal(techMatches('oren k', ['Oren Kadosh']), true);
  assert.equal(techMatches('Oren K', ['Oren Levi']), false);
  assert.equal(techMatches('Ofek', ['Oren Kadosh', 'Ofek Elisha']), true);
  assert.equal(techMatches('Yaniv', ['Yanai Cohen']), false);
  assert.equal(techMatches('', ['Oren']), false);
});

test('customer names', () => {
  assert.equal(nameMatches('Cameron Smith', 'cameron'), true);
  assert.equal(nameMatches('Mrs. Jane Lopez', 'Lopez Jane'), true);
  assert.equal(nameMatches('Danny', 'Dan'), false);
});

test('card amount with or without tip, numbers stored as strings', () => {
  assert.equal(cardAmountMatches({ totalPaidCard: '1500', tipsCard: '118.02' }, 1618.02), true);
  assert.equal(cardAmountMatches({ totalPaidCard: 1618.02 }, 1618.02), true);
  assert.equal(cardAmountMatches({ totalPaidCard: '1500' }, 1618.02), false);
});

test('only a clear winner is suggested', () => {
  assert.equal(clearWinner([{ score: 95 }, { score: 60 }], 80, 20)?.score, 95);
  assert.equal(clearWinner([{ score: 95 }, { score: 85 }], 80, 20), null);
  assert.equal(clearWinner([{ score: 70 }], 80, 20), null);
});
