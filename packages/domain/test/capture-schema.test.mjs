import assert from 'node:assert/strict';
import test from 'node:test';
import { appendVoiceTranscript, captureInputSchema, intentionSchema } from '../dist/index.js';

const clientId = '2170b3d2-3420-4f68-9abc-4fd861907bac';

test('capture input keeps the exact submitted text', () => {
  const rawCapture = '  Need to talk with Maya about that idea, maybe next week.\n';
  assert.equal(captureInputSchema.parse({ rawCapture, clientId }).rawCapture, rawCapture);
});

test('capture input rejects whitespace-only text', () => {
  assert.equal(captureInputSchema.safeParse({ rawCapture: ' \t\n ', clientId }).success, false);
});

test('capture input preserves long dictation up to the shared limit', () => {
  const rawCapture = 'a'.repeat(8000);
  assert.equal(captureInputSchema.parse({ rawCapture, clientId }).rawCapture, rawCapture);
  assert.equal(captureInputSchema.safeParse({ rawCapture: `${rawCapture}a`, clientId }).success, false);
});

test('voice dictation appends to typed text without changing its original spacing', () => {
  assert.deepEqual(appendVoiceTranscript('Typed thought  ', ' spoken words '), {
    rawCapture: 'Typed thought  spoken words', truncated: false,
  });
  assert.deepEqual(appendVoiceTranscript('', ' spoken words '), { rawCapture: 'spoken words', truncated: false });
});

test('voice dictation reports when it exceeds the shared capture limit', () => {
  const result = appendVoiceTranscript('a'.repeat(7998), 'extra words');
  assert.equal(result.rawCapture.length, 8000);
  assert.equal(result.truncated, true);
});

test('saved intention keeps the exact original capture', () => {
  const rawCapture = '\tMaybe I should make Sunday dinner feel less rushed.  ';
  const intention = intentionSchema.parse({
    id: clientId, rawCapture, title: 'Make Sunday dinner feel less rushed', kind: 'idea',
    createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z',
  });
  assert.equal(intention.rawCapture, rawCapture);
});

test('saved intention rejects a whitespace-only original capture', () => {
  assert.equal(intentionSchema.safeParse({
    id: clientId, rawCapture: ' \t\n ', title: 'A new thought', kind: 'unclassified',
    createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z',
  }).success, false);
});
