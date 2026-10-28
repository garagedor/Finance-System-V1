import { test } from 'node:test';
import assert from 'node:assert/strict';
import { techPctOn } from './tech-rate';

const ofek = { profitPercent: '32', pastRates: [{ until: '2026-09-06', percent: 30 }] };

test('old rate up to and including the until date, new rate after', () => {
  assert.equal(techPctOn(ofek, '2026-08-31'), 30);
  assert.equal(techPctOn(ofek, '2026-09-06'), 30);
  assert.equal(techPctOn(ofek, '2026-09-07'), 32);
  assert.equal(techPctOn(ofek, '2026-10-20'), 32);
});

test('several past rates pick the earliest period that covers the date', () => {
  const t = { profitPercent: 35, pastRates: [{ until: '2026-06-30', percent: 30 }, { until: '2026-01-31', percent: 25 }] };
  assert.equal(techPctOn(t, '2026-01-15'), 25);
  assert.equal(techPctOn(t, '2026-03-01'), 30);
  assert.equal(techPctOn(t, '2026-07-01'), 35);
});

test('no history, missing date or tech fall back safely', () => {
  assert.equal(techPctOn({ profitPercent: '30' }, '2026-01-01'), 30);
  assert.equal(techPctOn(ofek, ''), 32);
  assert.equal(techPctOn(ofek, undefined), 32);
  assert.equal(techPctOn(undefined, '2026-01-01'), 0);
});
