import assert from 'node:assert/strict';
import test from 'node:test';
import { googleEventId, googleEventPayload, plainEventDescription } from '../src/google-event.ts';

const timeBlockId = '9ed813e9-b5e1-45f9-b563-3c4fe0b5cabe';

test('Google event ID is deterministic and valid for the same ClearHead time block', () => {
  const id = googleEventId(timeBlockId);
  assert.equal(id, googleEventId(timeBlockId));
  assert.match(id, /^v[0-9a-f]{31}$/);
  assert.notEqual(id, googleEventId('f54fbe3a-c290-48a6-90d7-40cbeeb0e398'));
});

test('Google event payload carries the approved plan and timezone without raw capture text', () => {
  assert.deepEqual(googleEventPayload({
    timeBlockId,
    startsAt: new Date('2026-10-15T03:00:00.000Z'),
    endsAt: new Date('2026-10-15T03:45:00.000Z'),
    timezone: 'Asia/Dhaka',
    title: 'Talk with Maya',
    intent: 'Explore the garden idea',
    purpose: 'Make room for a shared project',
  }), {
    id: googleEventId(timeBlockId),
    summary: 'Talk with Maya',
    description: 'Explore the garden idea\n\nWhy it matters: Make room for a shared project',
    start: { dateTime: '2026-10-15T03:00:00.000Z', timeZone: 'Asia/Dhaka' },
    end: { dateTime: '2026-10-15T03:45:00.000Z', timeZone: 'Asia/Dhaka' },
  });
});

test('an explicit description override (e.g. from the confirmation modal) takes precedence over the plain intent/purpose concatenation', () => {
  const payload = googleEventPayload({
    timeBlockId,
    startsAt: new Date('2026-10-15T03:00:00.000Z'),
    endsAt: new Date('2026-10-15T03:45:00.000Z'),
    timezone: 'Asia/Dhaka',
    title: 'Talk with Maya',
    intent: 'Explore the garden idea',
    purpose: 'Make room for a shared project',
    description: 'A well-formatted AI-written summary.',
  });
  assert.equal(payload.description, 'A well-formatted AI-written summary.');
});

test('plainEventDescription builds the fallback used when there is no override', () => {
  assert.equal(plainEventDescription('Explore the garden idea', 'Make room for a shared project'), 'Explore the garden idea\n\nWhy it matters: Make room for a shared project');
  assert.equal(plainEventDescription(null, null), '');
  assert.equal(plainEventDescription(null, 'Make room'), 'Why it matters: Make room');
});
