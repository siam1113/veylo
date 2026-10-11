import assert from 'node:assert/strict';
import test from 'node:test';
import { rankIntentionSuggestions } from '../dist/index.js';

const now = new Date('2026-10-10T12:00:00.000Z');
const makeItem = (id, overrides = {}) => ({
  id, status: 'ready', purpose: 'Make room for family', horizon: 'today',
  effortEstimate: 30, updatedAt: now.toISOString(), ...overrides,
});

test('ranking puts the fully aligned intention first and explains its purpose', () => {
  const strong = makeItem('strong');
  const lower = makeItem('lower', { purpose: null, horizon: 'month', effortEstimate: 180 });
  const [first] = rankIntentionSuggestions([lower, strong], [], { now });

  assert.equal(first.item.id, 'strong');
  assert.equal(first.score, 1);
  assert.equal(first.rationale, 'Connected to Make room for family.');
});

test('ranking excludes completed, archived, scheduled, accepted and dismissed items', () => {
  const items = [
    makeItem('completed', { status: 'completed' }),
    makeItem('archived', { status: 'archived' }),
    makeItem('scheduled', { blocks: [{ startsAt: '2026-10-11T09:00:00.000Z' }] }),
    makeItem('accepted'), makeItem('dismissed'), makeItem('available'),
  ];
  const feedback = [
    { clientId: 'accepted', state: 'accepted', snoozedUntil: null },
    { clientId: 'dismissed', state: 'dismissed', snoozedUntil: null },
  ];

  assert.deepEqual(rankIntentionSuggestions(items, feedback, { now }).map(({ item }) => item.id), ['available']);
});

test('expired snoozes can return and the requested suggestion limit is applied', () => {
  const items = [makeItem('first'), makeItem('second', { horizon: 'week' })];
  const feedback = [{ clientId: 'first', state: 'snoozed', snoozedUntil: '2026-10-09T12:00:00.000Z' }];

  assert.deepEqual(rankIntentionSuggestions(items, feedback, { now, limit: 1 }).map(({ item }) => item.id), ['first']);
});

test('future snoozes and scores below the tray threshold stay hidden', () => {
  const items = [
    makeItem('snoozed'),
    makeItem('weak', { purpose: null, horizon: null, effortEstimate: 180, status: 'captured', updatedAt: '2025-01-01T00:00:00.000Z' }),
  ];
  const feedback = [{ clientId: 'snoozed', state: 'snoozed', snoozedUntil: '2026-10-11T12:00:00.000Z' }];

  assert.deepEqual(rankIntentionSuggestions(items, feedback, { now }), []);
});
