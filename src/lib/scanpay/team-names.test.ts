import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teamLabel, teamLabelById } from './team-names';

test('internal names by ScanPay team id, not by key order', () => {
  assert.equal(teamLabel(1), 'Ohio / Indiana');
  assert.equal(teamLabel(2), 'Milwaukee / Minneapolis');
  assert.equal(teamLabel(3), 'Chicago');
  assert.equal(teamLabel(1, [37019, 36900]), 'Chicago');
  assert.equal(teamLabel(4), 'Account 4');
  assert.equal(teamLabelById(37020), 'Milwaukee / Minneapolis');
});
