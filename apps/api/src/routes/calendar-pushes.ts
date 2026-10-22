import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@clearhead/db/client';
import { calendarPushes, integrations, intentions, timeBlocks } from '@clearhead/db/schema';
import { requireOwner } from '../auth.js';
import { exchangeProviderToken } from '../connection-providers.js';
import { googleEventPayload, plainEventDescription } from '../google-event.js';
import { encrypt, decrypt, getConnectionById, googleToken, additionalConfig } from './integrations.js';

const problem = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const PROVIDER_REQUEST_TIMEOUT_MS = 20_000;
function providerFetch(url: string, init: RequestInit = {}) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS) });
}
function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === '23505');
}

type TimeBlockRow = typeof timeBlocks.$inferSelect;
type IntentionRow = typeof intentions.$inferSelect;
type PushResult = { integrationId: string; provider: string | null; status: 'synced' | 'error'; externalEventId?: string | null; externalUrl?: string | null; error?: string };

async function accessTokenForIntegration(ownerId: string, integrationId: string) {
  const row = await getConnectionById(ownerId, integrationId);
  if (row.provider !== 'google_calendar' && row.provider !== 'outlook') throw problem('This connection does not support calendar push.', 409);
  if (row.encryptedAccessToken && row.accessTokenExpiresAt && row.accessTokenExpiresAt.getTime() > Date.now() + 60_000) {
    return { token: decrypt(row.encryptedAccessToken), row };
  }
  if (!row.encryptedRefreshToken) throw problem('Reconnect this calendar to continue.', 409);
  const refreshToken = decrypt(row.encryptedRefreshToken);
  if (row.provider === 'google_calendar') {
    const tokens = await googleToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
    const expiresAt = new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000);
    const [updated] = await db.update(integrations).set({ encryptedAccessToken: encrypt(tokens.access_token), accessTokenExpiresAt: expiresAt })
      .where(and(eq(integrations.id, row.id), eq(integrations.encryptedRefreshToken, row.encryptedRefreshToken), isNull(integrations.revokedAt))).returning({ id: integrations.id });
    if (!updated) throw problem('This connection changed. Refresh and try again.', 409);
    return { token: tokens.access_token, row };
  }
  const tokens = await exchangeProviderToken('outlook', additionalConfig('outlook'), { grant_type: 'refresh_token', refresh_token: refreshToken });
  const encryptedToken = encrypt(tokens.access_token);
  const [updated] = await db.update(integrations).set({
    encryptedAccessToken: encryptedToken,
    encryptedRefreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : row.encryptedRefreshToken,
    accessTokenExpiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
  }).where(and(eq(integrations.id, row.id), eq(integrations.encryptedRefreshToken, row.encryptedRefreshToken), isNull(integrations.revokedAt))).returning({ id: integrations.id });
  if (!updated) throw problem('This connection changed. Refresh and try again.', 409);
  return { token: tokens.access_token, row };
}

// Claims a calendar_pushes row before calling the provider, same "claim before create"
// reasoning the Google push flow already relies on for time_blocks - a concurrent retry
// or the next background sync tick reading the same event back finds this row via the
// (timeBlockId, integrationId) / (ownerId, provider, externalEventId) unique indexes
// instead of creating a duplicate.
async function claimPushRow(ownerId: string, timeBlockId: string, integrationId: string, provider: string, externalEventId: string | null, existingId: string | undefined) {
  if (existingId) {
    const [row] = await db.update(calendarPushes).set({ syncState: 'pending', externalEventId, updatedAt: new Date(), deletedAt: null })
      .where(eq(calendarPushes.id, existingId)).returning();
    return row!;
  }
  try {
    const [row] = await db.insert(calendarPushes).values({ ownerId, timeBlockId, integrationId, provider, externalEventId, syncState: 'pending' }).returning();
    return row!;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Lost a race with a concurrent push request for the same (timeBlockId, integrationId) - use its row.
    const [row] = await db.select().from(calendarPushes).where(and(
      eq(calendarPushes.timeBlockId, timeBlockId), eq(calendarPushes.integrationId, integrationId), isNull(calendarPushes.deletedAt),
    )).limit(1);
    if (!row) throw error;
    return row;
  }
}

// The first successful push for a block also sets the legacy time_blocks.external* slot,
// so every existing UI binding that reads block.externalEventId/externalProvider/externalUrl
// directly keeps working unchanged. Later pushes to other calendars only add calendar_pushes
// rows - the slot always points at whichever calendar got pushed first.
async function claimPrimarySlot(ownerId: string, timeBlockId: string, provider: string, accountLabel: string | null, externalEventId: string, externalUrl: string | null, externalTitle: string) {
  await db.update(timeBlocks).set({
    externalProvider: provider, externalEventId, externalUrl, externalTitle, externalAccountLabel: accountLabel, syncState: 'synced', updatedAt: new Date(),
  }).where(and(eq(timeBlocks.id, timeBlockId), eq(timeBlocks.ownerId, ownerId), isNull(timeBlocks.externalProvider)));
}

