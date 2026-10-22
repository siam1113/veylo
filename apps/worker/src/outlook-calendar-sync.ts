import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@clearhead/db/client';
import { integrations, intentions, timeBlocks } from '@clearhead/db/schema';
import { graphApiRequest, getOutlookConnection } from './outlook-calendar-token.js';
import { parseOutlookDeltaPage, decideUpsertAction, type ParsedOutlookEvent } from './outlook-calendar-sync-parser.js';
import { initialSyncTimeMin } from './calendar-sync-shared.js';
import { createFromEvent, updateFromEvent, archiveBlock, resolveTimezoneFallback } from './calendar-sync-mutations.js';

const PROVIDER = 'outlook';
// Graph's delta endpoint requires a window on the very first call; once a deltaLink is
// established it carries its own window forward indefinitely (new events arrive via delta
// regardless of this bound), so this only matters once. A 2-year window here previously
// made calendarView's full recurrence expansion (e.g. a daily standup -> ~730 instances
// per series) paginate for minutes and reliably hit Graph's rate limiting; since a failed
// job never persists a deltaLink, every retry - including the next scheduled tick - redid
// the same oversized scan from scratch, so the account never finished its first sync.
const FUTURE_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;

type CollectedPages = { events: ParsedOutlookEvent[]; deltaLink?: string; expired: boolean; disconnected: boolean };

async function collectAllPages(integrationId: string, startUrl: string): Promise<CollectedPages> {
  let url: string | undefined = startUrl;
  let deltaLink: string | undefined;
  const events: ParsedOutlookEvent[] = [];
  do {
    const { status, body } = await graphApiRequest(integrationId, url);
    if (status === 409) return { events: [], expired: false, disconnected: true };
    if (status === 410) return { events: [], expired: true, disconnected: false };
    if (status < 200 || status >= 300) throw new Error(`Microsoft Graph returned ${status} during Outlook calendar sync.`);
    const page = parseOutlookDeltaPage(body);
    events.push(...page.events);
    url = page.nextLink;
    if (page.deltaLink) deltaLink = page.deltaLink;
  } while (url);
  return { events, deltaLink, expired: false, disconnected: false };
}

function freshDeltaUrl(): string {
  const start = initialSyncTimeMin();
  const end = new Date(Date.now() + FUTURE_WINDOW_MS).toISOString();
  const query = new URLSearchParams({ startDateTime: start, endDateTime: end });
  return `/me/calendarView/delta?${query}`;
}

export async function syncOutlookCalendarForIntegration(integrationId: string): Promise<{ created: number; updated: number; archived: number; fullResync: boolean }> {
  const connection = await getOutlookConnection(integrationId);
  if (!connection) return { created: 0, updated: 0, archived: 0, fullResync: false };
  const ownerId = connection.ownerId;
  const accountLabel = (connection.metadata as { accountLabel?: string })?.accountLabel ?? null;

  const metadata = (connection.metadata ?? {}) as { outlookCalendarDeltaLink?: string };
  const storedLink = metadata.outlookCalendarDeltaLink;

  let fullResync = !storedLink;
  let result = await collectAllPages(integrationId, storedLink ?? freshDeltaUrl());
  if (result.disconnected) return { created: 0, updated: 0, archived: 0, fullResync: false };
  if (result.expired) {
    // The stored delta link is no longer valid (expired, or the window needs to restart).
    // Graph's documented recovery is to discard it and do a fresh, forward-looking resync.
    fullResync = true;
    result = await collectAllPages(integrationId, freshDeltaUrl());
    if (result.disconnected) return { created: 0, updated: 0, archived: 0, fullResync };
    if (result.expired) throw new Error('Outlook Calendar delta link kept expiring.');
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

  if (result.deltaLink) {
    await db.update(integrations).set({ metadata: { ...metadata, outlookCalendarDeltaLink: result.deltaLink }, lastSyncedAt: new Date() })
      .where(eq(integrations.id, connection.id));
  } else {
    await db.update(integrations).set({ lastSyncedAt: new Date() }).where(eq(integrations.id, connection.id));
  }

  return { created, updated, archived, fullResync };
}
