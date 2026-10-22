import { decideUpsertAction, type ParsedCalendarEvent, type ExistingBlock, type UpsertAction } from './calendar-sync-shared.js';

export type ParsedOutlookEvent = ParsedCalendarEvent;
export type { ExistingBlock, UpsertAction };
export { decideUpsertAction };

export type ParsedDeltaPage = { events: ParsedOutlookEvent[]; nextLink?: string; deltaLink?: string };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseOneEvent(entry: unknown): ParsedOutlookEvent[] {
  const event = record(entry);
  if (!event || typeof event.id !== 'string') return [];
  // A delta query reports deletions as a bare {'@removed': {...}, id} entry, distinct from
  // a live event that's merely cancelled (isCancelled: true, e.g. a cancelled recurring
  // instance that Graph still reports rather than removing). Both need to archive.
  if (record(event['@removed']) || event.isCancelled === true) {
    return [{ id: event.id, cancelled: true, title: null, startsAt: null, endsAt: null, timezone: null, htmlLink: null }];
  }
  const start = record(event.start);
  const end = record(event.end);
  // Only timed events carry a reliable timezone; Graph has no all-day-only shape distinct
  // from a timed one here, so startsAt/endsAt are simply whatever start/end.dateTime report.
  const startsAt = typeof start?.dateTime === 'string' ? start.dateTime : null;
  const endsAt = typeof end?.dateTime === 'string' ? end.dateTime : null;
  const timezone = typeof start?.timeZone === 'string' ? start.timeZone : null;
  const title = typeof event.subject === 'string' && event.subject.trim() ? event.subject.trim() : 'Untitled event';
  const htmlLink = typeof event.webLink === 'string' ? event.webLink : null;
  return [{ id: event.id, cancelled: false, title, startsAt, endsAt, timezone, htmlLink }];
}

export function parseOutlookDeltaPage(value: unknown): ParsedDeltaPage {
  const root = record(value);
  const items = root?.value;
  const events = Array.isArray(items) ? items.flatMap(parseOneEvent) : [];
  const nextLink = typeof root?.['@odata.nextLink'] === 'string' ? root['@odata.nextLink'] : undefined;
  const deltaLink = typeof root?.['@odata.deltaLink'] === 'string' ? root['@odata.deltaLink'] : undefined;
  return { events, nextLink, deltaLink };
}
