import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { connectionIsActive, authorizationUrl, exchangeProviderToken, pkceVerifier, readProviderEntries } from '../src/connection-providers.js';

// No database or real provider account is needed for these contract checks.
process.env.DATABASE_URL = 'postgres://test:test@localhost:1/test';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-only';
const { env } = await import('../src/env.js');
const { integrationRoutes } = await import('../src/routes/integrations.js');

test('an unconfigured Connect explains setup without issuing an OAuth state', async () => {
  const previous = env.GOOGLE_CLIENT_ID; env.GOOGLE_CLIENT_ID = undefined;
  const app = Fastify(); app.decorateRequest('ownerId', null);
  app.addHook('preHandler', async (request) => { request.ownerId = 'test-owner'; });
  app.register(integrationRoutes);
  try {
    const result = await app.inject({ method: 'POST', url: '/integrations/google/connect', payload: {} });
    assert.equal(result.statusCode, 409);
    assert.match(result.json().message, /not available/);
    const catalog = await app.inject('/integrations/catalog');
    assert.equal(catalog.statusCode, 200);
    assert.equal(catalog.json().providers.length, 13);
    assert.equal(catalog.json().providers.find((item: { provider: string }) => item.provider === 'google_calendar').configured, false);
  } finally { env.GOOGLE_CLIENT_ID = previous; await app.close(); }
});

test('access-token-only connections are active and revoked ones stay disconnected', () => {
  const row = { revokedAt: null, encryptedAccessToken: 'encrypted', encryptedRefreshToken: null };
  assert.equal(connectionIsActive(row), true);
  assert.equal(connectionIsActive({ ...row, revokedAt: new Date() }), false);
  assert.equal(connectionIsActive({ ...row, encryptedAccessToken: null }), false);
});

test('all six new connections require a signed-in owner before accessing data or credentials', async () => {
  const app = Fastify(); app.decorateRequest('ownerId', null); app.register(integrationRoutes);
  try {
    for (const provider of ['icloud', 'todoist', 'microsoft_todo', 'linear', 'github', 'slack']) {
      for (const action of [
        { method: 'POST' as const, url: `/integrations/${provider}/connect`, payload: {} },
        { method: 'GET' as const, url: `/integrations/${provider}/entries` },
        { method: 'DELETE' as const, url: `/integrations/${provider}` },
      ]) {
        const result = await app.inject(action);
        assert.equal(result.statusCode, 401); assert.equal(result.headers['cache-control'], 'no-store');
      }
      if (provider !== 'icloud') assert.equal((await app.inject({ method: 'POST', url: `/integrations/${provider}/complete`, payload: { code: 'code', state: 'state' } })).statusCode, 401);
    }
  } finally { await app.close(); }
});

test('invalid iCloud credentials return useful validation without echoing the password', async () => {
  const previous = env.TOKEN_ENCRYPTION_KEY; env.TOKEN_ENCRYPTION_KEY = 'test-only';
  const app = Fastify(); app.decorateRequest('ownerId', null);
  app.addHook('preHandler', async (request) => { request.ownerId = 'test-owner'; }); app.register(integrationRoutes);
  try {
    const result = await app.inject({ method: 'POST', url: '/integrations/icloud/connect', payload: { appleId: 'test@example.com', appPassword: 'PrivateMainPassword' } });
    assert.equal(result.statusCode, 400); assert.match(result.json().message, /app-specific password/);
    assert.equal(result.body.includes('PrivateMainPassword'), false);
  } finally { env.TOKEN_ENCRYPTION_KEY = previous; await app.close(); }
});

test('authorization is provider-specific and PKCE never reveals the verifier', () => {
  const config = { clientId: 'client', clientSecret: 'secret', redirectUri: 'https://api.test/callback' };
  const verifier = pkceVerifier('signed-state', 'server-secret');
  for (const provider of ['outlook', 'clickup', 'asana', 'trello'] as const) {
    const url = new URL(authorizationUrl(provider, config, 'signed-state', verifier));
    assert.equal(url.searchParams.get('state'), 'signed-state');
    assert.equal(url.searchParams.get('redirect_uri'), config.redirectUri);
    assert.equal(url.toString().includes('secret'), false);
    if (provider !== 'clickup') {
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      assert.notEqual(url.searchParams.get('code_challenge'), verifier);
    }
  }
});

test('provider reads and token exchange use authenticated requests and safe references', async () => {
  const original = globalThis.fetch; const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input); requests.push({ url, init });
    const json = url.includes('/oauth_token') ? { access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }
      : url.includes('/calendarView?') ? { value: [{ id: 'event', subject: 'Meeting', start: { dateTime: '2026-10-12T10:00:00' }, webLink: 'https://outlook.office.com/event' }], '@odata.nextLink': 'next' }
      : url.includes('/members/me/cards') ? [{ id: 'card', name: 'Plan', due: '2026-10-12', closed: false, dueComplete: false, url: 'javascript:alert(1)' }]
      : url.endsWith('/user') ? { user: { id: 7 } }
      : url.endsWith('/team') ? { teams: [{ id: 'workspace', name: 'Work' }] }
      : url.includes('/team/workspace/task') ? { tasks: [{ id: 'task', name: 'Deliver', due_date: '1791763200000', url: 'https://app.clickup.com/t/task' }], last_page: true }
      : url.includes('/workspaces?') ? { data: [{ gid: 'workspace', name: 'Work' }] }
      : { data: [{ gid: 'asana-task', name: 'Review', due_on: '2026-10-12', due_at: null, completed: false, permalink_url: 'https://app.asana.com/0/task' }], next_page: null };
    return new Response(JSON.stringify(json));
  };
  try {
    const outlook = await readProviderEntries('outlook', 'access');
    assert.equal(outlook.entries[0]?.date, '2026-10-12T10:00:00Z'); assert.equal(outlook.hasMore, true);
    assert.equal((await readProviderEntries('trello', 'access')).entries[0]?.url, undefined);
    assert.equal((await readProviderEntries('clickup', 'access')).entries[0]?.title, 'Deliver');
    assert.ok(requests.find((request) => request.url.includes('assignees%5B%5D=7')));
    assert.equal((await readProviderEntries('asana', 'access')).entries[0]?.date, '2026-10-12');
    for (const request of requests) assert.equal(new Headers(request.init?.headers).get('Authorization'), 'Bearer access');
    await exchangeProviderToken('asana', { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://api.test/callback' }, { code: 'code', grant_type: 'authorization_code' });
    assert.equal(new Headers(requests.at(-1)?.init?.headers).get('Content-Type'), 'application/x-www-form-urlencoded');
  } finally { globalThis.fetch = original; }
});
