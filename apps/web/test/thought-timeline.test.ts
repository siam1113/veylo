import assert from 'node:assert/strict';
import test from 'node:test';
import { initialOriginalVersions } from '@clearhead/domain';
import { thoughtTimeline } from '../app/lib/thought-timeline';
import type { SyncIntention } from '../app/lib/sync.client';
const time = '2026-10-10T08:00:00.000Z';
const item: SyncIntention = { id: '3078190f-ff7b-44ed-bf0e-739ef0219372', rawCapture: 'An idea', title: 'An idea', kind: 'idea', status: 'captured', createdAt: time, updatedAt: time };
test('timeline shows real capture and sync events, never marks an offline piece as synced', () => {
  const local = { ...item, originalVersions: initialOriginalVersions(item.id, item.rawCapture, time) };
  assert.deepEqual(thoughtTimeline(local, []).map((event) => event.title), ['Idea added']);
  const remote = { ...item, originalVersions: initialOriginalVersions(item.id, item.rawCapture, time, time) };
  assert.deepEqual(thoughtTimeline(remote, []).map((event) => event.title), ['Idea added', 'Synced']);
});
test('timeline uses human events and retains the questions that were asked', () => {
  const events = thoughtTimeline(item, [
    { id: 'request', version: 1, action: 'ai_requested', createdAt: time, changedFields: [] },
    { id: 'polish', version: 2, action: 'ai_suggestion', createdAt: time, changedFields: [], details: { questions: ['Who is this for?'] } },
    { id: 'clarification', version: 3, action: 'updated', createdAt: time, changedFields: ['desiredOutcome'] },
  ]);
  assert.deepEqual(events.map((event) => event.title), ['Polish requested', 'Idea polished', 'Questions asked', 'You clarified', 'Synced']);
  assert.deepEqual(events.find((event) => event.title === 'Questions asked')?.questions, ['Who is this for?']);
});
