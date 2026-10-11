import assert from 'node:assert/strict';
import test from 'node:test';
import { getAIInterpretationUndo, matchesAIOnlyChange } from '../src/ai-interpretation.ts';

const previous = { title: 'Call Maya', kind: 'action', horizon: null };
const applied = { title: 'Ask Maya about the garden', kind: 'meeting', horizon: 'week' };
const metadata = {
  processedAt: '2026-10-10T12:00:00.000Z',
  previousTitle: previous.title, previousKind: previous.kind, previousHorizon: previous.horizon,
  appliedTitle: applied.title, appliedKind: applied.kind, appliedHorizon: applied.horizon,
};

test('AI undo recovers the prior title, type, and nullable horizon', () => {
  assert.deepEqual(getAIInterpretationUndo(metadata, applied), {
    previous,
    applied,
    tracksHorizon: true,
  });
});

test('AI undo is unavailable after any AI-applied field has been edited', () => {
  assert.equal(getAIInterpretationUndo(metadata, { ...applied, title: 'A user edit' }), null);
  assert.equal(getAIInterpretationUndo(metadata, { ...applied, horizon: 'month' }), null);
  assert.equal(getAIInterpretationUndo({ ...metadata, undoneAt: '2026-10-10T12:01:00.000Z' }, applied), null);
});

test('offline AI-only reconciliation requires the live row to match the applied snapshot', () => {
  assert.equal(matchesAIOnlyChange(metadata, previous, applied), true);
  assert.equal(matchesAIOnlyChange(metadata, previous, { ...applied, title: 'Later user edit' }), false);
  assert.equal(matchesAIOnlyChange(metadata, previous, { ...applied, horizon: 'month' }), false);
});

test('older AI metadata remains undoable and preserves its untouched horizon', () => {
  const legacyMetadata = {
    processedAt: '2026-10-10T12:00:00.000Z',
    previousTitle: previous.title, previousKind: previous.kind,
    appliedTitle: applied.title, appliedKind: applied.kind,
  };
  assert.deepEqual(getAIInterpretationUndo(legacyMetadata, { ...applied, horizon: 'month' }), {
    previous: { ...previous, horizon: 'month' },
    applied: { ...applied, horizon: 'month' },
    tracksHorizon: false,
  });
  assert.equal(matchesAIOnlyChange(legacyMetadata, previous, applied), false);
});
