import assert from 'node:assert/strict';
import test from 'node:test';
import { timeBlockInputSchema } from '../dist/index.js';

const validBlock = {
  clientId: '2170b3d2-3420-4f68-9abc-4fd861907bac',
  startsAt: '2026-11-01T05:30:00.000Z',
  endsAt: '2026-11-01T06:30:00.000Z',
  timezone: 'America/New_York',
};

test('time blocks accept an IANA timezone across a daylight-saving transition', () => {
  assert.equal(timeBlockInputSchema.safeParse(validBlock).success, true);
});

test('time blocks reject an unknown timezone instead of saving unusable calendar data', () => {
  assert.equal(timeBlockInputSchema.safeParse({ ...validBlock, timezone: 'Mars/Phobos' }).success, false);
});
