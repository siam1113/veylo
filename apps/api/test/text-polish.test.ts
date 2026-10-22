import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
// Must load before any module that touches @clearhead/db/client (which reads process.env.DATABASE_URL
// at import time) — server.ts observes the same ordering for the same reason.
import '../src/env.js';
import { textPolishRoutes } from '../src/routes/text-polish.js';

// Covers only the auth gate, which needs neither a database nor an OpenAI call — this
// sandbox's .env points at a live production Supabase instance and a real OpenAI key, so
// the preference-gate and happy-path behavior (which need both) are left to a disposable-DB
// integration test following the CLEARHEAD_DB_TESTS=1 convention used by test/integration/*, not
// exercised here.
test('text/polish requires a signed-in owner', async () => {
  const app = Fastify();
  app.decorateRequest('ownerId', null);
  await app.register(textPolishRoutes);
  const response = await app.inject({ method: 'POST', url: '/text/polish', payload: { fieldKind: 'roughPlan', text: 'call the dentist', instruction: 'fix grammar' } });
  assert.equal(response.statusCode, 401);
  await app.close();
});
