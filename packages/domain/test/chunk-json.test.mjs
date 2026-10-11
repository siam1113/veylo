import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkJsonPayload } from '../dist/index.js';

test('JSON batching observes the item cap without reordering records', () => {
  const batches = chunkJsonPayload(['a', 'b', 'c'], (items) => ({ items }), 1024, 2);

  assert.deepEqual(batches, [['a', 'b'], ['c']]);
});

test('JSON batching measures UTF-8 bytes at the configured payload boundary', () => {
  const batches = chunkJsonPayload(['🥝', 'a', 'b'], (items) => items, 9, 10);

  assert.deepEqual(batches, [['🥝'], ['a', 'b']]);
});
