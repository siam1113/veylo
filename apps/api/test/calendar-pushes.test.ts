import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';

// No database, queue, or real provider account is needed for these contract checks.
process.env.DATABASE_URL = 'postgres://test:test@localhost:1/test';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-only';
process.env.REDIS_URL = '';
const { calendarPushRoutes } = await import('../src/routes/calendar-pushes.js');

test('POST /calendar-pushes requires a signed-in owner', async () => {
  const app = Fastify(); app.decorateRequest('ownerId', null); app.register(calendarPushRoutes);
  try {
    const result = await app.inject({ method: 'POST', url: '/calendar-pushes', payload: { timeBlockId: '00000000-0000-0000-0000-000000000000', integrationIds: ['00000000-0000-0000-0000-000000000001'] } });
    assert.equal(result.statusCode, 401);
    assert.equal(result.headers['cache-control'], 'no-store');
  } finally { await app.close(); }
});

test('POST /calendar-pushes validates its body before touching the database', async () => {
  const app = Fastify();
  app.decorateRequest('ownerId', null);
  app.addHook('preHandler', async (request) => { request.ownerId = 'test-owner'; });
  app.register(calendarPushRoutes);
  try {
    const missingBlock = await app.inject({ method: 'POST', url: '/calendar-pushes', payload: { integrationIds: ['00000000-0000-0000-0000-000000000001'] } });
    assert.equal(missingBlock.statusCode, 400);
    const emptyTargets = await app.inject({ method: 'POST', url: '/calendar-pushes', payload: { timeBlockId: '00000000-0000-0000-0000-000000000000', integrationIds: [] } });
    assert.equal(emptyTargets.statusCode, 400);
  } finally { await app.close(); }
});
