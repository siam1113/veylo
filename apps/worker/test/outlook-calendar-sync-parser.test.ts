import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOutlookDeltaPage, decideUpsertAction } from '../src/outlook-calendar-sync-parser.ts';

test('parses a timed event with its title, times, timezone, and link', () => {
  const page = parseOutlookDeltaPage({
    value: [{
      id: 'evt1', subject: 'Design review',
      start: { dateTime: '2026-10-21T15:00:00.0000000', timeZone: 'America/New_York' },
      end: { dateTime: '2026-10-21T15:30:00.0000000', timeZone: 'America/New_York' },
      webLink: 'https://outlook.office.com/calendar/evt1',
    }],
  });
  assert.deepEqual(page.events, [{
    id: 'evt1', cancelled: false, title: 'Design review',
    startsAt: '2026-10-21T15:00:00.0000000', endsAt: '2026-10-21T15:30:00.0000000',
    timezone: 'America/New_York', htmlLink: 'https://outlook.office.com/calendar/evt1',
  }]);
});

test('falls back to "Untitled event" when the subject is missing or blank', () => {
  const page = parseOutlookDeltaPage({ value: [
    { id: 'evt1', start: { dateTime: '2026-10-21T15:00:00' }, end: { dateTime: '2026-10-21T15:30:00' } },
    { id: 'evt2', subject: '   ', start: { dateTime: '2026-10-21T15:00:00' }, end: { dateTime: '2026-10-21T15:30:00' } },
  ] });
  assert.equal(page.events[0]?.title, 'Untitled event');
  assert.equal(page.events[1]?.title, 'Untitled event');
});

test('a delta "@removed" entry is treated as cancelled with no other fields', () => {
  const page = parseOutlookDeltaPage({ value: [{ id: 'evt1', '@removed': { reason: 'deleted' } }] });
  assert.deepEqual(page.events, [{ id: 'evt1', cancelled: true, title: null, startsAt: null, endsAt: null, timezone: null, htmlLink: null }]);
});

test('a live event with isCancelled true is treated as cancelled too, distinct from @removed', () => {
  const page = parseOutlookDeltaPage({ value: [{
    id: 'evt1', subject: 'Cancelled instance', isCancelled: true,
    start: { dateTime: '2026-10-21T15:00:00' }, end: { dateTime: '2026-10-21T15:30:00' },
  }] });
  assert.deepEqual(page.events, [{ id: 'evt1', cancelled: true, title: null, startsAt: null, endsAt: null, timezone: null, htmlLink: null }]);
});

test('surfaces @odata.nextLink and @odata.deltaLink from the response root', () => {
  const page = parseOutlookDeltaPage({ value: [], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/page-2' });
  assert.equal(page.nextLink, 'https://graph.microsoft.com/v1.0/page-2');
  assert.equal(page.deltaLink, undefined);
  const lastPage = parseOutlookDeltaPage({ value: [], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta-token-123' });
  assert.equal(lastPage.nextLink, undefined);
  assert.equal(lastPage.deltaLink, 'https://graph.microsoft.com/v1.0/delta-token-123');
});

test('drops malformed entries without an id', () => {
  const page = parseOutlookDeltaPage({ value: [{ subject: 'No id' }, null, 'not an object'] });
  assert.deepEqual(page.events, []);
});

test('decideUpsertAction is reused as-is from the shared module (title-divergence protection)', () => {
  const event = { id: 'evt1', cancelled: false, title: 'Design review', startsAt: '2026-10-21T15:00:00Z', endsAt: '2026-10-21T15:30:00Z', timezone: 'UTC', htmlLink: null };
  const diverged = { timeBlockId: 'tb1', intentionId: 'in1', intentionTitle: 'Design review with product team', externalTitle: 'Design review' };
  assert.deepEqual(decideUpsertAction(event, diverged), { kind: 'update', timeBlockId: 'tb1', intentionId: 'in1', event, titleDiverged: true });
  assert.deepEqual(decideUpsertAction(event, null), { kind: 'create', event });
});