async function googleCalendarApi(token: string, path: string, init: RequestInit = {}) {
  const response = await providerFetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const result = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = result as { error?: { message?: string } };
    throw problem(error?.error?.message || `Google Calendar returned ${response.status}.`, 502);
  }
  return result as Record<string, any> | null;
}

async function pushToGoogle(ownerId: string, integrationId: string, block: TimeBlockRow, intention: IntentionRow, title: string, description: string | undefined, existing?: typeof calendarPushes.$inferSelect): Promise<PushResult> {
  const body = googleEventPayload({
    timeBlockId: block.id, startsAt: block.startsAt, endsAt: block.endsAt, timezone: block.timezone,
    description, title, intent: intention.intent, purpose: intention.purpose,
  });
  const claimed = await claimPushRow(ownerId, block.id, integrationId, 'google_calendar', body.id, existing?.id);
  const { token, row } = await accessTokenForIntegration(ownerId, integrationId);
  const accountLabel = (row.metadata as { accountLabel?: string })?.accountLabel ?? null;
  let event: Record<string, any> | null;
  try { event = await googleCalendarApi(token, '/calendars/primary/events', { method: 'POST', body: JSON.stringify(body) }); }
  catch (error) {
    if (!(error instanceof Error) || !/already exists|409/i.test(error.message)) throw error;
    event = await googleCalendarApi(token, `/calendars/primary/events/${body.id}`);
  }
  const externalUrl = typeof event?.htmlLink === 'string' ? event.htmlLink : null;
  await db.update(calendarPushes).set({ externalUrl, externalTitle: body.summary, syncState: 'synced', updatedAt: new Date() }).where(eq(calendarPushes.id, claimed.id));
  await claimPrimarySlot(ownerId, block.id, 'google_calendar', accountLabel, body.id, externalUrl, body.summary);
  return { integrationId, provider: 'google_calendar', status: 'synced', externalEventId: body.id, externalUrl };
}

async function pushToOutlook(ownerId: string, integrationId: string, block: TimeBlockRow, intention: IntentionRow, title: string, description: string | undefined, existing?: typeof calendarPushes.$inferSelect): Promise<PushResult> {
  const claimed = await claimPushRow(ownerId, block.id, integrationId, 'outlook', null, existing?.id);
  const { token, row } = await accessTokenForIntegration(ownerId, integrationId);
  if (!row.scopes.includes('Calendars.ReadWrite')) throw problem('Reconnect Outlook to allow adding events to your calendar.', 409);
  const accountLabel = (row.metadata as { accountLabel?: string })?.accountLabel ?? null;
  const descriptionText = description ?? plainEventDescription(intention.intent, intention.purpose);
  const payload = {
    subject: title,
    body: { contentType: 'text', content: descriptionText },
    start: { dateTime: block.startsAt.toISOString(), timeZone: block.timezone },
    end: { dateTime: block.endsAt.toISOString(), timeZone: block.timezone },
  };
  const response = await providerFetch('https://graph.microsoft.com/v1.0/me/events', {
    method: 'POST',
    // Reduces (does not eliminate) retry-duplication risk: a crash between this claim and
    // Graph's response can still leave a pending row with no recoverable event id - accepted
    // for now, flagged as a follow-up reconciliation sweep rather than solved here.
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: `IdempotencyKey=${claimed.id}` },
    body: JSON.stringify(payload),
  });
  const event = await response.json().catch(() => ({})) as { id?: string; webLink?: string; error?: { message?: string } };
  if (!response.ok || typeof event.id !== 'string') throw problem(event.error?.message || `Outlook returned ${response.status}.`, 502);
  const externalUrl = typeof event.webLink === 'string' ? event.webLink : null;
  await db.update(calendarPushes).set({ externalEventId: event.id, externalUrl, externalTitle: title, syncState: 'synced', updatedAt: new Date() }).where(eq(calendarPushes.id, claimed.id));
  await claimPrimarySlot(ownerId, block.id, 'outlook', accountLabel, event.id, externalUrl, title);
  return { integrationId, provider: 'outlook', status: 'synced', externalEventId: event.id, externalUrl };
}

async function deleteGoogleEvent(token: string, eventId: string): Promise<void> {
  const response = await providerFetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
  });
  // 404/410/"already deleted" all mean the event is already gone from Google's side - the goal
  // (no event left on the connected calendar) is already met, so that's success, not failure.
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw problem(body?.error?.message || `Google Calendar returned ${response.status}.`, 502);
  }
}

