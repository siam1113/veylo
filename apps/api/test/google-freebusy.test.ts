import assert from 'node:assert/strict';
import test from 'node:test';
import { googleBusyWindows, googleFreeBusyRequest } from '../src/google-freebusy.ts';

test('Google free/busy requests preserve the visible range and selected timezone', () => {
  assert.deepEqual(googleFreeBusyRequest(
    '2026-10-12T00:00:00.000Z', '2026-10-19T00:00:00.000Z', 'Asia/Dhaka',
  ), {
    timeMin: '2026-10-12T00:00:00.000Z',
    timeMax: '2026-10-19T00:00:00.000Z',
    timeZone: 'Asia/Dhaka',
    items: [{ id: 'primary' }],
  });
});

test('Google response mapping exposes only valid busy boundaries', () => {
  assert.deepEqual(googleBusyWindows({ calendars: { primary: { busy: [
    { start: '2026-10-12T09:00:00.000Z', end: '2026-10-12T10:00:00.000Z', summary: 'Private appointment', event: { title: 'Secret' } },
    { start: '2026-10-12T11:00:00.000Z' },
    { start: 'not-a-date', end: '2026-10-12T12:00:00.000Z' },
    { start: '2026-10-12T13:00:00.000Z', end: '2026-10-12T13:00:00.000Z' },
    { start: '2026-10-12T14:00:00.000Z', end: '2026-10-12T15:00:00.000Z', extra: 'discarded' },
  ] } } }), [
    { start: '2026-10-12T09:00:00.000Z', end: '2026-10-12T10:00:00.000Z' },
    { start: '2026-10-12T14:00:00.000Z', end: '2026-10-12T15:00:00.000Z' },
  ]);
  assert.deepEqual(googleBusyWindows({ calendars: { primary: { busy: 'invalid' } } }), []);
  assert.deepEqual(googleBusyWindows(null), []);
});
