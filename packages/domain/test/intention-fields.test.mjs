import assert from 'node:assert/strict';
import test from 'node:test';
import { intentionPatchSchema } from '../dist/index.js';

test('intention edits accept optional horizon, effort, and energy context', () => {
  assert.deepEqual(intentionPatchSchema.parse({
    expectedVersion: 3,
    horizon: 'week',
    effortEstimate: 45,
    energyContext: 'quiet focus',
  }), {
    expectedVersion: 3,
    horizon: 'week',
    effortEstimate: 45,
    energyContext: 'quiet focus',
  });
});

test('intention edits can clear optional horizon, effort, and energy context', () => {
  assert.deepEqual(intentionPatchSchema.parse({
    expectedVersion: 3,
    horizon: null,
    effortEstimate: null,
    energyContext: null,
  }), {
    expectedVersion: 3,
    horizon: null,
    effortEstimate: null,
    energyContext: null,
  });
});

test('intention edits reject invalid effort estimates and oversized energy context', () => {
  for (const effortEstimate of [-1, 1.5, 10081]) {
    assert.equal(intentionPatchSchema.safeParse({ expectedVersion: 1, effortEstimate }).success, false);
  }
  assert.equal(intentionPatchSchema.safeParse({ expectedVersion: 1, energyContext: 'x'.repeat(121) }).success, false);
});
