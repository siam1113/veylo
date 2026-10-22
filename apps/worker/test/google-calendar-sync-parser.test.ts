import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGoogleCalendarEventsPage, decideUpsertAction } from '../src/google-calendar-sync-parser.ts';

test('parses a timed event with its title, times, timezone, and link', () => {
  const page = parseGoogleCalendarEventsPage({
    items: [{
      id: 'evt1', summary: 'Design review',
      start: { dateTime: '2026-10-21T15:00:00-04:00', timeZone: 'America/New_York' },
      end: { dateTime: '2026-10-21T15:30:00-04:00', timeZone: 'America/New_York' },
      htmlLink: 'https://calendar.google.com/evt1',
    }],
  });
  assert.deepEqual(page.events, [{
    id: 'evt1', cancelled: false, title: 'Design review',
    startsAt: '2026-10-21T15:00:00-04:00', endsAt: '2026-10-21T15:30:00-04:00',
    timezone: 'America/New_York', htmlLink: 'https://calendar.google.com/evt1',
  }]);
});

test('falls back to "Untitled event" when the summary is missing or blank', () => {
  const page = parseGoogleCalendarEventsPage({ items: [
    { id: 'evt1', start: { dateTime: '2026-10-21T15:00:00Z' }, end: { dateTime: '2026-10-21T15:30:00Z' } },
    { id: 'evt2', summary: '   ', start: { dateTime: '2026-10-21T15:00:00Z' }, end: { dateTime: '2026-10-21T15:30:00Z' } },
  ] });
  assert.equal(page.events[0]?.title, 'Untitled event');
  assert.equal(page.events[1]?.title, 'Untitled event');
});

test('marks an all-day (date-only) event as unusable rather than guessing a time', () => {
  const page = parseGoogleCalendarEventsPage({ items: [
    { id: 'evt1', summary: 'Company holiday', start: { date: '2026-12-25' }, end: { date: '2026-12-26' } },
  ] });
  assert.equal(page.events[0]?.startsAt, null);
  assert.equal(page.events[0]?.endsAt, null);
});

test('records a cancelled event with no other fields', () => {
  const page = parseGoogleCalendarEventsPage({ items: [{ id: 'evt1', status: 'cancelled' }] });
  assert.deepEqual(page.events, [{ id: 'evt1', cancelled: true, title: null, startsAt: null, endsAt: null, timezone: null, htmlLink: null }]);
});

test('surfaces nextPageToken and nextSyncToken from the response root', () => {
  const page = parseGoogleCalendarEventsPage({ items: [], nextPageToken: 'page-2' });
  assert.equal(page.nextPageToken, 'page-2');
  assert.equal(page.nextSyncToken, undefined);
  const lastPage = parseGoogleCalendarEventsPage({ items: [], nextSyncToken: 'token-123' });
  assert.equal(lastPage.nextPageToken, undefined);
  assert.equal(lastPage.nextSyncToken, 'token-123');
});

test('drops malformed entries without an id', () => {
  const page = parseGoogleCalendarEventsPage({ items: [{ summary: 'No id' }, null, 'not an object'] });
  assert.deepEqual(page.events, []);
});

test('decideUpsertAction: a brand-new timed event with no local row creates', () => {
  const event = { id: 'evt1', cancelled: false, title: 'Design review', startsAt: '2026-10-21T15:00:00Z', endsAt: '2026-10-21T15:30:00Z', timezone: 'UTC', htmlLink: null };
  assert.deepEqual(decideUpsertAction(event, null), { kind: 'create', event });
});

test('decideUpsertAction: a timed event matching an existing row updates it', () => {
  const event = { id: 'evt1', cancelled: false, title: 'Design review', startsAt: '2026-10-21T15:00:00Z', endsAt: '2026-10-21T15:30:00Z', timezone: 'UTC', htmlLink: null };
  const existing = { timeBlockId: 'tb1', intentionId: 'in1' };
  assert.deepEqual(decideUpsertAction(event, existing), { kind: 'update', timeBlockId: 'tb1', intentionId: 'in1', event, titleDiverged: false });
});

test('decideUpsertAction: no externalTitle baseline yet (e.g. a fresh ClearHead push) is never diverged', () => {
  const event = { id: 'evt1', cancelled: false, title: 'Design review', startsAt: '2026-10-21T15:00:00Z', endsAt: '2026-10-21T15:30:00Z', timezone: 'UTC', htmlLink: null };
  const existing = { timeBlockId: 'tb1', intentionId: 'in1', intentionTitle: 'Something the user already renamed', externalTitle: null };
  assert.equal(decideUpsertAction(event, existing).kind, 'update');
  assert.equal((decideUpsertAction(event, existing) as { titleDiverged: boolean }).titleDiverged, false);
});

test('decideUpsertAction: live title still matches the last-applied Google title is not diverged', () => {
  const event = { id: 'evt1', cancelled: false, title: 'Design review v2', startsAt: '2026-10-21T15:00:00Z', endsAt: '2026-10-21T15:30:00Z', timezone: 'UTC', htmlLink: null };
  const existing = { timeBlockId: 'tb1', intentionId: 'in1', intentionTitle: 'Design review', externalTitle: 'Design review' };
  assert.deepEqual(decideUpsertAction(event, existing), { kind: 'update', timeBlockId: 'tb1', intentionId: 'in1', event, titleDiverged: false });
});

test('decideUpsertAction: a ClearHead-side rename since the last applied Google title wins (diverged)', () => {
  const event = { id: 'evt1', cancelled: false, title: 'Design review', startsAt: '2026-10-21T15:00:00Z', endsAt: '2026-10-21T15:30:00Z', timezone: 'UTC', htmlLink: null };
  const existing = { timeBlockId: 'tb1', intentionId: 'in1', intentionTitle: 'Design review with product team', externalTitle: 'Design review' };
  assert.deepEqual(decideUpsertAction(event, existing), { kind: 'update', timeBlockId: 'tb1', intentionId: 'in1', event, titleDiverged: true });
});

test('decideUpsertAction: a cancelled event matching an existing row archives it', () => {
  const event = { id: 'evt1', cancelled: true, title: null, startsAt: null, endsAt: null, timezone: null, htmlLink: null };
  const existing = { timeBlockId: 'tb1', intentionId: 'in1' };
  assert.deepEqual(decideUpsertAction(event, existing), { kind: 'archive', timeBlockId: 'tb1', intentionId: 'in1' });
});

test('decideUpsertAction: a cancelled event with no matching local row is skipped', () => {
  const event = { id: 'evt1', cancelled: true, title: null, startsAt: null, endsAt: null, timezone: null, htmlLink: null };
  assert.deepEqual(decideUpsertAction(event, null), { kind: 'skip' });
});

test('decideUpsertAction: an all-day event is skipped whether or not a local row exists', () => {
  const event = { id: 'evt1', cancelled: false, title: 'Holiday', startsAt: null, endsAt: null, timezone: null, htmlLink: null };
  assert.deepEqual(decideUpsertAction(event, null), { kind: 'skip' });
  assert.deepEqual(decideUpsertAction(event, { timeBlockId: 'tb1', intentionId: 'in1' }), { kind: 'skip' });
});
