import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarAvailabilityMatchesRange } from '../dist/index.js';

test('free/busy results apply to the exact checked date range', () => {
  const range = { start: '2026-10-04', end: '2026-10-11' };
  assert.equal(calendarAvailabilityMatchesRange(range, range), true);
  assert.equal(calendarAvailabilityMatchesRange(range, { start: '2026-10-11', end: '2026-10-18' }), false);
  assert.equal(calendarAvailabilityMatchesRange(range, { start: '2026-10-04', end: '2026-10-05' }), false);
  assert.equal(calendarAvailabilityMatchesRange(null, range), false);
});
