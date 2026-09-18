import test from 'node:test';
import assert from 'node:assert/strict';
import { createMedian, NOBODY_M, sanitise } from './smooth.ts';

test('no echo means nobody, not zero metres', () => {
  assert.equal(sanitise(0), NOBODY_M);
  assert.equal(sanitise(9.9), NOBODY_M);
  assert.equal(sanitise(Number.NaN), NOBODY_M);
  assert.equal(sanitise(1.2), 1.2);
});

test('a single spike does not move the smoothed reading', () => {
  const m = createMedian(5);
  const out = [1.0, 1.02, 0.05, 0.99, 1.01].map(m);
  assert.ok(out.at(-1)! > 0.95, `spike leaked through: ${out.at(-1)}`);
});

test('a real change comes through within a few readings', () => {
  const m = createMedian(5);
  [2, 2, 2, 2, 2].forEach(m);
  const out = [0.4, 0.4, 0.4].map(m);
  assert.equal(out.at(-1), 0.4);
});
