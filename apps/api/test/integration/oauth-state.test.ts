import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db, sqlClient } from '@veylo/db/client';
import { integrations, oauthStates } from '@veylo/db/schema';
import { env } from '../../src/env.js';
import { integrationRoutes } from '../../src/routes/integrations.js';
import type {} from '../../src/auth.js';

const ownerId = randomUUID();
const otherOwnerId = randomUUID();

test('OAuth state is owner scoped and single-use; a late refresh cannot replace disconnect or reconnect', async () => {
  const originalFetch = globalThis.fetch;
  const originalValues = {
    googleClientId: env.GOOGLE_CLIENT_ID,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET,
    googleRedirectUri: env.GOOGLE_REDIRECT_URI,
    oauthStateSecret: env.OAUTH_STATE_SECRET,
    tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY,
    webOrigin: env.WEB_ORIGIN,
  };
  let tokenExchanges = 0;
  let app: FastifyInstance | undefined;

  env.GOOGLE_CLIENT_ID = 'google-client-id-for-test';
  env.GOOGLE_CLIENT_SECRET = 'google-client-secret-for-test';
  env.GOOGLE_REDIRECT_URI = 'https://api.veylo.test/v1/integrations/google/callback';
  env.OAUTH_STATE_SECRET = 'integration-test-state-secret-with-more-than-32-chars';
  env.TOKEN_ENCRYPTION_KEY = 'integration-test-provider-token-encryption-key';
  env.WEB_ORIGIN = 'https://app.veylo.test';
  globalThis.fetch = async (input) => {
    if (String(input) !== 'https://oauth2.googleapis.com/token') throw new Error(`Unexpected provider request: ${String(input)}`);
    tokenExchanges += 1;
    return new Response(JSON.stringify({
      access_token: 'test-google-access-token',
      refresh_token: 'test-google-refresh-token',
      expires_in: 3600,
      scope: 'openid email https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.events.owned',
      token_type: 'Bearer',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await sqlClient`INSERT INTO auth.users (id) VALUES (${ownerId}), (${otherOwnerId}) ON CONFLICT (id) DO NOTHING`;
    app = Fastify();
    app.decorateRequest('ownerId', null);
    app.addHook('preHandler', async (request: FastifyRequest) => {
      request.ownerId = request.headers.authorization === 'Bearer owner-token' ? ownerId
        : request.headers.authorization === 'Bearer other-owner-token' ? otherOwnerId : null;
    });
    app.register(integrationRoutes, { prefix: '/v1' });
    await app.ready();

    const denied = await app.inject({ method: 'POST', url: '/v1/integrations/google/connect' });
    assert.equal(denied.statusCode, 401, denied.body);

    const connect = await app.inject({
      method: 'POST', url: '/v1/integrations/google/connect',
      headers: { authorization: 'Bearer owner-token' },
      payload: { target: 'web' },
    });
    assert.equal(connect.statusCode, 200, connect.body);
    const authorizationUrl = new URL(connect.json<{ authorizationUrl: string }>().authorizationUrl);
    const state = authorizationUrl.searchParams.get('state');
    assert.ok(state);
    const [storedState] = await db.select().from(oauthStates).where(eq(oauthStates.ownerId, ownerId));
    assert.ok(storedState);
    assert.notEqual(storedState.stateHash, state, 'only a hash of the bearer state should be stored');
    assert.equal(storedState.provider, 'google_calendar');
    assert.ok(storedState.expiresAt.getTime() > Date.now());

    const code = 'one-time-google-code';
    const callback = `/v1/integrations/google/callback?${new URLSearchParams({ code, state })}`;
    const forwarded = await app.inject({ method: 'GET', url: callback });
    assert.equal(forwarded.statusCode, 302, forwarded.body);
    const callbackUrl = new URL(forwarded.headers.location!);
    const forwardedOAuth = new URLSearchParams(callbackUrl.hash.slice(1));
    assert.equal(forwardedOAuth.get('oauth_provider'), 'google');
    assert.equal(forwardedOAuth.get('oauth_code'), code);
    assert.equal(forwardedOAuth.get('oauth_state'), state);
    assert.equal(callbackUrl.searchParams.has('oauth_code'), false, 'provider codes stay out of request URLs and referrers');
    assert.equal(forwarded.headers['cache-control'], 'no-store');
    assert.equal(tokenExchanges, 0, 'the provider callback must not exchange a code before the Veylo user is authenticated');
    assert.equal((await db.select().from(oauthStates).where(eq(oauthStates.ownerId, ownerId))).length, 1);

    const unauthenticated = await app.inject({
      method: 'POST', url: '/v1/integrations/google/complete', payload: { code, state },
    });
    assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);
    assert.equal(tokenExchanges, 0);

    const wrongOwner = await app.inject({
      method: 'POST', url: '/v1/integrations/google/complete',
      headers: { authorization: 'Bearer other-owner-token' }, payload: { code, state },
    });
    assert.equal(wrongOwner.statusCode, 403, wrongOwner.body);
    assert.equal(tokenExchanges, 0, 'a different Veylo account cannot exchange this provider code');
    assert.equal((await db.select().from(oauthStates).where(eq(oauthStates.ownerId, ownerId))).length, 1,
      'a rejected account must not consume another account’s pending state');

    const firstUse = await app.inject({
      method: 'POST', url: '/v1/integrations/google/complete',
      headers: { authorization: 'Bearer owner-token' }, payload: { code, state },
    });
    assert.equal(firstUse.statusCode, 200, firstUse.body);
    assert.equal(firstUse.json<{ connected: boolean; provider: string }>().connected, true);
    assert.equal(tokenExchanges, 1);
    const remainingState = await db.select().from(oauthStates).where(eq(oauthStates.ownerId, ownerId));
    assert.equal(remainingState.length, 0, 'successful callbacks consume OAuth state');

    const replay = await app.inject({
      method: 'POST', url: '/v1/integrations/google/complete',
      headers: { authorization: 'Bearer owner-token' }, payload: { code, state },
    });
    assert.equal(replay.statusCode, 400, replay.body);
    assert.match(replay.json<{ message: string }>().message, /already used or expired/i);
    assert.equal(tokenExchanges, 1, 'a replay must not exchange the provider code again');
    const [savedConnection] = await db.select().from(integrations).where(and(
      eq(integrations.ownerId, ownerId), eq(integrations.provider, 'google_calendar'),
    ));
    assert.ok(savedConnection?.encryptedRefreshToken);
    assert.notEqual(savedConnection.encryptedRefreshToken, 'test-google-refresh-token');

    let markRefreshStarted!: () => void;
    const refreshStarted = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Google token refresh did not start.')), 10_000);
      markRefreshStarted = () => { clearTimeout(timeout); resolve(); };
    });
    let completeRefresh!: (response: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => { completeRefresh = resolve; });
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') {
        markRefreshStarted();
        return refreshResponse;
      }
      if (url === 'https://oauth2.googleapis.com/revoke') return new Response(null, { status: 200 });
      throw new Error(`Unexpected provider request during refresh race: ${url}`);
    };
    await db.update(integrations).set({ accessTokenExpiresAt: new Date(0) }).where(eq(integrations.id, savedConnection.id));
    const availability = app.inject({
      method: 'POST', url: '/v1/integrations/google/availability',
      headers: { authorization: 'Bearer owner-token' },
      payload: { startsAt: '2026-10-10T09:00:00.000Z', endsAt: '2026-10-10T17:00:00.000Z', timezone: 'UTC' },
    });
    await refreshStarted;
    const disconnected = await app.inject({
      method: 'DELETE', url: '/v1/integrations/google', headers: { authorization: 'Bearer owner-token' },
    });
    assert.equal(disconnected.statusCode, 200, disconnected.body);
    const [afterDisconnect] = await db.select().from(integrations).where(eq(integrations.id, savedConnection.id));
    assert.ok(afterDisconnect?.revokedAt);
    assert.equal(afterDisconnect?.encryptedAccessToken, null);
    assert.equal(afterDisconnect?.encryptedRefreshToken, null);

    // Model a new OAuth completion for the same unique provider row before the
    // old refresh response arrives. The newer connection must retain its token.
    const newerRefreshToken = 'newer-connection-refresh-token-ciphertext';
    await db.update(integrations).set({
      encryptedRefreshToken: newerRefreshToken, encryptedAccessToken: null,
      accessTokenExpiresAt: null, revokedAt: null,
    }).where(eq(integrations.id, savedConnection.id));
    completeRefresh(new Response(JSON.stringify({
      access_token: 'late-google-access-token', refresh_token: 'rotated-google-refresh-token', expires_in: 3600,
      scope: 'openid email https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.events.owned',
      token_type: 'Bearer',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const refreshResult = await availability;
    assert.equal(refreshResult.statusCode, 409, refreshResult.body);
    const [reconnected] = await db.select().from(integrations).where(eq(integrations.id, savedConnection.id));
    assert.equal(reconnected?.revokedAt, null);
    assert.equal(reconnected?.encryptedAccessToken, null, 'late refresh must not restore a stale access token');
    assert.equal(reconnected?.encryptedRefreshToken, newerRefreshToken, 'late refresh must not overwrite the newer connection');
  } finally {
    try {
      await app?.close();
      await db.delete(integrations).where(eq(integrations.ownerId, ownerId));
      await db.delete(oauthStates).where(eq(oauthStates.ownerId, ownerId));
      await sqlClient`DELETE FROM auth.users WHERE id IN (${ownerId}, ${otherOwnerId})`;
    } finally {
      await sqlClient.end({ timeout: 5 });
      globalThis.fetch = originalFetch;
      env.GOOGLE_CLIENT_ID = originalValues.googleClientId;
      env.GOOGLE_CLIENT_SECRET = originalValues.googleClientSecret;
      env.GOOGLE_REDIRECT_URI = originalValues.googleRedirectUri;
      env.OAUTH_STATE_SECRET = originalValues.oauthStateSecret;
      env.TOKEN_ENCRYPTION_KEY = originalValues.tokenEncryptionKey;
      env.WEB_ORIGIN = originalValues.webOrigin;
    }
  }
});
