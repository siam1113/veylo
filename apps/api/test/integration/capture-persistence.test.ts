import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db, sqlClient } from '@clearhead/db/client';
import type { OriginalVersion } from '@clearhead/domain';
import { intentions } from '@clearhead/db/schema';
import { intentionRoutes } from '../../src/routes/intentions.js';
import type {} from '../../src/auth.js';

const ownerId = 'e6e6a1a6-037e-4f26-9fe6-c084abec227b';
const otherOwnerId = 'ed44dce8-350c-45ad-97dd-2ef0d09e5642';

function createTestApp() {
  const app = Fastify();
  app.decorateRequest('ownerId', null);
  app.addHook('preHandler', async (request) => {
    const token = request.headers.authorization?.replace(/^Bearer /, '');
    request.ownerId = token === 'owner-token' ? ownerId : token === 'other-owner-token' ? otherOwnerId : null;
  });
  app.register(intentionRoutes, { prefix: '/v1' });
  return app;
}

test('capture persists, replays idempotently, edits, records history, and remains owner scoped', async () => {
  const clientId = randomUUID();
  let app: ReturnType<typeof createTestApp> | undefined;
  await sqlClient`INSERT INTO auth.users (id) VALUES (${ownerId}), (${otherOwnerId}) ON CONFLICT (id) DO NOTHING`;

  try {
    app = createTestApp();
    await app.ready();

    const unauthorized = await app.inject({
      method: 'POST', url: '/v1/captures',
      payload: { clientId: randomUUID(), rawCapture: 'This should not be stored.' },
    });
    assert.equal(unauthorized.statusCode, 401, unauthorized.body);

    const capture = await app.inject({
      method: 'POST', url: '/v1/captures',
      headers: { authorization: 'Bearer owner-token' },
      payload: { clientId, rawCapture: 'Maybe I should ask Maya about the garden idea next week.' },
    });
    assert.equal(capture.statusCode, 201, capture.body);
    const created = capture.json<{ intention: { id: string; clientId: string; rawCapture: string; title: string } }>().intention;
    assert.equal(created.clientId, clientId);
    assert.equal(created.rawCapture, 'Maybe I should ask Maya about the garden idea next week.');
    assert.equal(created.title, 'Ask Maya about the garden idea next week');

    const replay = await app.inject({
      method: 'POST', url: '/v1/captures',
      headers: { authorization: 'Bearer owner-token' },
      payload: { clientId, rawCapture: 'Maybe I should ask Maya about the garden idea next week.' },
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json<{ intention: { id: string } }>().intention.id, created.id);

    const edit = await app.inject({
      method: 'POST', url: '/v1/sync/push',
      headers: { authorization: 'Bearer owner-token' },
      payload: { intentions: [{
        clientId, rawCapture: 'Maybe I should ask Maya about the garden idea next week.',
        title: 'Talk with Maya about the garden', kind: 'meeting', intent: 'Explore the idea',
        purpose: null, desiredOutcome: null, roughPlan: null, horizon: 'week',
        effortEstimate: null, energyContext: null, status: 'ready', expectedVersion: 1,
      }] },
    });
    assert.equal(edit.statusCode, 200, edit.body);
    assert.deepEqual(edit.json<{ saved: Array<{ clientId: string; version: number }> }>().saved, [{ clientId, remoteId: created.id, version: 2 }]);

    const pulled = await app.inject({ method: 'GET', url: '/v1/sync', headers: { authorization: 'Bearer owner-token' } });
    assert.equal(pulled.statusCode, 200, pulled.body);
    const intention = pulled.json<{ intentions: Array<{
      id: string; clientId: string; rawCapture: string; title: string; kind: string; intent: string | null;
      horizon: string | null; status: string; version: number; deletedAt: string | null;
      createdAt: string; updatedAt: string;
    }> }>().intentions
      .find((item) => item.id === created.id);
    assert.ok(intention);
    assert.equal(intention.rawCapture, 'Maybe I should ask Maya about the garden idea next week.');
    assert.equal(intention.title, 'Talk with Maya about the garden');
    assert.equal(intention.kind, 'meeting');
    assert.equal(intention.intent, 'Explore the idea');
    assert.equal(intention.horizon, 'week');
    assert.equal(intention.status, 'ready');
    assert.equal(intention.version, 2);
    assert.equal(intention.deletedAt, null);
    assert.ok(Number.isFinite(Date.parse(intention.createdAt)) && Number.isFinite(Date.parse(intention.updatedAt)));

    const history = await app.inject({ method: 'GET', url: `/v1/intentions/${created.id}/history`, headers: { authorization: 'Bearer owner-token' } });
    assert.equal(history.statusCode, 200, history.body);
    const entries = history.json<{ history: Array<{ action: string; changedFields: string[] }> }>().history;
    assert.equal(entries[0]?.action, 'status_changed');
    assert.deepEqual(entries[0]?.changedFields.sort(), ['horizon', 'intent', 'kind', 'status', 'title']);

    const otherOwnerPull = await app.inject({ method: 'GET', url: '/v1/sync', headers: { authorization: 'Bearer other-owner-token' } });
    assert.equal(otherOwnerPull.statusCode, 200, otherOwnerPull.body);
    assert.equal(otherOwnerPull.json<{ intentions: unknown[] }>().intentions.length, 0);

    const blankCapture = await app.inject({
      method: 'POST', url: '/v1/captures', headers: { authorization: 'Bearer owner-token' },
      payload: { clientId: randomUUID(), rawCapture: '  \n\t' },
    });
    assert.equal(blankCapture.statusCode, 400, blankCapture.body);

    const processedAt = new Date().toISOString();
    await db.update(intentions).set({
      title: 'AI title', kind: 'meeting', horizon: 'week', version: 3,
      aiMetadata: {
        processedAt, previousTitle: 'Talk with Maya about the garden', previousKind: 'meeting', previousHorizon: null,
        appliedTitle: 'AI title', appliedKind: 'meeting', appliedHorizon: 'week', confidence: 0.9, rationale: 'Clear timeframe.',
      },
    }).where(and(eq(intentions.ownerId, ownerId), eq(intentions.clientId, clientId)));
    const aiSnapshot = await app.inject({ method: 'GET', url: '/v1/sync', headers: { authorization: 'Bearer owner-token' } });
    const aiIntention = aiSnapshot.json<{ intentions: Array<{ id: string; aiInterpretation: { canUndo: boolean } | null }> }>().intentions
      .find((item) => item.id === created.id);
    assert.equal(aiIntention?.aiInterpretation?.canUndo, true);

    const undo = await app.inject({
      method: 'POST', url: `/v1/intentions/${created.id}/interpretation/undo`,
      headers: { authorization: 'Bearer owner-token' }, payload: { expectedVersion: 3 },
    });
    assert.equal(undo.statusCode, 200, undo.body);
    const restored = undo.json<{ intention: { title: string; kind: string; horizon: string | null; version: number; aiInterpretation: { canUndo: boolean; undoneAt: string | null } } }>().intention;
    assert.equal(restored.title, 'Talk with Maya about the garden');
    assert.equal(restored.kind, 'meeting');
    assert.equal(restored.horizon, null);
    assert.equal(restored.version, 4);
    assert.equal(restored.aiInterpretation.canUndo, false);
    assert.ok(restored.aiInterpretation.undoneAt);

    const piece = { id: randomUUID(), versionId: clientId, content: '  Later that evening: leave room for herbs.\n', createdAt: new Date().toISOString(), startNewVersion: false };
    const add = () => app!.inject({ method: 'POST', url: `/v1/intentions/${created.id}/pieces`, headers: { authorization: 'Bearer owner-token' }, payload: piece });
    const added = await add();
    assert.equal(added.statusCode, 201, added.body);
    const originals = added.json<{ intention: { originalVersions: OriginalVersion[]; rawCapture: string } }>().intention;
    assert.equal(originals.originalVersions.length, 1);
    assert.equal(originals.originalVersions[0]!.pieces.length, 2);
    assert.equal(originals.originalVersions[0]!.pieces[1]!.content, piece.content);
    assert.ok(originals.originalVersions[0]!.pieces[1]!.syncedAt);
    assert.equal(originals.rawCapture, created.rawCapture);
    const replayPiece = await add();
    assert.equal(replayPiece.statusCode, 200, replayPiece.body);
    assert.equal(replayPiece.json().intention.originalVersions[0].pieces.length, 2);
    const rewrite = await app.inject({ method: 'POST', url: `/v1/intentions/${created.id}/pieces`, headers: { authorization: 'Bearer owner-token' }, payload: { ...piece, content: 'Overwrite the saved words' } });
    assert.equal(rewrite.statusCode, 409, rewrite.body);
    const privatePiece = await app.inject({ method: 'POST', url: `/v1/intentions/${created.id}/pieces`, headers: { authorization: 'Bearer other-owner-token' }, payload: { ...piece, id: randomUUID() } });
    assert.equal(privatePiece.statusCode, 404, privatePiece.body);
    const versionId = randomUUID();
    const newVersion = await app.inject({ method: 'POST', url: `/v1/intentions/${created.id}/pieces`, headers: { authorization: 'Bearer owner-token' }, payload: { ...piece, id: randomUUID(), versionId, startNewVersion: true, content: 'A community garden instead.' } });
    assert.equal(newVersion.statusCode, 201, newVersion.body);
    assert.equal(newVersion.json().intention.originalVersions.length, 2);
    assert.equal(newVersion.json().intention.originalVersions[1].pieces.length, 1);
    const pieceHistory = await app.inject({ method: 'GET', url: `/v1/intentions/${created.id}/history`, headers: { authorization: 'Bearer owner-token' } });
    assert.ok(pieceHistory.json().history.some((entry: { action: string }) => entry.action === 'piece_added'));
    assert.ok(pieceHistory.json().history.some((entry: { action: string }) => entry.action === 'version_started'));

  } finally {
    await app?.close();
    await db.delete(intentions).where(and(eq(intentions.ownerId, ownerId), eq(intentions.clientId, clientId)));
    await sqlClient`DELETE FROM auth.users WHERE id IN (${ownerId}, ${otherOwnerId})`;
    await sqlClient.end({ timeout: 5 });
  }
});
