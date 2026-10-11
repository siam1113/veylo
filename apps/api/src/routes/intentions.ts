import type { FastifyPluginAsync } from 'fastify';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@veylo/db/client';
import { alignmentAnchors, brainstormMessages, intentions, intentionRevisions, intentionRelationships, timeBlocks, suggestions, integrations, pushDevices, pushPreferences, webPushSubscriptions } from '@veylo/db/schema';
import { appendOriginalPiece, initialOriginalVersions, originalPieceInputSchema, originalGistsSchema, thoughtEvaluationSchema, captureInputSchema, intentionHorizons, intentionPatchSchema, rawCaptureMaxLength, timeBlockInputSchema, timeZoneSchema } from '@veylo/domain';
import { requireOwner } from '../auth.js';
import { shapeAccountExportConnection } from '../account-export.js';
import { enqueueBrainstormReply, enqueueInterpretation, enqueueSnoozeReminder, enqueueSnoozeReminderCheck } from '../jobs/queue.js';
import { env } from '../env.js';
import { getAIInterpretationUndo, matchesAIOnlyChange } from '../ai-interpretation.js';

const iso = (value: Date | null) => value?.toISOString() ?? null;
const shapeIntention = (row: typeof intentions.$inferSelect) => {
  const metadata = row.aiMetadata as Record<string, unknown>;
  const processedAt = typeof metadata.processedAt === 'string' ? metadata.processedAt : null;
  return {
    id: row.id, clientId: row.clientId, rawCapture: row.rawCapture,
    originalVersions: row.originalVersions.length ? row.originalVersions : initialOriginalVersions(row.clientId, row.rawCapture, row.createdAt.toISOString(), row.createdAt.toISOString()),
    originalGists: originalGistsSchema.safeParse(metadata.originalGists).data ?? {}, title: row.title, kind: row.kind,
    intent: row.intent, purpose: row.purpose, desiredOutcome: row.desiredOutcome,
    roughPlan: row.roughPlan, horizon: row.horizon, effortEstimate: row.effortEstimate,
    energyContext: row.energyContext, status: row.status,
    fieldEvaluation: thoughtEvaluationSchema.safeParse(metadata.fieldEvaluation).data ?? null,
    aiInterpretation: processedAt ? {
      confidence: typeof metadata.confidence === 'number' ? metadata.confidence : null,
      rationale: typeof metadata.rationale === 'string' ? metadata.rationale : null,
      model: typeof metadata.model === 'string' ? metadata.model : null,
      processedAt, undoneAt: typeof metadata.undoneAt === 'string' ? metadata.undoneAt : null,
      canUndo: getAIInterpretationUndo(metadata, { title: row.title, kind: row.kind, horizon: row.horizon }) !== null,
    } : null,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), version: row.version,
  };
};
const titleFrom = (raw: string) => {
  let title = raw.trim().replace(/^(i (want|need|should|might|could|would) to|i'd like to|we should|remember to|maybe i should)\s+/i, '');
  title = title.replace(/[.!?]+$/, '').replace(/\s+/g, ' ');
  title = title ? title[0]!.toUpperCase() + title.slice(1) : 'A new thought';
  return title.length > 64 ? `${title.slice(0, 61).trimEnd()}…` : title;
};
const kindFrom = (raw: string) => {
  const value = raw.toLowerCase();
  if (/^\s*(what|why|how|when|where|who|could|would|is it|should i)\b/.test(value)) return 'question';
  if (/\b(talk to|meet|call|discuss)\b/.test(value)) return 'meeting';
  if (/\b(ask|call|email|send|book|schedule|remind|finish|make|write|buy|prepare|visit)\b/.test(value)) return 'action';
  if (/\b(idea|imagine|explore|maybe|someday|wonder|could we)\b/.test(value)) return 'idea';
  if (/\b(goal|want to become|over the next|by the end)\b/.test(value)) return 'goal';
  return 'unclassified';
};
const bad = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const SYNC_CURSOR_OVERLAP_MS = 60_000;
const subscriptionKey = () => {
  if (!env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY) throw bad('Web push is not configured.', 503);
  return Buffer.from(env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY, 'hex');
};
const encryptSubscription = (value: unknown) => {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', subscriptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
};
const endpointHash = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex');
async function refreshPushEnabled(ownerId: string) {
  const [native] = await db.select({ id: pushDevices.id }).from(pushDevices).where(eq(pushDevices.ownerId, ownerId)).limit(1);
  const [web] = await db.select({ id: webPushSubscriptions.id }).from(webPushSubscriptions).where(eq(webPushSubscriptions.ownerId, ownerId)).limit(1);
  const enabled = Boolean(native || web);
  await db.insert(pushPreferences).values({ ownerId, enabled }).onConflictDoUpdate({
    target: pushPreferences.ownerId, set: { enabled, updatedAt: new Date() },
  });
}
async function aiEnabled(ownerId: string) {
  const [row] = await db.select({ enabled: pushPreferences.aiInterpretationEnabled }).from(pushPreferences).where(eq(pushPreferences.ownerId, ownerId)).limit(1);
  return row?.enabled === true;
}

export const intentionRoutes: FastifyPluginAsync = async (app) => {
  app.get('/relationships', async (request) => {
    const ownerId = requireOwner(request);
    const [links, ownedIntentions] = await Promise.all([
      db.select().from(intentionRelationships).where(eq(intentionRelationships.ownerId, ownerId)),
      db.select({ id: intentions.id, clientId: intentions.clientId, title: intentions.title }).from(intentions)
        .where(and(eq(intentions.ownerId, ownerId), isNull(intentions.deletedAt), ne(intentions.status, 'archived'))),
    ]);
    const byId = new Map(ownedIntentions.map((row) => [row.id, row]));
    return { relationships: links.flatMap((link) => {
      const from = byId.get(link.fromId); const to = byId.get(link.toId);
      return from && to ? [{ id: link.id, fromClientId: from.clientId, fromTitle: from.title, toClientId: to.clientId, toTitle: to.title, relation: link.relation }] : [];
    }) };
  });

  app.post('/relationships', async (request, reply) => {
    const ownerId = requireOwner(request);
    const parsed = z.object({
      fromClientId: z.string().uuid(), toClientId: z.string().uuid(),
      relation: z.enum(['supports', 'related', 'depends_on']).default('related'),
    }).safeParse(request.body);
    if (!parsed.success) throw bad(parsed.error.issues[0]?.message ?? 'Provide two intentions and a valid relationship type');
    if (parsed.data.fromClientId === parsed.data.toClientId) throw bad('An intention cannot be related to itself');
    const result = await db.transaction(async (tx) => {
      const owned = await tx.select({ id: intentions.id, clientId: intentions.clientId, title: intentions.title }).from(intentions).where(and(
        eq(intentions.ownerId, ownerId), inArray(intentions.clientId, [parsed.data.fromClientId, parsed.data.toClientId]),
        isNull(intentions.deletedAt), ne(intentions.status, 'archived'),
      )).orderBy(asc(intentions.id)).for('update');
      const from = owned.find((item) => item.clientId === parsed.data.fromClientId);
      const to = owned.find((item) => item.clientId === parsed.data.toClientId);
      if (!from || !to) return null;
      const [inserted] = await tx.insert(intentionRelationships).values({
        ownerId, fromId: from.id, toId: to.id, relation: parsed.data.relation,
      }).onConflictDoNothing().returning();
      const [existing] = inserted ? [inserted] : await tx.select().from(intentionRelationships).where(and(
        eq(intentionRelationships.ownerId, ownerId), eq(intentionRelationships.fromId, from.id),
        eq(intentionRelationships.toId, to.id), eq(intentionRelationships.relation, parsed.data.relation),
      )).limit(1);
      return { existing, from, to, created: Boolean(inserted) };
    });
    if (!result) return reply.code(404).send({ error: 'intention_not_found' });
    return reply.code(result.created ? 201 : 200).send({ relationship: result.existing ? {
      id: result.existing.id, fromClientId: parsed.data.fromClientId, fromTitle: result.from.title,
      toClientId: parsed.data.toClientId, toTitle: result.to.title, relation: result.existing.relation,
    } : null });
  });

  app.delete('/relationships', async (request, reply) => {
    const ownerId = requireOwner(request);
    const parsed = z.object({
      fromClientId: z.string().uuid(), toClientId: z.string().uuid(),
      relation: z.enum(['supports', 'related', 'depends_on']),
    }).safeParse(request.body);
    if (!parsed.success) throw bad(parsed.error.issues[0]?.message ?? 'Provide a relationship to remove');
    const rows = await db.select({ id: intentions.id, clientId: intentions.clientId }).from(intentions).where(and(
      eq(intentions.ownerId, ownerId), inArray(intentions.clientId, [parsed.data.fromClientId, parsed.data.toClientId]),
    ));
    const from = rows.find((row) => row.clientId === parsed.data.fromClientId);
    const to = rows.find((row) => row.clientId === parsed.data.toClientId);
    if (from && to) await db.delete(intentionRelationships).where(and(
      eq(intentionRelationships.ownerId, ownerId), eq(intentionRelationships.fromId, from.id),
      eq(intentionRelationships.toId, to.id), eq(intentionRelationships.relation, parsed.data.relation),
    ));
    return reply.code(204).send();
  });

  app.delete('/relationships/:id', async (request, reply) => {
    const ownerId = requireOwner(request);
    const { id } = request.params as { id: string };
    if (!z.string().uuid().safeParse(id).success) throw bad('Provide a valid relationship ID');
    const [removed] = await db.delete(intentionRelationships).where(and(
      eq(intentionRelationships.id, id), eq(intentionRelationships.ownerId, ownerId),
    )).returning({ id: intentionRelationships.id });
    if (!removed) return reply.code(404).send({ error: 'relationship_not_found' });
    return reply.code(204).send();
  });

  app.get('/preferences', async (request) => {
    const ownerId = requireOwner(request);
    const [[row], [nativeDevice]] = await Promise.all([
      db.select().from(pushPreferences).where(eq(pushPreferences.ownerId, ownerId)).limit(1),
      db.select({ id: pushDevices.id }).from(pushDevices).where(eq(pushDevices.ownerId, ownerId)).limit(1),
    ]);
    return {
      aiInterpretationEnabled: row?.aiInterpretationEnabled ?? false,
      reduceMotion: row?.reduceMotion ?? false,
      suggestionsEnabled: row?.suggestionsEnabled ?? true,
      suggestionLimit: row?.suggestionLimit ?? 2,
      notificationsEnabled: Boolean(nativeDevice),
      quietStart: row?.quietStart ?? null,
      quietEnd: row?.quietEnd ?? null,
      timezone: row?.timezone ?? null,
    };
  });

  app.put('/preferences', async (request) => {
    const ownerId = requireOwner(request);
    const parsed = z.object({
      aiInterpretationEnabled: z.boolean().optional(), reduceMotion: z.boolean().optional(),
      suggestionsEnabled: z.boolean().optional(), suggestionLimit: z.number().int().min(0).max(20).optional(),
      notificationsEnabled: z.boolean().optional(),
      quietStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
      quietEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
      timezone: timeZoneSchema.nullable().optional(),
    }).refine((value) => Object.keys(value).length > 0, { message: 'Choose at least one preference to update.' }).safeParse(request.body);
    if (!parsed.success) throw bad(parsed.error.issues[0]?.message ?? 'Choose valid preferences.');
    const [current] = await db.select().from(pushPreferences).where(eq(pushPreferences.ownerId, ownerId)).limit(1);
    const preferences = {
      aiInterpretationEnabled: parsed.data.aiInterpretationEnabled ?? current?.aiInterpretationEnabled ?? false,
      reduceMotion: parsed.data.reduceMotion ?? current?.reduceMotion ?? false,
      suggestionsEnabled: parsed.data.suggestionsEnabled ?? current?.suggestionsEnabled ?? true,
      suggestionLimit: parsed.data.suggestionLimit ?? current?.suggestionLimit ?? 2,
      enabled: parsed.data.notificationsEnabled ?? current?.enabled ?? false,
      quietStart: parsed.data.quietStart !== undefined ? parsed.data.quietStart : current?.quietStart ?? null,
      quietEnd: parsed.data.quietEnd !== undefined ? parsed.data.quietEnd : current?.quietEnd ?? null,
      timezone: parsed.data.timezone !== undefined ? parsed.data.timezone : current?.timezone ?? null,
    };
    const quietHoursChanged = preferences.quietStart !== (current?.quietStart ?? null)
      || preferences.quietEnd !== (current?.quietEnd ?? null)
      || preferences.timezone !== (current?.timezone ?? null);
    if (Boolean(preferences.quietStart) !== Boolean(preferences.quietEnd)) throw bad('Set both quiet-hour times or turn quiet hours off.');
    if (preferences.quietStart && preferences.quietStart === preferences.quietEnd) throw bad('Quiet-hour start and end must differ.');
    if (preferences.quietStart && !preferences.timezone) throw bad('Choose a timezone for quiet hours.');
    const [row] = await db.insert(pushPreferences).values({ ownerId, ...preferences })
      .onConflictDoUpdate({ target: pushPreferences.ownerId, set: { ...preferences, updatedAt: new Date() } }).returning();
    if (!row) throw bad('Could not save preferences.', 500);
    if (row.aiInterpretationEnabled) {
      const pending = await db.select().from(intentions).where(and(eq(intentions.ownerId, ownerId), inArray(intentions.status, ['captured', 'exploring']), isNull(intentions.deletedAt)));
      for (const intention of pending) if (!intention.aiMetadata.processedAt) void enqueueInterpretation({ intentionId: intention.id, ownerId, expectedVersion: intention.version });
    }
    if (quietHoursChanged) {
      const now = new Date();
      const dueReminders = await db.select({ intentionId: suggestions.intentionId, snoozedUntil: suggestions.snoozedUntil })
        .from(suggestions).innerJoin(intentions, eq(suggestions.intentionId, intentions.id)).where(and(
          eq(suggestions.ownerId, ownerId), eq(suggestions.type, 'intention_nudge'), eq(suggestions.state, 'snoozed'),
          lte(suggestions.snoozedUntil, now), eq(intentions.ownerId, ownerId), isNull(intentions.deletedAt),
          ne(intentions.status, 'archived'), ne(intentions.status, 'completed'),
        ));
      for (const reminder of dueReminders) if (reminder.intentionId && reminder.snoozedUntil) {
        await enqueueSnoozeReminderCheck({ intentionId: reminder.intentionId, ownerId, snoozedUntil: reminder.snoozedUntil.toISOString() });
      }
    }
    const [nativeDevice] = await db.select({ id: pushDevices.id }).from(pushDevices).where(eq(pushDevices.ownerId, ownerId)).limit(1);
    return {
      aiInterpretationEnabled: row.aiInterpretationEnabled,
      reduceMotion: row.reduceMotion,
      suggestionsEnabled: row.suggestionsEnabled,
      suggestionLimit: row.suggestionLimit,
      notificationsEnabled: Boolean(nativeDevice),
      quietStart: row.quietStart,
      quietEnd: row.quietEnd,
      timezone: row.timezone,
    };
  });

  app.post('/notifications/device', async (request) => {
    const ownerId = requireOwner(request);
    const parsed = z.object({
      expoPushToken: z.string().min(20).max(255).regex(/^Expo(nent)?PushToken\[/),
      platform: z.enum(['ios', 'android']),
    }).safeParse(request.body);
    if (!parsed.success) throw bad(parsed.error.issues[0]?.message ?? 'Invalid notification device.');
    await db.insert(pushDevices).values({ ownerId, ...parsed.data, updatedAt: new Date() })
      .onConflictDoUpdate({ target: pushDevices.expoPushToken, set: { ownerId, platform: parsed.data.platform, updatedAt: new Date() } });
    await db.insert(pushPreferences).values({ ownerId, enabled: true })
      .onConflictDoUpdate({ target: pushPreferences.ownerId, set: { enabled: true, updatedAt: new Date() } });
    return { notificationsEnabled: true };
  });

  app.delete('/notifications/device', async (request, reply) => {
    const ownerId = requireOwner(request);
    await db.delete(pushDevices).where(eq(pushDevices.ownerId, ownerId));
    await refreshPushEnabled(ownerId);
    return reply.code(204).send();
  });

  app.get('/notifications/web/config', async (request) => {
    const ownerId = requireOwner(request);
    const [subscription] = await db.select({ id: webPushSubscriptions.id }).from(webPushSubscriptions)
      .where(eq(webPushSubscriptions.ownerId, ownerId)).limit(1);
    return { publicKey: env.VAPID_PUBLIC_KEY && env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY ? env.VAPID_PUBLIC_KEY : null, subscribed: Boolean(subscription) };
  });

  app.post('/notifications/web', async (request) => {
    const ownerId = requireOwner(request);
    if (!env.VAPID_PUBLIC_KEY || !env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY) throw bad('Web push is not configured.', 503);
    const parsed = z.object({ endpoint: z.string().url().max(2048), expirationTime: z.number().nullable().optional(), keys: z.object({ p256dh: z.string().min(20).max(256), auth: z.string().min(10).max(128) }) }).safeParse(request.body);
    if (!parsed.success) throw bad(parsed.error.issues[0]?.message ?? 'Invalid browser push subscription.');
    const endpoint = new URL(parsed.data.endpoint);
    const approvedHost = endpoint.protocol === 'https:' && (
      endpoint.hostname === 'fcm.googleapis.com' || endpoint.hostname.endsWith('.push.apple.com') ||
      endpoint.hostname.endsWith('.push.services.mozilla.com') || endpoint.hostname.endsWith('.notify.windows.com')
    );
    if (!approvedHost || endpoint.port || endpoint.username || endpoint.password) throw bad('Unsupported browser push endpoint.');
    const subscription = { endpoint: endpoint.toString(), expirationTime: parsed.data.expirationTime ?? null, keys: parsed.data.keys };
    const hash = endpointHash(subscription.endpoint);
    const encryptedSubscription = encryptSubscription(subscription);
    await db.insert(webPushSubscriptions).values({ ownerId, endpointHash: hash, encryptedSubscription, updatedAt: new Date() })
      .onConflictDoUpdate({ target: webPushSubscriptions.endpointHash, set: { ownerId, encryptedSubscription, updatedAt: new Date() } });
    await refreshPushEnabled(ownerId);
    return { subscribed: true };
  });

  app.delete('/notifications/web', async (request, reply) => {
    const ownerId = requireOwner(request);
    const parsed = z.object({ endpoint: z.string().url().max(2048) }).safeParse(request.body);
    if (!parsed.success) throw bad('Provide the browser push endpoint to remove.');
    await db.delete(webPushSubscriptions).where(and(eq(webPushSubscriptions.ownerId, ownerId), eq(webPushSubscriptions.endpointHash, endpointHash(parsed.data.endpoint))));
    await refreshPushEnabled(ownerId);
    return reply.code(204).send();
  });

  app.get('/suggestion-feedback', async (request) => {
    const ownerId = requireOwner(request);
    const rows = await db.select({
      clientId: intentions.clientId, state: suggestions.state, snoozedUntil: suggestions.snoozedUntil,
    }).from(suggestions).innerJoin(intentions, eq(suggestions.intentionId, intentions.id)).where(and(
      eq(suggestions.ownerId, ownerId), eq(intentions.ownerId, ownerId), eq(suggestions.type, 'intention_nudge'),
      inArray(suggestions.state, ['open', 'accepted', 'dismissed', 'snoozed']), isNull(intentions.deletedAt),
    ));
    return { feedback: rows.map((row) => ({ ...row, snoozedUntil: iso(row.snoozedUntil) })) };
  });

  app.put('/suggestion-feedback', async (request) => {
    const ownerId = requireOwner(request);
    const parsed = z.object({ feedback: z.array(z.object({
      clientId: z.string().uuid(), state: z.enum(['open', 'accepted', 'dismissed', 'snoozed']),
      snoozedUntil: z.string().datetime({ offset: true }).nullable().optional(),
    }).superRefine((item, ctx) => {
      if (item.state === 'snoozed') {
        if (!item.snoozedUntil) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Snoozed feedback needs an expiry date.' });
      } else if (item.snoozedUntil) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only snoozed feedback can include a snooze date.' });
    })).max(500) }).safeParse(request.body);
    if (!parsed.success) throw bad(parsed.error.issues[0]?.message ?? 'Invalid suggestion feedback.');
    const clientIds = [...new Set(parsed.data.feedback.map((item) => item.clientId))];
    const owned = clientIds.length ? await db.select({ id: intentions.id, clientId: intentions.clientId }).from(intentions).where(and(
      eq(intentions.ownerId, ownerId), inArray(intentions.clientId, clientIds), isNull(intentions.deletedAt),
    )) : [];
    const intentionIds = new Map(owned.map((row) => [row.clientId, row.id]));
    const saved: Array<{ clientId: string; state: string; snoozedUntil: string | null }> = [];
    for (const item of parsed.data.feedback) {
      const intentionId = intentionIds.get(item.clientId);
      if (!intentionId) continue;
      const expiredSnooze = item.state === 'snoozed' && Date.parse(item.snoozedUntil!) <= Date.now();
      const state = expiredSnooze ? 'open' : item.state;
      const snoozedUntil = state === 'snoozed' ? new Date(item.snoozedUntil!) : null;
      const snoozedUntilIso = snoozedUntil?.toISOString() ?? null;
      await db.insert(suggestions).values({
        ownerId, intentionId, type: 'intention_nudge', rationale: 'User feedback for an intention suggestion.',
        payload: { source: 'suggestion_tray' }, state, snoozedUntil,
      }).onConflictDoUpdate({
        target: [suggestions.ownerId, suggestions.intentionId, suggestions.type],
        set: {
          state, snoozedUntil, updatedAt: new Date(),
          // Raw sql fragments bypass Drizzle's column-aware Date serialization, so the
          // timestamptz comparison needs an explicit ISO string, not a Date object (a bare
          // Date here stringifies via Date#toString(), which Postgres can't parse).
          reminderClaimedAt: state === 'snoozed'
            ? sql`CASE WHEN ${suggestions.state} = 'snoozed' AND ${suggestions.snoozedUntil} = ${snoozedUntilIso} THEN ${suggestions.reminderClaimedAt} ELSE NULL END`
            : null,
          reminderClaimKey: state === 'snoozed'
            ? sql`CASE WHEN ${suggestions.state} = 'snoozed' AND ${suggestions.snoozedUntil} = ${snoozedUntilIso} THEN ${suggestions.reminderClaimKey} ELSE NULL END`
            : null,
          reminderHandledAt: state === 'snoozed'
            ? sql`CASE WHEN ${suggestions.state} = 'snoozed' AND ${suggestions.snoozedUntil} = ${snoozedUntilIso} THEN ${suggestions.reminderHandledAt} ELSE NULL END`
            : null,
        },
      });
      if (state === 'snoozed' && snoozedUntil) {
        const [preference] = await db.select({ enabled: pushPreferences.enabled }).from(pushPreferences)
          .where(eq(pushPreferences.ownerId, ownerId)).limit(1);
        if (preference?.enabled) {
          const queued = await enqueueSnoozeReminder({ intentionId, ownerId, snoozedUntil: snoozedUntil.toISOString() });
          if (!queued) throw bad('The snooze is saved, but its reminder could not be scheduled yet. Veylo will retry when the queue is available.', 503);
        }
      }
      saved.push({ clientId: item.clientId, state, snoozedUntil: snoozedUntil?.toISOString() ?? null });
    }
    return { feedback: saved };
  });

  app.get('/account/export', async (request) => {
    const ownerId = requireOwner(request);
    const [intentionRows, revisionRows, blockRows, relationshipRows, suggestionRows, preferenceRows, connectionRows, conversationRows, alignmentRows] = await Promise.all([
      db.select().from(intentions).where(eq(intentions.ownerId, ownerId)),
      db.select().from(intentionRevisions).where(eq(intentionRevisions.ownerId, ownerId)),
      db.select().from(timeBlocks).where(eq(timeBlocks.ownerId, ownerId)),
      db.select().from(intentionRelationships).where(eq(intentionRelationships.ownerId, ownerId)),
      db.select().from(suggestions).where(eq(suggestions.ownerId, ownerId)),
      db.select().from(pushPreferences).where(eq(pushPreferences.ownerId, ownerId)),
      db.select().from(integrations).where(eq(integrations.ownerId, ownerId)),
      db.select({ id: brainstormMessages.id, intentionId: brainstormMessages.intentionId, clientRequestId: brainstormMessages.clientRequestId,
        parentMessageId: brainstormMessages.parentMessageId, role: brainstormMessages.role, status: brainstormMessages.status,
        content: brainstormMessages.content, createdAt: brainstormMessages.createdAt, updatedAt: brainstormMessages.updatedAt,
      }).from(brainstormMessages).where(eq(brainstormMessages.ownerId, ownerId)),
      db.select().from(alignmentAnchors).where(eq(alignmentAnchors.ownerId, ownerId)),
    ]);
    const connections = connectionRows.map(shapeAccountExportConnection);
    return { exportedAt: new Date().toISOString(), intentions: intentionRows, intentionHistory: revisionRows, timeBlocks: blockRows, relationships: relationshipRows, suggestions: suggestionRows, preferences: preferenceRows, connections, brainstormMessages: conversationRows, alignments: alignmentRows };
  });

  app.delete('/intentions', async (request, reply) => {
    const ownerId = requireOwner(request);
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.select({ id: intentions.id }).from(intentions).where(eq(intentions.ownerId, ownerId))
        .orderBy(asc(intentions.id)).for('update');
      await tx.delete(intentionRevisions).where(eq(intentionRevisions.ownerId, ownerId));
      await tx.update(intentions).set({
        originalVersions: [], rawCapture: 'Deleted intention', title: 'Deleted intention', kind: 'unclassified',
        intent: null, purpose: null, desiredOutcome: null, roughPlan: null, horizon: null,
        effortEstimate: null, energyContext: null, aiMetadata: {}, status: 'archived', deletedAt: now,
        createdAt: now, updatedAt: now, version: sql`${intentions.version} + 1`,
      })
        .where(and(eq(intentions.ownerId, ownerId), isNull(intentions.deletedAt)));
      await tx.update(timeBlocks).set({
        startsAt: now, endsAt: new Date(now.getTime() + 1_000), timezone: 'UTC',
        externalProvider: null, externalEventId: null, externalUrl: null, syncState: 'local', deletedAt: now, createdAt: now, updatedAt: now,
      }).where(eq(timeBlocks.ownerId, ownerId));
      await tx.update(alignmentAnchors).set({ intentionIds: [], version: sql`${alignmentAnchors.version} + 1`, updatedAt: now }).where(eq(alignmentAnchors.ownerId, ownerId));
      await tx.delete(intentionRelationships).where(eq(intentionRelationships.ownerId, ownerId));
      await tx.delete(suggestions).where(eq(suggestions.ownerId, ownerId));
      await tx.delete(brainstormMessages).where(eq(brainstormMessages.ownerId, ownerId));
    });
    return reply.code(204).send();
  });

  app.get('/intentions', async (request) => {
    const ownerId = requireOwner(request);
    const rows = await db.select().from(intentions)
      .where(and(eq(intentions.ownerId, ownerId), isNull(intentions.deletedAt)))
      .orderBy(desc(intentions.updatedAt));
    return { intentions: rows.map(shapeIntention) };
  });

  app.get('/sync', async (request) => {
    const ownerId = requireOwner(request);
    const query = request.query as { since?: string };
    const since = query.since ? new Date(query.since) : new Date(0);
    if (Number.isNaN(since.getTime())) throw bad('since must be an ISO timestamp');
    // Pin the cursor before either query and re-read the last minute. Besides
    // equal-timestamp updates, the overlap catches a short transaction that
    // started before this pull but committed after its query snapshot.
    const serverTime = new Date();
    const querySince = new Date(Math.max(0, since.getTime() - SYNC_CURSOR_OVERLAP_MS));
    const rows = await db.select().from(intentions)
      .where(and(eq(intentions.ownerId, ownerId), gte(intentions.updatedAt, querySince)))
      .orderBy(intentions.updatedAt);
    const blocks = await db.select({ block: timeBlocks, intentionClientId: intentions.clientId }).from(timeBlocks)
      .innerJoin(intentions, eq(timeBlocks.intentionId, intentions.id))
      .where(and(eq(timeBlocks.ownerId, ownerId), gte(timeBlocks.updatedAt, querySince)));
    return {
      serverTime: serverTime.toISOString(),
      intentions: rows.map((row) => ({ ...shapeIntention(row), deletedAt: iso(row.deletedAt) })),
      timeBlocks: blocks.map(({ block, intentionClientId }) => ({
        id: block.id, clientId: block.clientId, intentionClientId, startsAt: block.startsAt.toISOString(),
        endsAt: block.endsAt.toISOString(), timezone: block.timezone, syncState: block.syncState,
        externalProvider: block.externalProvider, externalEventId: block.externalEventId,
        externalUrl: block.externalUrl, deletedAt: iso(block.deletedAt), updatedAt: block.updatedAt.toISOString(),
      })),
    };
  });

  app.post('/sync/blocks', async (request) => {
    const ownerId = requireOwner(request);
    const schema = z.object({ blocks: z.array(z.object({
      clientId: z.string().uuid(), intentionClientId: z.string().uuid(),
      startsAt: z.string().datetime(), endsAt: z.string().datetime(), timezone: timeZoneSchema,
      externalProvider: z.string().max(32).nullable().optional(), externalEventId: z.string().max(255).nullable().optional(),
      externalUrl: z.string().url().nullable().optional(), syncState: z.enum(['local','pending','synced','error']).default('local'),
      deleted: z.boolean().optional(),
    })).max(500) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) throw bad(parsed.error.issues[0]?.message ?? 'Invalid time block sync payload');
    const saved: Array<{ clientId: string; remoteId: string }> = [];
    for (const block of parsed.data.blocks) {
      if (Date.parse(block.endsAt) <= Date.parse(block.startsAt)) throw bad('endsAt must be after startsAt');
      const now = new Date();
      const synced = await db.transaction(async (tx) => {
        const [parent] = await tx.select({ id: intentions.id }).from(intentions).where(and(
          eq(intentions.ownerId, ownerId), eq(intentions.clientId, block.intentionClientId), isNull(intentions.deletedAt), ne(intentions.status, 'archived'),
        )).limit(1).for('update');
        if (!parent) return null;
        const values = {
          ownerId, intentionId: parent.id, clientId: block.clientId,
          startsAt: new Date(block.startsAt), endsAt: new Date(block.endsAt), timezone: block.timezone,
          externalProvider: block.externalProvider ?? null, externalEventId: block.externalEventId ?? null,
          externalUrl: block.externalUrl ?? null, syncState: block.syncState,
          deletedAt: block.deleted ? now : null, updatedAt: now,
        };
        const [existing] = await tx.select().from(timeBlocks).where(and(
          eq(timeBlocks.ownerId, ownerId), eq(timeBlocks.clientId, block.clientId),
        )).limit(1);
        if (existing && existing.intentionId !== parent.id) throw bad('This time block ID already belongs to another intention.', 409);
        if (existing && existing.startsAt.getTime() === values.startsAt.getTime() && existing.endsAt.getTime() === values.endsAt.getTime()
          && existing.timezone === values.timezone && existing.externalProvider === values.externalProvider
          && existing.externalEventId === values.externalEventId && existing.externalUrl === values.externalUrl
          && existing.syncState === values.syncState && Boolean(existing.deletedAt) === Boolean(values.deletedAt)) {
          return { clientId: existing.clientId, remoteId: existing.id };
        }
        const [row] = await tx.insert(timeBlocks).values(values).onConflictDoUpdate({
          target: [timeBlocks.ownerId, timeBlocks.clientId],
          set: { ...values, deletedAt: sql`COALESCE(${timeBlocks.deletedAt}, EXCLUDED.deleted_at)` },
          setWhere: eq(timeBlocks.intentionId, parent.id),
        }).returning({ id: timeBlocks.id, clientId: timeBlocks.clientId });
        if (row) return { clientId: row.clientId, remoteId: row.id };
        const [raced] = await tx.select({ id: timeBlocks.id, clientId: timeBlocks.clientId, intentionId: timeBlocks.intentionId })
          .from(timeBlocks).where(and(eq(timeBlocks.ownerId, ownerId), eq(timeBlocks.clientId, block.clientId))).limit(1);
        if (raced && raced.intentionId !== parent.id) throw bad('This time block ID already belongs to another intention.', 409);
        return raced ? { clientId: raced.clientId, remoteId: raced.id } : null;
      });
      if (synced) saved.push(synced);
    }
    return { saved, serverTime: new Date().toISOString() };
  });

  app.post('/sync/push', async (request, reply) => {
    const ownerId = requireOwner(request);
    const schema = z.object({
      intentions: z.array(z.object({
        clientId: z.string().uuid(), capturedAt: z.string().datetime().optional(), rawCapture: z.string().min(1).max(rawCaptureMaxLength).refine((value) => value.trim().length > 0, 'Capture cannot be blank.'),
        title: z.string().min(1).max(160), kind: z.enum(['idea', 'action', 'commitment', 'question', 'goal', 'meeting', 'note', 'unclassified']),
        intent: z.string().max(4000).nullable().optional(), purpose: z.string().max(4000).nullable().optional(),
        desiredOutcome: z.string().max(4000).nullable().optional(), roughPlan: z.string().max(8000).nullable().optional(),
        horizon: z.enum(intentionHorizons).nullable().optional(),
        effortEstimate: z.number().int().min(0).max(10080).nullable().optional(),
        energyContext: z.string().max(120).nullable().optional(),
        status: z.enum(['captured', 'exploring', 'ready', 'planned', 'active', 'completed', 'archived']),
        expectedVersion: z.number().int().positive().nullable().optional(), deleted: z.boolean().optional(),
      })).max(500),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) throw bad(parsed.error.issues[0]?.message ?? 'Invalid sync payload');
    const saved: Array<{ clientId: string; remoteId: string; version: number }> = [];
    const conflicts: Array<{ clientId: string; current: ReturnType<typeof shapeIntention> & { deletedAt: string | null } }> = [];
    const shapeConflict = (row: typeof intentions.$inferSelect) => ({ ...shapeIntention(row), deletedAt: iso(row.deletedAt) });
    for (const item of parsed.data.intentions) {
      const [current] = await db.select().from(intentions).where(and(
        eq(intentions.ownerId, ownerId), eq(intentions.clientId, item.clientId),
      )).limit(1);
      if (current) {
        if (current.deletedAt) {
          conflicts.push({ clientId: item.clientId, current: shapeConflict(current) });
          continue;
        }
        if (item.expectedVersion !== current.version) {
          const aiMetadata = current.aiMetadata as Record<string, unknown>;
          const sameSnapshot = current.rawCapture === item.rawCapture && current.title === item.title && current.kind === item.kind
            && current.intent === (item.intent ?? null) && current.purpose === (item.purpose ?? null)
            && current.desiredOutcome === (item.desiredOutcome ?? null) && current.roughPlan === (item.roughPlan ?? null)
            && current.horizon === (item.horizon ?? null) && current.effortEstimate === (item.effortEstimate ?? null)
            && current.energyContext === (item.energyContext ?? null) && current.status === item.status
            && Boolean(current.deletedAt) === Boolean(item.deleted);
          const unchangedExceptForAi = ['captured', 'exploring'].includes(current.status) && current.rawCapture === item.rawCapture
            && matchesAIOnlyChange(aiMetadata,
              { title: item.title, kind: item.kind, horizon: item.horizon ?? null },
              { title: current.title, kind: current.kind, horizon: current.horizon })
            && current.intent === (item.intent ?? null) && current.purpose === (item.purpose ?? null)
            && current.desiredOutcome === (item.desiredOutcome ?? null) && current.roughPlan === (item.roughPlan ?? null)
            && current.effortEstimate === (item.effortEstimate ?? null)
            && current.energyContext === (item.energyContext ?? null) && current.status === item.status
            && !item.deleted;
          if (sameSnapshot || unchangedExceptForAi) {
            saved.push({ clientId: current.clientId, remoteId: current.id, version: current.version });
            continue;
          }
          conflicts.push({ clientId: item.clientId, current: shapeConflict(current) });
          continue;
        }
        const unchanged = current.rawCapture === item.rawCapture && current.title === item.title && current.kind === item.kind
          && current.intent === (item.intent ?? null) && current.purpose === (item.purpose ?? null)
          && current.desiredOutcome === (item.desiredOutcome ?? null) && current.roughPlan === (item.roughPlan ?? null)
          && current.horizon === (item.horizon ?? null) && current.effortEstimate === (item.effortEstimate ?? null)
          && current.energyContext === (item.energyContext ?? null) && current.status === item.status
          && Boolean(current.deletedAt) === Boolean(item.deleted);
        if (unchanged) {
          saved.push({ clientId: current.clientId, remoteId: current.id, version: current.version });
          if (await aiEnabled(ownerId) && !current.aiMetadata.processedAt && ['captured', 'exploring'].includes(current.status)) {
            void enqueueInterpretation({ intentionId: current.id, ownerId, expectedVersion: current.version });
          }
          continue;
        }
        const now = new Date();
        const [updated] = await db.update(intentions).set({
          rawCapture: item.rawCapture, title: item.title, kind: item.kind,
          intent: item.intent ?? null, purpose: item.purpose ?? null,
          desiredOutcome: item.desiredOutcome ?? null, roughPlan: item.roughPlan ?? null,
          horizon: item.horizon ?? null, effortEstimate: item.effortEstimate ?? null,
          energyContext: item.energyContext ?? null, status: item.status,
          deletedAt: item.deleted ? now : null, updatedAt: now, version: current.version + 1,
        }).where(and(eq(intentions.id, current.id), eq(intentions.ownerId, ownerId), eq(intentions.version, current.version))).returning();
        if (updated) saved.push({ clientId: updated.clientId, remoteId: updated.id, version: updated.version });
        else {
          const [latest] = await db.select().from(intentions).where(and(eq(intentions.id, current.id), eq(intentions.ownerId, ownerId))).limit(1);
          if (latest) conflicts.push({ clientId: item.clientId, current: shapeConflict(latest) });
        }
      } else if (!item.deleted) {
        const now = new Date();
        const [created] = await db.insert(intentions).values({
          ownerId, clientId: item.clientId, rawCapture: item.rawCapture, title: item.title,
          kind: item.kind, intent: item.intent ?? null, purpose: item.purpose ?? null,
          desiredOutcome: item.desiredOutcome ?? null, roughPlan: item.roughPlan ?? null,
          horizon: item.horizon ?? null, effortEstimate: item.effortEstimate ?? null,
          energyContext: item.energyContext ?? null, status: item.status,
          createdAt: item.capturedAt ? new Date(item.capturedAt) : now, updatedAt: now,
        }).onConflictDoNothing({ target: [intentions.ownerId, intentions.clientId] }).returning();
        if (created) saved.push({ clientId: created.clientId, remoteId: created.id, version: created.version });
        else {
          const [raced] = await db.select().from(intentions).where(and(eq(intentions.ownerId, ownerId), eq(intentions.clientId, item.clientId))).limit(1);
          if (raced) conflicts.push({ clientId: item.clientId, current: shapeConflict(raced) });
        }
      }
      const [persisted] = await db.select({ id: intentions.id, version: intentions.version, status: intentions.status, aiMetadata: intentions.aiMetadata }).from(intentions)
        .where(and(eq(intentions.ownerId, ownerId), eq(intentions.clientId, item.clientId))).limit(1);
      if (persisted && await aiEnabled(ownerId) && persisted.status !== 'archived') {
        void enqueueInterpretation({ intentionId: persisted.id, ownerId, expectedVersion: persisted.version, evaluateOnly: Boolean(persisted.aiMetadata.processedAt) || !['captured', 'exploring'].includes(persisted.status) });
      }
    }
    return reply.send({ saved, conflicts, serverTime: new Date().toISOString() });
  });

  app.post('/captures', async (request, reply) => {
    const ownerId = requireOwner(request);
    const parsed = captureInputSchema.safeParse(request.body);
    if (!parsed.success) throw bad(parsed.error.issues[0]?.message ?? 'Invalid capture');
    const { rawCapture, clientId } = parsed.data;
    const now = new Date();
    const [row] = await db.insert(intentions).values({
      ownerId, clientId, rawCapture, title: titleFrom(rawCapture), kind: kindFrom(rawCapture),
      status: 'captured', createdAt: now, updatedAt: now,
    }).onConflictDoNothing({ target: [intentions.ownerId, intentions.clientId] }).returning();
    const saved = row ?? (await db.select().from(intentions).where(and(
      eq(intentions.ownerId, ownerId), eq(intentions.clientId, clientId),
    )))[0];
    if (!saved) throw new Error('Capture could not be read after save');
    if (saved.deletedAt) {
      return reply.code(409).send({ error: 'intention_deleted', message: 'This capture was deleted on another device.' });
    }
    if (await aiEnabled(ownerId) && !saved.aiMetadata.processedAt) void enqueueInterpretation({ intentionId: saved.id, ownerId, expectedVersion: saved.version });
    return reply.code(row ? 201 : 200).send({ intention: shapeIntention(saved), interpretation: 'local_rules' });
  });

  app.get('/intentions/:id', async (request, reply) => {
    const ownerId = requireOwner(request);
    const { id } = request.params as { id: string };
    const [row] = await db.select().from(intentions).where(and(
      eq(intentions.id, id), eq(intentions.ownerId, ownerId), isNull(intentions.deletedAt),
    )).limit(1);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const [blocks, relationships] = await Promise.all([
      db.select().from(timeBlocks).where(and(eq(timeBlocks.intentionId, row.id), eq(timeBlocks.ownerId, ownerId))),
      db.select().from(intentionRelationships).where(and(eq(intentionRelationships.ownerId, ownerId), eq(intentionRelationships.fromId, row.id))),
    ]);
    return { intention: shapeIntention(row), timeBlocks: blocks, relationships };
  });

  app.post('/intentions/:id/pieces', async (request, reply) => {
    const ownerId = requireOwner(request);
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const parsed = originalPieceInputSchema.safeParse(request.body);
    if (!params.success || !parsed.success) throw bad('Provide a valid thought and a nonblank piece of up to 8,000 characters.');
    const result = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(intentions).where(and(eq(intentions.id, params.data.id), eq(intentions.ownerId, ownerId), isNull(intentions.deletedAt))).for('update');
      if (!row) return null;
      if (row.status === 'archived') throw bad('Restore this thought before adding a piece.', 409);
      const current = row.originalVersions.length ? row.originalVersions : initialOriginalVersions(row.clientId, row.rawCapture, row.createdAt.toISOString(), row.createdAt.toISOString());
      let next;
      try { next = appendOriginalPiece(current, parsed.data, new Date().toISOString()); }
      catch (error) { throw bad(error instanceof Error ? error.message : 'Could not add this piece.', 409); }
      if (next === current) return { row, created: false };
      const [updated] = await tx.update(intentions).set({ originalVersions: next, version: row.version + 1, updatedAt: new Date() }).where(eq(intentions.id, row.id)).returning();
      return { row: updated!, created: true };
    });
    if (!result) return reply.code(404).send({ error: 'not_found' });
    if (result.created && await aiEnabled(ownerId)) void enqueueInterpretation({ intentionId: result.row.id, ownerId, expectedVersion: result.row.version, evaluateOnly: true });
    return reply.code(result.created ? 201 : 200).send({ intention: shapeIntention(result.row) });
  });

  app.get('/intentions/:id/history', async (request, reply) => {
    const ownerId = requireOwner(request);
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'not_found' });
    const [row] = await db.select({ id: intentions.id }).from(intentions).where(and(
      eq(intentions.id, params.data.id), eq(intentions.ownerId, ownerId), isNull(intentions.deletedAt),
    )).limit(1);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const revisions = await db.select({ id: intentionRevisions.id, version: intentionRevisions.version,
      action: intentionRevisions.action, details: intentionRevisions.details, changedFields: intentionRevisions.changedFields, createdAt: intentionRevisions.createdAt,
    }).from(intentionRevisions).where(and(
      eq(intentionRevisions.ownerId, ownerId), eq(intentionRevisions.intentionId, row.id),
    )).orderBy(desc(intentionRevisions.createdAt), desc(intentionRevisions.version)).limit(200);
    return { history: revisions.map((revision) => ({ ...revision, createdAt: revision.createdAt.toISOString() })) };
  });

  app.get('/intentions/:id/brainstorm', async (request, reply) => {
    const ownerId = requireOwner(request);
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'not_found' });
    const [row] = await db.select({ id: intentions.id }).from(intentions).where(and(
      eq(intentions.id, params.data.id), eq(intentions.ownerId, ownerId), isNull(intentions.deletedAt),
    )).limit(1);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const messages = await db.select({ id: brainstormMessages.id, clientRequestId: brainstormMessages.clientRequestId,
      parentMessageId: brainstormMessages.parentMessageId, role: brainstormMessages.role,
      status: brainstormMessages.status, content: brainstormMessages.content, createdAt: brainstormMessages.createdAt,
    }).from(brainstormMessages).where(and(
      eq(brainstormMessages.ownerId, ownerId), eq(brainstormMessages.intentionId, row.id),
    )).orderBy(desc(brainstormMessages.createdAt)).limit(40);
    return { messages: messages.reverse().map((message) => ({ ...message, createdAt: message.createdAt.toISOString() })) };
  });

  app.post('/intentions/:id/brainstorm', { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const ownerId = requireOwner(request);
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const input = z.object({ clientRequestId: z.string().uuid(), message: z.string().trim().min(1).max(2000) }).strict().safeParse(request.body);
    if (!params.success) return reply.code(404).send({ error: 'not_found' });
    if (!input.success) throw bad(input.error.issues[0]?.message ?? 'Invalid brainstorming message.');
    if (!await aiEnabled(ownerId)) throw bad('Enable AI interpretation in preferences before brainstorming.', 403);
    const [row] = await db.select({ id: intentions.id, status: intentions.status }).from(intentions).where(and(
      eq(intentions.id, params.data.id), eq(intentions.ownerId, ownerId), isNull(intentions.deletedAt),
    )).limit(1);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    if (row.status === 'archived') throw bad('Restore this thought before starting a new brainstorm.', 409);

    const now = new Date();
    const assistant = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ownerId}), hashtext(${row.id}))`);
      const [current] = await tx.select({ id: intentions.id, status: intentions.status }).from(intentions).where(and(
        eq(intentions.id, row.id), eq(intentions.ownerId, ownerId), isNull(intentions.deletedAt),
      )).limit(1).for('update');
      if (!current) throw bad('not_found', 404);
      if (current.status === 'archived') throw bad('Restore this thought before starting a new brainstorm.', 409);
      const [insertedUser] = await tx.insert(brainstormMessages).values({
        ownerId, intentionId: row.id, clientRequestId: input.data.clientRequestId,
        role: 'user', status: 'complete', content: input.data.message, createdAt: now, updatedAt: now,
      }).onConflictDoNothing().returning();
      const [userMessage] = insertedUser ? [insertedUser] : await tx.select().from(brainstormMessages).where(and(
        eq(brainstormMessages.ownerId, ownerId), eq(brainstormMessages.clientRequestId, input.data.clientRequestId),
        eq(brainstormMessages.role, 'user'),
      )).limit(1);
      if (!userMessage || userMessage.intentionId !== row.id || userMessage.content !== input.data.message) {
        throw bad('This request ID was already used for a different message.', 409);
      }
      if (insertedUser) {
        const [pending] = await tx.select({ id: brainstormMessages.id }).from(brainstormMessages).where(and(
          eq(brainstormMessages.ownerId, ownerId), eq(brainstormMessages.intentionId, row.id),
          eq(brainstormMessages.role, 'assistant'), eq(brainstormMessages.status, 'pending'),
        )).limit(1);
        if (pending) throw bad('Wait for the current reply before sending another message.', 409);
      }
      const [insertedAssistant] = await tx.insert(brainstormMessages).values({
        ownerId, intentionId: row.id, clientRequestId: input.data.clientRequestId,
        parentMessageId: userMessage.id, role: 'assistant', status: 'pending', content: '',
        createdAt: new Date(now.getTime() + 1), updatedAt: now,
      }).onConflictDoNothing().returning();
      if (insertedAssistant) return insertedAssistant;
      const [existing] = await tx.select().from(brainstormMessages).where(and(
        eq(brainstormMessages.ownerId, ownerId), eq(brainstormMessages.clientRequestId, input.data.clientRequestId),
        eq(brainstormMessages.role, 'assistant'),
      )).limit(1);
      if (!existing || existing.intentionId !== row.id || existing.parentMessageId !== userMessage.id) {
        throw bad('This brainstorming request could not be recovered.', 409);
      }
      if (existing.status === 'complete') return existing;
      if (existing.status === 'pending') return existing;
      const [otherPending] = await tx.select({ id: brainstormMessages.id }).from(brainstormMessages).where(and(
        eq(brainstormMessages.ownerId, ownerId), eq(brainstormMessages.intentionId, row.id),
        eq(brainstormMessages.role, 'assistant'), eq(brainstormMessages.status, 'pending'), ne(brainstormMessages.id, existing.id),
      )).limit(1);
      if (otherPending) throw bad('Wait for the current reply before retrying this message.', 409);
      const [retry] = await tx.update(brainstormMessages).set({ status: 'pending', content: '', updatedAt: now }).where(and(
        eq(brainstormMessages.id, existing.id), eq(brainstormMessages.ownerId, ownerId),
      )).returning();
      return retry!;
    });
    if (assistant.status === 'complete') return reply.code(200).send({ message: assistant, queued: false });
    const queued = await enqueueBrainstormReply({
      intentionId: row.id, ownerId, userMessageId: assistant.parentMessageId!, assistantMessageId: assistant.id,
      attemptKey: String(assistant.updatedAt.getTime()),
    });
    if (!queued) {
      await db.update(brainstormMessages).set({ status: 'failed', updatedAt: new Date() }).where(and(
        eq(brainstormMessages.id, assistant.id), eq(brainstormMessages.ownerId, ownerId), eq(brainstormMessages.status, 'pending'),
      ));
      return reply.code(503).send({ error: 'brainstorm_unavailable', message: 'Your message was saved, but the assistant is unavailable. Retry to continue.', messageId: assistant.id });
    }
    return reply.code(202).send({ message: assistant, queued: true });
  });

  app.post('/intentions/:id/evaluate', async (request, reply) => {
    const ownerId = requireOwner(request);
    const { id } = request.params as { id: string };
    if (!z.string().uuid().safeParse(id).success) throw bad('Provide a valid thought ID');
    const [row] = await db.select().from(intentions).where(and(eq(intentions.id, id), eq(intentions.ownerId, ownerId), isNull(intentions.deletedAt))).limit(1);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    if (row.status === 'archived') throw bad('Restore this thought before evaluating it.', 409);
    if (!await aiEnabled(ownerId)) throw bad('Enable AI-assisted features in Preferences first.', 403);
    const queued = await enqueueInterpretation({ intentionId: id, ownerId, expectedVersion: row.version, evaluateOnly: Boolean(row.aiMetadata.processedAt) || !['captured', 'exploring'].includes(row.status) });
    return reply.code(queued ? 202 : 503).send({ queued, message: queued ? 'Evaluation queued' : 'Evaluation is unavailable. Try again shortly.' });
  });

  app.post('/intentions/:id/interpret', async (request, reply) => {
    const ownerId = requireOwner(request);
    const { id } = request.params as { id: string };
    const [row] = await db.select().from(intentions).where(and(
      eq(intentions.id, id), eq(intentions.ownerId, ownerId), isNull(intentions.deletedAt),
    )).limit(1);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    if (!['captured', 'exploring'].includes(row.status)) return reply.code(409).send({ error: 'interpretation_not_available', message: 'Interpretation is available while an intention is captured or being explored.' });
    if (!await aiEnabled(ownerId)) return reply.code(403).send({ error: 'ai_not_enabled', message: 'Enable AI interpretation in preferences first.' });
    const queued = await enqueueInterpretation({ intentionId: id, ownerId, expectedVersion: row.version });
    return reply.code(queued ? 202 : 503).send({ queued, message: queued ? 'Interpretation queued' : 'Background processing is unavailable. Try again shortly.' });
  });

  app.post('/intentions/:id/interpretation/undo', async (request, reply) => {
    const ownerId = requireOwner(request);
    const { id } = request.params as { id: string };
    const parsed = z.object({ expectedVersion: z.number().int().positive() }).safeParse(request.body);
    if (!parsed.success) throw bad(parsed.error.issues[0]?.message ?? 'Invalid undo request');
    const [row] = await db.select().from(intentions).where(and(
      eq(intentions.id, id), eq(intentions.ownerId, ownerId), isNull(intentions.deletedAt),
    )).limit(1);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    if (row.version !== parsed.data.expectedVersion) return reply.code(409).send({ error: 'version_conflict', intention: shapeIntention(row) });
    const metadata = row.aiMetadata as Record<string, unknown>;
    const undo = getAIInterpretationUndo(metadata, { title: row.title, kind: row.kind, horizon: row.horizon });
    if (!undo) {
      return reply.code(409).send({ error: 'undo_unavailable', message: 'This AI suggestion has already changed or was already undone.' });
    }
    const undoneAt = new Date();
    const [updated] = await db.update(intentions).set({
      title: undo.previous.title, kind: undo.previous.kind, horizon: undo.previous.horizon, aiMetadata: { ...metadata, undoneAt: undoneAt.toISOString() },
      updatedAt: undoneAt, version: row.version + 1,
    }).where(and(
      eq(intentions.id, row.id), eq(intentions.ownerId, ownerId), eq(intentions.version, row.version),
      eq(intentions.title, undo.applied.title), eq(intentions.kind, undo.applied.kind),
      ...(undo.tracksHorizon ? [undo.applied.horizon === null ? isNull(intentions.horizon) : eq(intentions.horizon, undo.applied.horizon)] : []),
      isNull(intentions.deletedAt),
    )).returning();
    if (!updated) {
      const [current] = await db.select().from(intentions).where(and(eq(intentions.id, row.id), eq(intentions.ownerId, ownerId))).limit(1);
      return reply.code(409).send({ error: 'version_conflict', ...(current ? { intention: shapeIntention(current) } : {}) });
    }
    return { intention: shapeIntention(updated) };
  });

  app.patch('/intentions/:id', async (request, reply) => {
    const ownerId = requireOwner(request);
    const { id } = request.params as { id: string };
    const parsed = intentionPatchSchema.safeParse(request.body);
    if (!parsed.success) throw bad(parsed.error.issues[0]?.message ?? 'Invalid intention update');
    const { expectedVersion, ...changes } = parsed.data;
    const [updated] = await db.update(intentions).set({
      ...changes, updatedAt: new Date(), version: expectedVersion + 1,
    }).where(and(
      eq(intentions.id, id), eq(intentions.ownerId, ownerId), eq(intentions.version, expectedVersion), isNull(intentions.deletedAt),
    )).returning();
    if (updated) {
      if (updated.status !== 'archived' && await aiEnabled(ownerId)) void enqueueInterpretation({ intentionId: updated.id, ownerId, expectedVersion: updated.version, evaluateOnly: true });
      return { intention: shapeIntention(updated) };
    }
    const [current] = await db.select().from(intentions).where(and(eq(intentions.id, id), eq(intentions.ownerId, ownerId))).limit(1);
    if (!current || current.deletedAt) return reply.code(404).send({ error: 'not_found' });
    return reply.code(409).send({ error: 'version_conflict', intention: shapeIntention(current) });
  });

  app.delete('/intentions/:id', async (request, reply) => {
    const ownerId = requireOwner(request);
    const { id } = request.params as { id: string };
    if (!z.string().uuid().safeParse(id).success) throw bad('Provide a valid intention ID');
    const now = new Date();
    const deleted = await db.transaction(async (tx) => {
      await tx.delete(intentionRevisions).where(and(eq(intentionRevisions.ownerId, ownerId), eq(intentionRevisions.intentionId, id)));
      const [row] = await tx.update(intentions).set({
        originalVersions: [], rawCapture: 'Deleted intention', title: 'Deleted intention', kind: 'unclassified',
        intent: null, purpose: null, desiredOutcome: null, roughPlan: null, horizon: null,
        effortEstimate: null, energyContext: null, aiMetadata: {}, status: 'archived', deletedAt: now,
        createdAt: now, updatedAt: now, version: sql`${intentions.version} + 1`,
      }).where(and(eq(intentions.id, id), eq(intentions.ownerId, ownerId), isNull(intentions.deletedAt)))
        .returning({ id: intentions.id });
      if (!row) return null;
      await tx.update(timeBlocks).set({
        startsAt: now, endsAt: new Date(now.getTime() + 1_000), timezone: 'UTC',
        externalProvider: null, externalEventId: null, externalUrl: null, syncState: 'local', deletedAt: now, createdAt: now, updatedAt: now,
      }).where(and(eq(timeBlocks.intentionId, id), eq(timeBlocks.ownerId, ownerId)));
      await tx.delete(intentionRelationships).where(and(eq(intentionRelationships.ownerId, ownerId), eq(intentionRelationships.fromId, id)));
      await tx.delete(intentionRelationships).where(and(eq(intentionRelationships.ownerId, ownerId), eq(intentionRelationships.toId, id)));
      await tx.delete(suggestions).where(and(eq(suggestions.ownerId, ownerId), eq(suggestions.intentionId, id)));
      return row;
    });
    if (!deleted) return reply.code(404).send({ error: 'not_found' });
    return reply.code(204).send();
  });

  app.post('/intentions/:id/time-blocks', async (request, reply) => {
    const ownerId = requireOwner(request);
    const { id } = request.params as { id: string };
    const parsed = timeBlockInputSchema.safeParse(request.body);
    if (!parsed.success) throw bad(parsed.error.issues[0]?.message ?? 'Invalid time block');
    const input = parsed.data;
    const now = new Date();
    const result = await db.transaction(async (tx) => {
      const [parent] = await tx.select({ id: intentions.id, status: intentions.status }).from(intentions).where(and(
        eq(intentions.id, id), eq(intentions.ownerId, ownerId), isNull(intentions.deletedAt),
      )).limit(1).for('update');
      if (!parent) return null;
      if (parent.status === 'archived') throw bad('Restore this thought before planning time for it.', 409);
      const [inserted] = await tx.insert(timeBlocks).values({
        ownerId, intentionId: id, clientId: input.clientId, startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt), timezone: input.timezone,
        externalProvider: input.externalProvider ?? null, createdAt: now, updatedAt: now,
      }).onConflictDoNothing({ target: [timeBlocks.ownerId, timeBlocks.clientId] }).returning();
      const [block] = inserted ? [inserted] : await tx.select().from(timeBlocks).where(and(
        eq(timeBlocks.ownerId, ownerId), eq(timeBlocks.clientId, input.clientId),
      )).limit(1);
      if (!block) throw new Error('Time block could not be read after save.');
      if (block.intentionId !== parent.id) throw bad('This time block ID already belongs to another intention.', 409);
      return { block, created: Boolean(inserted) };
    });
    if (!result) return reply.code(404).send({ error: 'intention_not_found' });
    return reply.code(result.created ? 201 : 200).send({ timeBlock: result.block });
  });

  app.delete('/intentions/:id/time-blocks/:blockId', async (request, reply) => {
    const ownerId = requireOwner(request);
    const { id, blockId } = request.params as { id: string; blockId: string };
    const now = new Date();
    const [removed] = await db.update(timeBlocks).set({ deletedAt: now, updatedAt: now }).where(and(
      eq(timeBlocks.id, blockId), eq(timeBlocks.intentionId, id), eq(timeBlocks.ownerId, ownerId), isNull(timeBlocks.deletedAt),
    )).returning({ id: timeBlocks.id });
    if (!removed) return reply.code(404).send({ error: 'not_found' });
    return reply.code(204).send();
  });

  app.post('/intentions/:id/relationships', async (request, reply) => {
    const ownerId = requireOwner(request);
    const { id } = request.params as { id: string };
    const parsed = z.object({ targetId: z.string().uuid(), relation: z.enum(['supports', 'related', 'depends_on']).default('related') }).safeParse(request.body);
    if (!parsed.success) throw bad(parsed.error.issues[0]?.message ?? 'Provide a different target intention and valid relationship');
    if (parsed.data.targetId === id) throw bad('An intention cannot be related to itself');
    const result = await db.transaction(async (tx) => {
      const found = await tx.select({ id: intentions.id }).from(intentions).where(and(
        eq(intentions.ownerId, ownerId), inArray(intentions.id, [id, parsed.data.targetId]),
        isNull(intentions.deletedAt), ne(intentions.status, 'archived'),
      )).orderBy(asc(intentions.id)).for('update');
      const ids = new Set(found.map((item) => item.id));
      if (!ids.has(id) || !ids.has(parsed.data.targetId)) return null;
      const [row] = await tx.insert(intentionRelationships).values({
        ownerId, fromId: id, toId: parsed.data.targetId, relation: parsed.data.relation,
      }).onConflictDoNothing().returning();
      return { row: row ?? null, created: Boolean(row) };
    });
    if (!result) return reply.code(404).send({ error: 'intention_not_found' });
    return reply.code(result.created ? 201 : 200).send({ relationship: result.row });
  });
};