async function deleteOutlookEvent(token: string, eventId: string): Promise<void> {
  const response = await providerFetch(`https://graph.microsoft.com/v1.0/me/events/${eventId}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw problem(body?.error?.message || `Outlook returned ${response.status}.`, 502);
  }
}

// Best-effort: deleting a thought should retract whatever it pushed to connected calendars
// immediately, but a provider outage or a revoked connection must never block the delete
// itself - the thought still needs to leave ClearHead's own views. Failures are logged and the
// local bookkeeping (calendarPushes.deletedAt, time_blocks.external*) is cleared regardless,
// so the UI never keeps showing a "synced to Google" badge for an event we gave up retracting.
export async function retractCalendarEventsForIntention(ownerId: string, intentionId: string): Promise<void> {
  const blocks = await db.select({ id: timeBlocks.id }).from(timeBlocks).where(and(
    eq(timeBlocks.intentionId, intentionId), eq(timeBlocks.ownerId, ownerId), isNull(timeBlocks.deletedAt),
  ));
  for (const block of blocks) {
    const pushes = await db.select().from(calendarPushes).where(and(
      eq(calendarPushes.timeBlockId, block.id), isNull(calendarPushes.deletedAt),
    ));
    for (const push of pushes) {
      if (push.externalEventId) {
        try {
          const { token } = await accessTokenForIntegration(ownerId, push.integrationId);
          if (push.provider === 'google_calendar') await deleteGoogleEvent(token, push.externalEventId);
          else if (push.provider === 'outlook') await deleteOutlookEvent(token, push.externalEventId);
        } catch (error) {
          console.error(JSON.stringify({ event: 'calendar_event_retract_failed', integrationId: push.integrationId, provider: push.provider, errorName: error instanceof Error ? error.name : 'unknown' }));
        }
      }
      await db.update(calendarPushes).set({ deletedAt: new Date() }).where(eq(calendarPushes.id, push.id));
    }
    await db.update(timeBlocks).set({
      externalProvider: null, externalEventId: null, externalUrl: null, externalTitle: null, externalAccountLabel: null, syncState: 'local', updatedAt: new Date(),
    }).where(eq(timeBlocks.id, block.id));
  }
}

async function pushToIntegration(ownerId: string, integrationId: string, block: TimeBlockRow, intention: IntentionRow, title: string, description: string | undefined): Promise<PushResult> {
  const connection = await getConnectionById(ownerId, integrationId);
  if (connection.provider !== 'google_calendar' && connection.provider !== 'outlook') throw problem('This connection does not support calendar push.', 409);

  const [existing] = await db.select().from(calendarPushes).where(and(
    eq(calendarPushes.timeBlockId, block.id), eq(calendarPushes.integrationId, integrationId), isNull(calendarPushes.deletedAt),
  )).limit(1);
  if (existing?.syncState === 'synced') {
    return { integrationId, provider: connection.provider, status: 'synced', externalEventId: existing.externalEventId, externalUrl: existing.externalUrl };
  }

  return connection.provider === 'google_calendar'
    ? pushToGoogle(ownerId, integrationId, block, intention, title, description, existing)
    : pushToOutlook(ownerId, integrationId, block, intention, title, description, existing);
}

export const calendarPushRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); });

  app.post('/calendar-pushes', async (request) => {
    const ownerId = requireOwner(request);
    const parsed = z.object({
      timeBlockId: z.string().uuid(),
      integrationIds: z.array(z.string().uuid()).min(1).max(10),
      title: z.string().min(1).max(160).optional(),
      description: z.string().max(2000).optional(),
    }).safeParse(request.body);
    if (!parsed.success) throw problem('Provide a saved time block and at least one connected calendar.');

    const [joined] = await db.select({ block: timeBlocks, intention: intentions }).from(timeBlocks)
      .innerJoin(intentions, eq(timeBlocks.intentionId, intentions.id))
      .where(and(eq(timeBlocks.id, parsed.data.timeBlockId), eq(timeBlocks.ownerId, ownerId), isNull(timeBlocks.deletedAt), isNull(intentions.deletedAt))).limit(1);
    if (!joined) throw problem('Time block was not found.', 404);

    const title = parsed.data.title ?? joined.intention.title;
    const pushes: PushResult[] = [];
    for (const integrationId of new Set(parsed.data.integrationIds)) {
      try {
        pushes.push(await pushToIntegration(ownerId, integrationId, joined.block, joined.intention, title, parsed.data.description));
      } catch (error) {
        pushes.push({ integrationId, provider: null, status: 'error', error: error instanceof Error ? error.message : 'Push failed.' });
      }
    }
    return { pushes };
  });
};
