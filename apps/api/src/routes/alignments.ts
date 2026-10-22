import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alignmentWriteSchema, type AlignmentRecord } from '@clearhead/domain';
import { db } from '@clearhead/db/client';
import { alignmentAnchors, intentions } from '@clearhead/db/schema';
import { requireOwner } from '../auth.js';

const shape = (row: typeof alignmentAnchors.$inferSelect): AlignmentRecord => ({
  id: row.id, kind: row.kind as AlignmentRecord['kind'], title: row.title, note: row.note,
  intentionIds: row.intentionIds, archived: row.archived, version: row.version, updatedAt: row.updatedAt.toISOString(),
});
const bad = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });

export const alignmentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/alignments', async (request) => {
    const ownerId = requireOwner(request);
    const rows = await db.select().from(alignmentAnchors).where(eq(alignmentAnchors.ownerId, ownerId));
    return { alignments: rows.map(shape) };
  });
  app.put('/alignments', async (request, reply) => {
    const ownerId = requireOwner(request);
    const parsed = alignmentWriteSchema.safeParse(request.body);
    if (!parsed.success) throw bad(parsed.error.message);
    const input = parsed.data;
    const result = await db.transaction(async (tx) => {
      // Serialize create/retry/update for this client UUID, including absent rows.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.id}, 0))`);
      const [current] = await tx.select().from(alignmentAnchors).where(and(eq(alignmentAnchors.id, input.id), eq(alignmentAnchors.ownerId, ownerId)));
      if (current?.mutationId === input.mutationId) return { alignment: shape(current) };
      if ((current?.version ?? null) !== input.expectedVersion) return { conflict: true, current: current ? shape(current) : null };
      let intentionIds = input.intentionIds;
      if (input.intentionIds.length) {
        const owned = await tx.select({ id: intentions.clientId }).from(intentions).where(and(
          eq(intentions.ownerId, ownerId), isNull(intentions.deletedAt), inArray(intentions.clientId, input.intentionIds),
        ));
        const validIds = new Set(owned.map((row) => row.id));
        if (input.intentionIds.some((id) => !validIds.has(id) && !current?.intentionIds.includes(id))) throw bad('A linked thought is unavailable. Sync your thoughts or remove the missing link.', 409);
        intentionIds = input.intentionIds.filter((id) => validIds.has(id));
      }
      const content = { kind: input.kind, title: input.title, note: input.note, intentionIds, archived: input.archived, mutationId: input.mutationId, updatedAt: new Date() };
      const [saved] = current
        ? await tx.update(alignmentAnchors).set({ ...content, version: current.version + 1 }).where(and(eq(alignmentAnchors.id, input.id), eq(alignmentAnchors.ownerId, ownerId))).returning()
        : await tx.insert(alignmentAnchors).values({ ...content, id: input.id, ownerId }).onConflictDoNothing().returning();
      if (!saved) throw bad('Align entry not found.', 404);
      return { alignment: shape(saved!) };
    });
    if ('conflict' in result) return reply.code(409).send({ message: 'This entry changed on another device. Review both versions before saving.', current: result.current });
    return result;
  });
  app.delete('/alignments/:id', async (request, reply) => {
    const ownerId = requireOwner(request);
    const { id } = request.params as { id: string };
    if (!z.string().uuid().safeParse(id).success) throw bad('Provide a valid Align entry ID');
    const [removed] = await db.delete(alignmentAnchors).where(and(
      eq(alignmentAnchors.id, id), eq(alignmentAnchors.ownerId, ownerId),
    )).returning({ id: alignmentAnchors.id });
    if (!removed) return reply.code(404).send({ error: 'not_found' });
    return reply.code(204).send();
  });
};
