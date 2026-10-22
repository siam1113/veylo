import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db, sqlClient } from '@clearhead/db/client';
import { integrations, oauthStates } from '@clearhead/db/schema';
import { env } from '../../src/env.js';
import { integrationRoutes } from '../../src/routes/integrations.js';
import type {} from '../../src/auth.js';

const ownerId = randomUUID();
const pageId = randomUUID();
const dataSourceId = randomUUID();
const secondCursor = randomUUID();

test('Notion OAuth connects, refreshes after a 401, paginates references, and revokes with the pinned API version', async () => {
  const originalFetch = globalThis.fetch;
  const originalValues = {
    clientId: env.NOTION_CLIENT_ID,
    clientSecret: env.NOTION_CLIENT_SECRET,
    redirectUri: env.NOTION_REDIRECT_URI,
    stateSecret: env.OAUTH_STATE_SECRET,
    encryptionKey: env.TOKEN_ENCRYPTION_KEY,
    webOrigin: env.WEB_ORIGIN,
  };
  const tokenCalls: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
  const searchCalls: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
  let revokeCall: { headers: Headers; body: Record<string, unknown> } | undefined;
  let app: FastifyInstance | undefined;

  env.NOTION_CLIENT_ID = 'notion-client-id-for-test';
  env.NOTION_CLIENT_SECRET = 'notion-client-secret-for-test';
  env.NOTION_REDIRECT_URI = 'https://api.clearhead.test/v1/integrations/notion/callback';
  env.OAUTH_STATE_SECRET = 'integration-test-state-secret-with-more-than-32-chars';
  env.TOKEN_ENCRYPTION_KEY = 'integration-test-provider-token-encryption-key';
  env.WEB_ORIGIN = 'https://app.clearhead.test';
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    if (url === 'https://api.notion.com/v1/oauth/token') {
      tokenCalls.push({ headers, body });
      const refreshing = body.grant_type === 'refresh_token';
      return new Response(JSON.stringify({
        access_token: refreshing ? 'notion-refreshed-access-token' : 'notion-access-token',
        refresh_token: refreshing ? 'notion-rotated-refresh-token' : 'notion-refresh-token', expires_in: 3600,
        workspace_id: randomUUID(), workspace_name: 'ClearHead Test Workspace', bot_id: randomUUID(),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url === 'https://api.notion.com/v1/search') {
      searchCalls.push({ headers, body });
      if (headers.get('authorization') === 'Bearer notion-access-token') {
        return new Response(JSON.stringify({ message: 'Access token expired' }), {
          status: 401, headers: { 'Content-Type': 'application/json' },
        });
      }
      const results = body.start_cursor
        ? [{ object: 'data_source', id: dataSourceId, name: 'Projects', url: `https://www.notion.so/${dataSourceId}` }]
        : [{ object: 'page', id: pageId, properties: { Name: { type: 'title', title: [{ plain_text: 'A saved page' }] } }, url: `https://www.notion.so/${pageId}` }];
      return new Response(JSON.stringify({ results, has_more: !body.start_cursor, next_cursor: body.start_cursor ? null : secondCursor }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === 'https://api.notion.com/v1/oauth/revoke') {
      revokeCall = { headers, body };
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected Notion provider request: ${url}`);
  };

  try {
    await sqlClient`INSERT INTO auth.users (id) VALUES (${ownerId}) ON CONFLICT (id) DO NOTHING`;
    app = Fastify();
    app.decorateRequest('ownerId', null);
    app.addHook('preHandler', async (request: FastifyRequest) => {
      request.ownerId = request.headers.authorization === 'Bearer owner-token' ? ownerId : null;
    });
    app.register(integrationRoutes, { prefix: '/v1' });
    await app.ready();

    const connect = await app.inject({
      method: 'POST', url: '/v1/integrations/notion/connect',
      headers: { authorization: 'Bearer owner-token' }, payload: { target: 'web' },
    });
    assert.equal(connect.statusCode, 200, connect.body);
    const authorizationUrl = new URL(connect.json<{ authorizationUrl: string }>().authorizationUrl);
    const state = authorizationUrl.searchParams.get('state');
    assert.ok(state);
    assert.equal(authorizationUrl.searchParams.get('owner'), 'user');

    const callback = await app.inject({ method: 'GET', url: `/v1/integrations/notion/callback?${new URLSearchParams({ code: 'notion-code', state })}` });
    assert.equal(callback.statusCode, 302, callback.body);
    const callbackUrl = new URL(callback.headers.location!);
    const callbackData = new URLSearchParams(callbackUrl.hash.slice(1));
    assert.equal(callbackData.get('oauth_provider'), 'notion');
    assert.equal(callbackData.get('oauth_code'), 'notion-code');
    assert.equal(callback.headers['cache-control'], 'no-store');

    const complete = await app.inject({
      method: 'POST', url: '/v1/integrations/notion/complete',
      headers: { authorization: 'Bearer owner-token' }, payload: { code: 'notion-code', state },
    });
    assert.equal(complete.statusCode, 200, complete.body);
    assert.equal(complete.json<{ connected: boolean }>().connected, true);
    assert.equal(tokenCalls.length, 1);
    assert.match(tokenCalls[0]!.headers.get('authorization') ?? '', /^Basic /);
    assert.equal(tokenCalls[0]!.headers.get('notion-version'), '2026-03-11');
    assert.deepEqual(tokenCalls[0]!.body, { grant_type: 'authorization_code', code: 'notion-code', redirect_uri: env.NOTION_REDIRECT_URI });
    const [connected] = await db.select().from(integrations).where(and(
      eq(integrations.ownerId, ownerId), eq(integrations.provider, 'notion'),
    ));
    assert.ok(connected?.encryptedRefreshToken);

    const firstPage = await app.inject({ method: 'GET', url: '/v1/integrations/notion/pages', headers: { authorization: 'Bearer owner-token' } });
    assert.equal(firstPage.statusCode, 200, firstPage.body);
    assert.deepEqual(firstPage.json<{ pages: Array<{ id: string; title: string; kind: string }>; nextCursor: string; hasMore: boolean }>(), {
      pages: [{ id: pageId, kind: 'page', title: 'A saved page', url: `https://www.notion.so/${pageId}`, lastEditedAt: null }],
      nextCursor: secondCursor, hasMore: true,
    });
    const nextPage = await app.inject({
      method: 'GET', url: `/v1/integrations/notion/pages?cursor=${secondCursor}`,
      headers: { authorization: 'Bearer owner-token' },
    });
    assert.equal(nextPage.statusCode, 200, nextPage.body);
    assert.equal(nextPage.json<{ pages: Array<{ id: string; kind: string }> }>().pages[0]?.id, dataSourceId);
    assert.equal(nextPage.json<{ pages: Array<{ kind: string }> }>().pages[0]?.kind, 'database');
    assert.equal(searchCalls.length, 3);
    assert.deepEqual(searchCalls.map((call) => call.headers.get('authorization')), [
      'Bearer notion-access-token', 'Bearer notion-refreshed-access-token', 'Bearer notion-refreshed-access-token',
    ]);
    for (const call of searchCalls) {
      assert.equal(call.headers.get('notion-version'), '2026-03-11');
      assert.equal(call.headers.get('content-type'), 'application/json');
    }
    assert.equal(tokenCalls.length, 2);
    assert.deepEqual(tokenCalls[1]!.body, { grant_type: 'refresh_token', refresh_token: 'notion-refresh-token' });
    for (const call of tokenCalls) {
      assert.match(call.headers.get('authorization') ?? '', /^Basic /);
      assert.equal(call.headers.get('notion-version'), '2026-03-11');
    }
    const [refreshedConnection] = await db.select().from(integrations).where(and(
      eq(integrations.ownerId, ownerId), eq(integrations.provider, 'notion'),
    ));
    assert.notEqual(refreshedConnection?.encryptedRefreshToken, connected?.encryptedRefreshToken);
    assert.notEqual(refreshedConnection?.encryptedRefreshToken, 'notion-rotated-refresh-token');
    assert.equal(searchCalls[2]!.body.start_cursor, secondCursor);

    const disconnected = await app.inject({ method: 'DELETE', url: '/v1/integrations/notion', headers: { authorization: 'Bearer owner-token' } });
    assert.equal(disconnected.statusCode, 200, disconnected.body);
    assert.equal(disconnected.json<{ disconnected: boolean }>().disconnected, true);
    assert.ok(revokeCall);
    assert.match(revokeCall.headers.get('authorization') ?? '', /^Basic /);
    assert.equal(revokeCall.headers.get('notion-version'), '2026-03-11');
    assert.equal(revokeCall.body.token, 'notion-refreshed-access-token');

    const [storedConnection] = await db.select().from(integrations).where(and(
      eq(integrations.ownerId, ownerId), eq(integrations.provider, 'notion'),
    ));
    assert.equal(storedConnection?.revokedAt instanceof Date, true);
    assert.equal(storedConnection?.encryptedAccessToken, null);
    assert.equal(storedConnection?.encryptedRefreshToken, null);
  } finally {
    try {
      await app?.close();
      await db.delete(integrations).where(eq(integrations.ownerId, ownerId));
      await db.delete(oauthStates).where(eq(oauthStates.ownerId, ownerId));
      await sqlClient`DELETE FROM auth.users WHERE id = ${ownerId}`;
    } finally {
      await sqlClient.end({ timeout: 5 });
      globalThis.fetch = originalFetch;
      env.NOTION_CLIENT_ID = originalValues.clientId;
      env.NOTION_CLIENT_SECRET = originalValues.clientSecret;
      env.NOTION_REDIRECT_URI = originalValues.redirectUri;
      env.OAUTH_STATE_SECRET = originalValues.stateSecret;
      env.TOKEN_ENCRYPTION_KEY = originalValues.encryptionKey;
      env.WEB_ORIGIN = originalValues.webOrigin;
    }
  }
});
