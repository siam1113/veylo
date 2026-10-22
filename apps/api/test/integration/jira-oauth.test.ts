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
const cloudId = randomUUID();

test('Jira OAuth connects, refreshes after a 401, imports assigned issues, and disconnects', async () => {
  const originalFetch = globalThis.fetch;
  const originalValues = {
    clientId: env.JIRA_CLIENT_ID,
    clientSecret: env.JIRA_CLIENT_SECRET,
    redirectUri: env.JIRA_REDIRECT_URI,
    stateSecret: env.OAUTH_STATE_SECRET,
    encryptionKey: env.TOKEN_ENCRYPTION_KEY,
    webOrigin: env.WEB_ORIGIN,
  };
  const tokenCalls: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
  const issueCalls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
  let resourceHeaders: Headers | undefined;
  let app: FastifyInstance | undefined;

  env.JIRA_CLIENT_ID = 'jira-client-id-for-test';
  env.JIRA_CLIENT_SECRET = 'jira-client-secret-for-test';
  env.JIRA_REDIRECT_URI = 'https://api.clearhead.test/v1/integrations/jira/callback';
  env.OAUTH_STATE_SECRET = 'integration-test-state-secret-with-more-than-32-chars';
  env.TOKEN_ENCRYPTION_KEY = 'integration-test-provider-token-encryption-key';
  env.WEB_ORIGIN = 'https://app.clearhead.test';
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    if (url === 'https://auth.atlassian.com/oauth/token') {
      tokenCalls.push({ headers, body });
      const refreshing = body.grant_type === 'refresh_token';
      return new Response(JSON.stringify({
        access_token: refreshing ? 'jira-refreshed-access-token' : 'jira-access-token',
        refresh_token: refreshing ? 'jira-rotated-refresh-token' : 'jira-refresh-token',
        expires_in: 3600, scope: 'read:jira-work offline_access', token_type: 'Bearer',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url === 'https://api.atlassian.com/oauth/token/accessible-resources') {
      resourceHeaders = headers;
      return new Response(JSON.stringify([{
        id: cloudId, name: 'ClearHead QA site', url: 'https://clearhead-qa.atlassian.net', scopes: ['read:jira-work'],
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url === `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search/jql`) {
      issueCalls.push({ url, headers, body });
      if (headers.get('authorization') === 'Bearer jira-access-token') {
        return new Response(JSON.stringify({ errorMessages: ['Access token expired'] }), {
          status: 401, headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ issues: [{
        id: 'issue-101', key: 'PLAN-101', fields: {
          summary: 'Review the garden proposal', status: { name: 'In Progress' },
          project: { name: 'Planning' }, issuetype: { name: 'Task' },
          priority: { name: 'Medium' }, duedate: '2026-11-02', updated: '2026-10-09T12:00:00.000Z',
        },
      }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected Jira provider request: ${url}`);
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
      method: 'POST', url: '/v1/integrations/jira/connect',
      headers: { authorization: 'Bearer owner-token' }, payload: { target: 'web' },
    });
    assert.equal(connect.statusCode, 200, connect.body);
    const authorizationUrl = new URL(connect.json<{ authorizationUrl: string }>().authorizationUrl);
    const state = authorizationUrl.searchParams.get('state');
    assert.ok(state);
    assert.equal(authorizationUrl.searchParams.get('audience'), 'api.atlassian.com');
    assert.deepEqual(authorizationUrl.searchParams.get('scope')?.split(' '), ['read:jira-work', 'offline_access']);

    const callback = await app.inject({ method: 'GET', url: `/v1/integrations/jira/callback?${new URLSearchParams({ code: 'jira-code', state })}` });
    assert.equal(callback.statusCode, 302, callback.body);
    const callbackUrl = new URL(callback.headers.location!);
    const callbackData = new URLSearchParams(callbackUrl.hash.slice(1));
    assert.equal(callbackData.get('oauth_provider'), 'jira');
    assert.equal(callbackData.get('oauth_code'), 'jira-code');
    assert.equal(callback.headers['cache-control'], 'no-store');

    const complete = await app.inject({
      method: 'POST', url: '/v1/integrations/jira/complete',
      headers: { authorization: 'Bearer owner-token' }, payload: { code: 'jira-code', state },
    });
    assert.equal(complete.statusCode, 200, complete.body);
    assert.deepEqual(complete.json<{ connected: boolean; provider: string; siteName: string }>(), {
      connected: true, provider: 'jira_cloud', siteName: 'ClearHead QA site',
    });
    assert.equal(tokenCalls.length, 1);
    assert.deepEqual(tokenCalls[0]!.body, {
      grant_type: 'authorization_code', code: 'jira-code', redirect_uri: env.JIRA_REDIRECT_URI,
      client_id: env.JIRA_CLIENT_ID, client_secret: env.JIRA_CLIENT_SECRET,
    });
    assert.equal(resourceHeaders?.get('authorization'), 'Bearer jira-access-token');

    const imported = await app.inject({ method: 'GET', url: '/v1/integrations/jira/issues', headers: { authorization: 'Bearer owner-token' } });
    assert.equal(imported.statusCode, 200, imported.body);
    assert.deepEqual(imported.json<{ siteName: string; issues: Array<Record<string, unknown>> }>(), {
      siteName: 'ClearHead QA site', issues: [{
        id: 'issue-101', key: 'PLAN-101', summary: 'Review the garden proposal', status: 'In Progress',
        project: 'Planning', issueType: 'Task', priority: 'Medium', dueDate: '2026-11-02',
        updatedAt: '2026-10-09T12:00:00.000Z', url: 'https://clearhead-qa.atlassian.net/browse/PLAN-101',
      }],
    });
    assert.equal(tokenCalls.length, 2);
    assert.equal(tokenCalls[1]!.body.grant_type, 'refresh_token');
    assert.equal(tokenCalls[1]!.body.refresh_token, 'jira-refresh-token');
    assert.equal(tokenCalls[1]!.body.client_id, env.JIRA_CLIENT_ID);
    assert.equal(tokenCalls[1]!.body.client_secret, env.JIRA_CLIENT_SECRET);
    assert.deepEqual(issueCalls.map((call) => call.headers.get('authorization')), [
      'Bearer jira-access-token', 'Bearer jira-refreshed-access-token',
    ]);
    for (const call of issueCalls) {
      assert.equal(call.url, `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search/jql`);
      assert.deepEqual(call.body, {
        jql: 'assignee = currentUser() ORDER BY updated DESC', maxResults: 30,
        fields: ['summary', 'status', 'duedate', 'updated', 'project', 'issuetype', 'priority'],
      });
    }

    const disconnected = await app.inject({ method: 'DELETE', url: '/v1/integrations/jira', headers: { authorization: 'Bearer owner-token' } });
    assert.equal(disconnected.statusCode, 204, disconnected.body);
    const [connection] = await db.select().from(integrations).where(and(
      eq(integrations.ownerId, ownerId), eq(integrations.provider, 'jira_cloud'),
    ));
    assert.ok(connection?.revokedAt instanceof Date);
    assert.equal(connection?.encryptedAccessToken, null);
    assert.equal(connection?.encryptedRefreshToken, null);
  } finally {
    try {
      await app?.close();
      await db.delete(integrations).where(eq(integrations.ownerId, ownerId));
      await db.delete(oauthStates).where(eq(oauthStates.ownerId, ownerId));
      await sqlClient`DELETE FROM auth.users WHERE id = ${ownerId}`;
    } finally {
      await sqlClient.end({ timeout: 5 });
      globalThis.fetch = originalFetch;
      env.JIRA_CLIENT_ID = originalValues.clientId;
      env.JIRA_CLIENT_SECRET = originalValues.clientSecret;
      env.JIRA_REDIRECT_URI = originalValues.redirectUri;
      env.OAUTH_STATE_SECRET = originalValues.stateSecret;
      env.TOKEN_ENCRYPTION_KEY = originalValues.encryptionKey;
      env.WEB_ORIGIN = originalValues.webOrigin;
    }
  }
});
