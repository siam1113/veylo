import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@clearhead/db/client';
import { integrations, intentions, timeBlocks } from '@clearhead/db/schema';
import { calendarApiRequest, getGoogleConnection } from './google-calendar-token.js';
import { parseGoogleCalendarEventsPage, decideUpsertAction, type ParsedGoogleEvent } from './google-calendar-sync-parser.js';
import { initialSyncTimeMin } from './calendar-sync-shared.js';
import { createFromEvent, updateFromEvent, archiveBlock, resolveTimezoneFallback } from './calendar-sync-mutations.js';

const PAGE_SIZE = '250';
const PROVIDER = 'google_calendar';

type CollectedPages = { events: ParsedGoogleEvent[]; nextSyncToken?: string; expired: boolean; disconnected: boolean };

async function collectAllPages(integrationId: string, baseParams: URLSearchParams): Promise<CollectedPages> {
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  const events: ParsedGoogleEvent[] = [];
  do {
    const params = new URLSearchParams(baseParams);
    if (pageToken) params.set('pageToken', pageToken);
    const { status, body } = await calendarApiRequest(integrationId, `/calendars/primary/events?${params}`);
    if (status === 409) return { events: [], expired: false, disconnected: true };
    if (status === 410) return { events: [], expired: true, disconnected: false };
    if (status < 200 || status >= 300) throw new Error(`Google Calendar returned ${status} during sync.`);
    const page = parseGoogleCalendarEventsPage(body);
    events.push(...page.events);
    pageToken = page.nextPageToken;
    if (page.nextSyncToken) nextSyncToken = page.nextSyncToken;
  } while (pageToken);
  return { events, nextSyncToken, expired: false, disconnected: false };
}

export async function syncGoogleCalendarForIntegration(integrationId: string): Promise<{ created: number; updated: number; archived: number; fullResync: boolean }> {
  const connection = await getGoogleConnection(integrationId);
  if (!connection) return { created: 0, updated: 0, archived: 0, fullResync: false };
  const ownerId = connection.ownerId;
  const accountLabel = (connection.metadata as { accountLabel?: string })?.accountLabel ?? null;

  const metadata = (connection.metadata ?? {}) as { googleCalendarSyncToken?: string };
  const storedToken = metadata.googleCalendarSyncToken;
  const baseParams = () => new URLSearchParams({ singleEvents: 'true', showDeleted: 'true', maxResults: PAGE_SIZE });

  let fullResync = !storedToken;
  let params = baseParams();
  if (storedToken) params.set('syncToken', storedToken);
  else params.set('timeMin', initialSyncTimeMin());

  let result = await collectAllPages(integrationId, params);
  if (result.disconnected) return { created: 0, updated: 0, archived: 0, fullResync: false };
  if (result.expired) {
    // The stored sync token is no longer valid (expired, or filters changed). Google's
    // documented recovery is to discard it and do a fresh, forward-looking resync now,
    // rather than leaving this owner stuck until someone notices and reconnects.
    fullResync = true;
    params = baseParams();
    params.set('timeMin', initialSyncTimeMin());
    result = await collectAllPages(integrationId, params);
    if (result.disconnected) return { created: 0, updated: 0, archived: 0, fullResync };
    if (result.expired) throw new Error('Google Calendar sync token kept expiring.');
  }

  const eventIds = result.events.map((event) => event.id);
  const existingRows = eventIds.length ? await db.select({
    timeBlockId: timeBlocks.id, intentionId: timeBlocks.intentionId, externalEventId: timeBlocks.externalEventId,
    intentionTitle: intentions.title, externalTitle: timeBlocks.externalTitle,
  }).from(timeBlocks).innerJoin(intentions, eq(timeBlocks.intentionId, intentions.id)).where(and(
    eq(timeBlocks.ownerId, ownerId), eq(timeBlocks.externalProvider, PROVIDER), inArray(timeBlocks.externalEventId, eventIds), isNull(timeBlocks.deletedAt),
  )) : [];
  const existingByEventId = new Map(existingRows.map((row) => [row.externalEventId!, {
    timeBlockId: row.timeBlockId, intentionId: row.intentionId, intentionTitle: row.intentionTitle, externalTitle: row.externalTitle,
  }]));

  const timezoneFallback = await resolveTimezoneFallback(ownerId);
  let created = 0, updated = 0, archived = 0;
  for (const event of result.events) {
    const action = decideUpsertAction(event, existingByEventId.get(event.id) ?? null);
    if (action.kind === 'create') { await createFromEvent(ownerId, PROVIDER, accountLabel, action.event, timezoneFallback); created++; }
    else if (action.kind === 'update') { await updateFromEvent(action.timeBlockId, action.intentionId, accountLabel, action.event, timezoneFallback, action.titleDiverged); updated++; }
    else if (action.kind === 'archive') { await archiveBlock(action.timeBlockId, action.intentionId); archived++; }
  }

  if (result.nextSyncToken) {
    // A concurrent run (periodic tick overlapping a manual "sync now") may have already
    // advanced the cursor; only persist this run's token if the stored one hasn't moved.
    await db.update(integrations).set({ metadata: { ...metadata, googleCalendarSyncToken: result.nextSyncToken }, lastSyncedAt: new Date() })
      .where(and(eq(integrations.id, connection.id), sql`${integrations.metadata}->>'googleCalendarSyncToken' IS NOT DISTINCT FROM ${storedToken ?? null}`));
  } else {
    await db.update(integrations).set({ lastSyncedAt: new Date() }).where(eq(integrations.id, connection.id));
  }

  return { created, updated, archived, fullResync };
}
