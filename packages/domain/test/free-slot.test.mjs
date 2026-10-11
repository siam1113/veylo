import assert from 'node:assert/strict';
import test from 'node:test';
import { findAvailableSlot } from '../dist/index.js';

const day = new Date(2026, 9, 12);
const iso = (hour, minute = 0) => new Date(2026, 9, 12, hour, minute).toISOString();

test('finds the first quarter-hour slot after calendar and Veylo commitments', () => {
  const slot = findAvailableSlot({
    days: [day], durationMinutes: 30, now: new Date(2026, 9, 12, 8),
    busyWindows: [{ start: iso(9), end: iso(9, 30) }],
    plannedBlocks: [{ start: iso(9, 30), end: iso(10) }],
  });
  assert.equal(slot?.startsAt.toISOString(), iso(10));
  assert.equal(slot?.endsAt.toISOString(), iso(10, 30));
});

test('does not suggest a past slot on the current day', () => {
  const slot = findAvailableSlot({ days: [day], durationMinutes: 30, now: new Date(2026, 9, 12, 10, 7), busyWindows: [], plannedBlocks: [] });
  assert.equal(slot?.startsAt.toISOString(), iso(10, 15));
});

test('skips earlier dates in the currently visible week', () => {
  const previousDay = new Date(2026, 9, 11);
  const slot = findAvailableSlot({ days: [previousDay, day], durationMinutes: 30, now: new Date(2026, 9, 12, 10, 7), busyWindows: [], plannedBlocks: [] });
  assert.equal(slot?.startsAt.toISOString(), iso(10, 15));
});

test('moves to the next date when today has no remaining capacity', () => {
  const nextDay = new Date(2026, 9, 13);
  const slot = findAvailableSlot({ days: [day, nextDay], durationMinutes: 90, now: new Date(2026, 9, 12, 16), busyWindows: [], plannedBlocks: [] });
  assert.equal(slot?.startsAt.toISOString(), new Date(2026, 9, 13, 9).toISOString());
});

test('returns no slot for invalid durations, invalid known windows, or a full workday', () => {
  assert.equal(findAvailableSlot({ days: [day], durationMinutes: 0, busyWindows: [], plannedBlocks: [] }), null);
  assert.equal(findAvailableSlot({ days: [day], durationMinutes: 30, busyWindows: [{ start: 'bad', end: iso(10) }], plannedBlocks: [] }), null);
  assert.equal(findAvailableSlot({ days: [day], durationMinutes: 30, busyWindows: [{ start: iso(9), end: iso(17) }], plannedBlocks: [] }), null);
});
