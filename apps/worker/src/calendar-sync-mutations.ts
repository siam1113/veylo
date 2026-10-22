import { randomUUID } from 'node:crypto';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { db } from '@clearhead/db/client';
import { intentions, timeBlocks, pushPreferences } from '@clearhead/db/schema';
import { initialOriginalVersions } from '@clearhead/domain';
import { clampTitle, isUniqueViolation, type ParsedCalendarEvent } from './calendar-sync-shared.js';

export async function resolveTimezoneFallback(ownerId: string): Promise<string> {
  const [row] = await db.select({ timezone: pushPreferences.timezone }).from(pushPreferences).where(eq(pushPreferences.ownerId, ownerId)).limit(1);
  return row?.timezone || 'UTC';
}

export async function createFromEvent(ownerId: string, provider: string, accountLabel: string | null, event: ParsedCalendarEvent, timezoneFallback: string) {
  const now = new Date();
  const clientId = randomUUID();
  const title = clampTitle(event.title ?? 'Untitled event');
  try {
    const [intention] = await db.insert(intentions).values({
      ownerId, clientId, rawCapture: title, title, kind: 'meeting', status: 'captured',
      originalVersions: initialOriginalVersions(clientId, title, now.toISOString()),
      createdAt: now, updatedAt: now,
    }).returning({ id: intentions.id });
    await db.insert(timeBlocks).values({
      ownerId, intentionId: intention!.id, clientId: randomUUID(),
      startsAt: new Date(event.startsAt!), endsAt: new Date(event.endsAt!), timezone: event.timezone || timezoneFallback,
      externalProvider: provider, externalEventId: event.id, externalUrl: event.htmlLink, externalTitle: title,
      externalAccountLabel: accountLabel, syncState: 'synced',
      createdAt: now, updatedAt: now,
    });
  } catch (error) {
    // Unique (ownerId, externalProvider, externalEventId) conflict: a concurrent
    // sync run, or the ClearHead->provider push flow, already claimed this event.
    // Fall back to updating whichever row won instead of leaving a duplicate.
    if (!isUniqueViolation(error)) throw error;
    const [existing] = await db.select({
      timeBlockId: timeBlocks.id, intentionId: timeBlocks.intentionId, intentionTitle: intentions.title, externalTitle: timeBlocks.externalTitle,
    }).from(timeBlocks).innerJoin(intentions, eq(timeBlocks.intentionId, intentions.id))
      .where(and(eq(timeBlocks.ownerId, ownerId), eq(timeBlocks.externalProvider, provider), eq(timeBlocks.externalEventId, event.id), isNull(timeBlocks.deletedAt))).limit(1);
    if (existing) {
      const titleDiverged = existing.externalTitle != null && existing.intentionTitle !== existing.externalTitle;
      await updateFromEvent(existing.timeBlockId, existing.intentionId, accountLabel, event, timezoneFallback, titleDiverged);
    }
  }
}

export async function updateFromEvent(timeBlockId: string, intentionId: string, accountLabel: string | null, event: ParsedCalendarEvent, timezoneFallback: string, titleDiverged: boolean) {
  const now = new Date();
  await db.update(timeBlocks).set({
    startsAt: new Date(event.startsAt!), endsAt: new Date(event.endsAt!), timezone: event.timezone || timezoneFallback,
    externalUrl: event.htmlLink, externalAccountLabel: accountLabel, updatedAt: now,
    // Once diverged, externalTitle is left frozen at its old value too, so ClearHead's edit
    // stays the winner on every future sync rather than only the one right after it.
    ...(titleDiverged ? {} : { externalTitle: clampTitle(event.title ?? 'Untitled event') }),
  }).where(eq(timeBlocks.id, timeBlockId));
  if (titleDiverged) return; // The user renamed this inside ClearHead; the provider's copy no longer wins.
  const title = clampTitle(event.title ?? 'Untitled event');
  await db.update(intentions).set({ title, rawCapture: title, updatedAt: now, version: sql`${intentions.version} + 1` }).where(eq(intentions.id, intentionId));
}

export async function archiveBlock(timeBlockId: string, intentionId: string) {
  const now = new Date();
  await db.update(timeBlocks).set({ deletedAt: now, updatedAt: now }).where(and(eq(timeBlocks.id, timeBlockId), isNull(timeBlocks.deletedAt)));
  await db.update(intentions).set({ status: 'archived', updatedAt: now, version: sql`${intentions.version} + 1` }).where(and(eq(intentions.id, intentionId), ne(intentions.status, 'archived')));
}
