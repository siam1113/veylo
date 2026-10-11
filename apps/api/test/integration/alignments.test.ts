import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { sqlClient } from '@veylo/db/client';
import { alignmentRoutes } from '../../src/routes/alignments.js';
import type {} from '../../src/auth.js';

// Run only against an explicitly designated disposable database with migration 0016.
test('standalone Align entries are idempotent, versioned, and owner scoped', { skip: process.env.VEYLO_DB_TESTS !== '1' }, async () => {
  const owner = randomUUID(); const other = randomUUID(); const id = randomUUID();
  const app = Fastify();
  app.decorateRequest('ownerId', null);
  app.addHook('preHandler', async (request) => { request.ownerId = request.headers.authorization === 'Bearer owner' ? owner : request.headers.authorization === 'Bearer other' ? other : null; });
  app.register(alignmentRoutes);
  try {
    await sqlClient`INSERT INTO auth.users (id) VALUES (${owner}), (${other})`;
    const payload = { id, mutationId: randomUUID(), expectedVersion: null, title: 'A calmer morning', kind: 'reason', note: '', intentionIds: [], archived: false };
    const create = await app.inject({ method: 'PUT', url: '/alignments', headers: { authorization: 'Bearer owner' }, payload });
    assert.equal(create.statusCode, 200, create.body); assert.equal(create.json().alignment.version, 1);
    const replay = await app.inject({ method: 'PUT', url: '/alignments', headers: { authorization: 'Bearer owner' }, payload });
    assert.equal(replay.json().alignment.version, 1);
    const otherRead = await app.inject({ method: 'GET', url: '/alignments', headers: { authorization: 'Bearer other' } });
    assert.deepEqual(otherRead.json().alignments, []);
    const overwrite = await app.inject({ method: 'PUT', url: '/alignments', headers: { authorization: 'Bearer other' }, payload });
    assert.equal(overwrite.statusCode, 404);
    const unauthorized = await app.inject({ method: 'GET', url: '/alignments' }); assert.equal(unauthorized.statusCode, 401);
    const stale = await app.inject({ method: 'PUT', url: '/alignments', headers: { authorization: 'Bearer owner' }, payload: { ...payload, mutationId: randomUUID() } });
    assert.equal(stale.statusCode, 409); assert.equal(stale.json().current.title, payload.title);
    const foreignThoughtId = randomUUID();
    await sqlClient`INSERT INTO intentions (owner_id, client_id, raw_capture, title) VALUES (${other}, ${foreignThoughtId}, 'Private thought', 'Private thought')`;
    const foreignLink = await app.inject({ method: 'PUT', url: '/alignments', headers: { authorization: 'Bearer owner' }, payload: { ...payload, expectedVersion: 1, mutationId: randomUUID(), intentionIds: [foreignThoughtId] } });
    assert.equal(foreignLink.statusCode, 409);
    const ownThought = randomUUID();
    await sqlClient`INSERT INTO intentions (owner_id, client_id, raw_capture, title) VALUES (${owner}, ${ownThought}, 'Morning walk', 'Morning walk')`;
    const link = await app.inject({ method: 'PUT', url: '/alignments', headers: { authorization: 'Bearer owner' }, payload: { ...payload, expectedVersion: 1, mutationId: randomUUID(), intentionIds: [ownThought] } });
    assert.equal(link.statusCode, 200, link.body); assert.deepEqual(link.json().alignment.intentionIds, [ownThought]);
    const archive = await app.inject({ method: 'PUT', url: '/alignments', headers: { authorization: 'Bearer owner' }, payload: { ...payload, expectedVersion: 2, mutationId: randomUUID(), archived: true } });
    assert.equal(archive.statusCode, 200); assert.equal(archive.json().alignment.archived, true);
  } finally { await app.close(); await sqlClient`DELETE FROM auth.users WHERE id IN (${owner}, ${other})`; await sqlClient.end({ timeout: 5 }); }
});
