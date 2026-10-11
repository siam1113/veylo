import assert from 'node:assert/strict';
import test from 'node:test';
import { legacyRowMatches, legacyRowProjection, legacyTableColumns } from '../lib/legacy-migration.ts';

test('legacy migration allowlists each local table and its stable lookup key', () => {
  const expectations: Array<[string, string]> = [
    ['intentions', 'id'], ['sync_meta', 'key'], ['relationships', 'id'], ['relationship_outbox', 'op_id'],
    ['suggestion_feedback', 'client_id'], ['local_preferences', 'id'], ['preferences_outbox', 'id'],
    ['time_block_deletions', 'client_id'],
  ];
  for (const [table, key] of expectations) {
    assert.ok(legacyTableColumns[table]?.includes(key));
    assert.equal(legacyRowProjection(table, { [key]: 'stable-key' }).key, key);
  }
});

test('legacy migration ignores unknown source columns while preserving every recognized field', () => {
  const projection = legacyRowProjection('intentions', {
    id: 'intention-1', raw_capture: 'Plan a garden', title: 'Garden', obsolete_column: 'private',
  });
  assert.deepEqual(projection, { key: 'id', keyValue: 'intention-1', columns: ['id', 'raw_capture', 'title'] });
});

test('legacy migration refuses unknown tables, rows with no known fields, and rows without keys', () => {
  assert.throws(() => legacyRowProjection('unknown_table', { id: 'x' }), /does not recognize table/);
  assert.throws(() => legacyRowProjection('intentions', { obsolete_column: 'x' }), /no recognized fields or row key/);
  assert.throws(() => legacyRowProjection('sync_meta', { value: 'x' }), /no recognized fields or row key/);
  assert.throws(() => legacyRowProjection('sync_meta', { key: null, value: 'x' }), /without its key/);
});

test('legacy migration verification accepts an exact copied row and normalizes absent nullable values', () => {
  assert.equal(legacyRowMatches(['id', 'title', 'intent'], { id: '1', title: 'Plan', intent: null }, {
    id: '1', title: 'Plan', intent: null,
  }), true);
  assert.equal(legacyRowMatches(['id', 'title', 'intent'], { id: '1', title: 'Plan', intent: undefined }, {
    id: '1', title: 'Plan', intent: null,
  }), true);
});

test('legacy migration verification rejects missing or conflicting destination rows', () => {
  const expected = { id: '1', title: 'Plan' };
  assert.equal(legacyRowMatches(['id', 'title'], expected, null), false);
  assert.equal(legacyRowMatches(['id', 'title'], expected, { id: '1', title: 'Different' }), false);
});
