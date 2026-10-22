import { decideUpsertAction, type ParsedCalendarEvent, type ExistingBlock, type UpsertAction } from './calendar-sync-shared.js';

export type ParsedGoogleEvent = ParsedCalendarEvent;
export type { ExistingBlock, UpsertAction };
export { decideUpsertAction };

export type ParsedEventsPage = { events: ParsedGoogleEvent[]; nextPageToken?: string; nextSyncToken?: string };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseOneEvent(entry: unknown): ParsedGoogleEvent[] {
  const event = record(entry);
  if (!event || typeof event.id !== 'string') return [];
  if (event.status === 'cancelled') return [{ id: event.id, cancelled: true, title: null, startsAt: null, endsAt: null, timezone: null, htmlLink: null }];
  const start = record(event.start);
  const end = record(event.end);
  // Only timed events (start.dateTime) carry a reliable timezone; all-day events
  // (start.date only) are intentionally left unusable (startsAt: null) so
  // decideUpsertAction skips them rather than guessing a time of day.
  const startsAt = typeof start?.dateTime === 'string' ? start.dateTime : null;
  const endsAt = typeof end?.dateTime === 'string' ? end.dateTime : null;
  const timezone = typeof start?.timeZone === 'string' ? start.timeZone : null;
  const title = typeof event.summary === 'string' && event.summary.trim() ? event.summary.trim() : 'Untitled event';
  const htmlLink = typeof event.htmlLink === 'string' ? event.htmlLink : null;
  return [{ id: event.id, cancelled: false, title, startsAt, endsAt, timezone, htmlLink }];
}

export function parseGoogleCalendarEventsPage(value: unknown): ParsedEventsPage {
  const root = record(value);
  const items = root?.items;
  const events = Array.isArray(items) ? items.flatMap(parseOneEvent) : [];
  const nextPageToken = typeof root?.nextPageToken === 'string' ? root.nextPageToken : undefined;
  const nextSyncToken = typeof root?.nextSyncToken === 'string' ? root.nextSyncToken : undefined;
  return { events, nextPageToken, nextSyncToken };
}
