import { icloudCredentialsSchema, discoverIcloudCalendars, readIcloudEntries } from '../icloud-calendar.js';
import { additionalProviders, providerLabels, providerRoute, providerPrefix, providerConfigured, connectionIsActive, authorizationUrl, pkceVerifier, exchangeProviderToken, providerScopes, readProviderEntries, type ConnectionProvider, type AdditionalProvider, type ProviderConfig } from '../connection-providers.js';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { db } from '@veylo/db/client';
import { integrations, intentions, oauthStates, pushDevices, timeBlocks } from '@veylo/db/schema';
import { timeZoneSchema } from '@veylo/domain';
import { env } from '../env.js';
import { resolveSupabaseAdminKey } from '../supabase-admin-key.js';
import { requireOwner } from '../auth.js';
import { hasRequiredScopes } from '../google-scopes.js';
import { googleBusyWindows, googleFreeBusyRequest } from '../google-freebusy.js';
import { googleEventPayload } from '../google-event.js';
import { jiraAssignedIssuesQuery, jiraIssueReferences, jiraSiteBase } from '../jira-issues.js';
import { notionHeaders, notionPagePagination, notionPageReference, notionSearchPayload } from '../notion-pagination.js';

const scopes = ['https://www.googleapis.com/auth/calendar.freebusy', 'https://www.googleapis.com/auth/calendar.events.owned'];
const jiraTokenRefreshes = new Map<string, Promise<{ token: string; cloudId: string }>>();
const notionTokenRefreshes = new Map<string, Promise<string>>();
const toBase64Url = (value: Buffer | string) => Buffer.from(value).toString('base64url');
const fromBase64Url = (value: string) => Buffer.from(value, 'base64url');
const problem = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const PROVIDER_REQUEST_TIMEOUT_MS = 20_000;

function providerFetch(url: string, init: RequestInit = {}) {
  const timeout = AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(url, { ...init, signal });
}

function assertProviderConfigured(provider: ConnectionProvider) {
  if (!providerConfigured(provider, env)) throw problem(`${providerLabels[provider]} is not available in this Veylo installation yet. Ask your administrator to finish connection setup.`, 409);
}
function assertConfigured() { assertProviderConfigured('google_calendar'); }
function assertStateConfigured() {
  if (!env.OAUTH_STATE_SECRET) throw problem('OAuth state signing is not configured on this server.', 503);
}
function assertTokenEncryptionConfigured() {
  if (!env.TOKEN_ENCRYPTION_KEY) throw problem('Provider token encryption is not configured on this server.', 503);
}
function encryptionKey() {
  assertTokenEncryptionConfigured();
  // Normalize generated platform secrets and local secrets to an AES-256 key.
  return createHash('sha256').update(env.TOKEN_ENCRYPTION_KEY!, 'utf8').digest();
}
function encrypt(value: string) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `v1.${toBase64Url(iv)}.${toBase64Url(cipher.getAuthTag())}.${toBase64Url(body)}`;
}
function decrypt(value: string) {
  const [version, iv, tag, body] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !body) throw problem('Stored connection token has an unknown format.', 500);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), fromBase64Url(iv));
  decipher.setAuthTag(fromBase64Url(tag));
  return Buffer.concat([decipher.update(fromBase64Url(body)), decipher.final()]).toString('utf8');
}
async function signState(ownerId: string, returnTo: string, provider: ConnectionProvider = 'google_calendar') {
  assertStateConfigured();
  const expires = Date.now() + 10 * 60_000;
  const payload = toBase64Url(JSON.stringify({ ownerId, returnTo, provider, expires, nonce: toBase64Url(randomBytes(16)) }));
  const signature = createHmac('sha256', env.OAUTH_STATE_SECRET!).update(payload).digest();
  const state = `${payload}.${toBase64Url(signature)}`;
  await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));
  await db.insert(oauthStates).values({
    stateHash: createHash('sha256').update(state).digest('hex'), ownerId, provider, expiresAt: new Date(expires),
  });
  return state;
}
function readState(value: string) {
  assertStateConfigured();
  const [payload, signature] = value.split('.');
  if (!payload || !signature) throw problem('Invalid provider authorization state.');
  const expected = createHmac('sha256', env.OAUTH_STATE_SECRET!).update(payload).digest();
  const actual = fromBase64Url(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw problem('Invalid provider authorization state.');
  const content = JSON.parse(fromBase64Url(payload).toString('utf8')) as { ownerId: string; returnTo: string; provider: ConnectionProvider; expires: number };
  if (content.expires < Date.now()) throw problem('Provider authorization expired. Start the connection again.');
  return content;
}
async function consumeState(value: string, expectedProvider: ConnectionProvider, authenticatedOwnerId: string) {
  const content = readState(value);
  if (content.provider !== expectedProvider) throw problem('Invalid provider authorization state.');
  if (content.ownerId !== authenticatedOwnerId) throw problem('Sign in to the Veylo account that started this provider connection.', 403);
  const stateHash = createHash('sha256').update(value).digest('hex');
  const [consumed] = await db.delete(oauthStates).where(and(
    eq(oauthStates.stateHash, stateHash), eq(oauthStates.ownerId, content.ownerId),
    eq(oauthStates.provider, expectedProvider), gt(oauthStates.expiresAt, new Date()),
  )).returning({ stateHash: oauthStates.stateHash });
  if (!consumed) throw problem('Provider authorization state was already used or expired. Start the connection again.');
  return content;
}
async function pendingState(value: string, expectedProvider: ConnectionProvider) {
  const content = readState(value);
  if (content.provider !== expectedProvider) throw problem('Invalid provider authorization state.');
  const stateHash = createHash('sha256').update(value).digest('hex');
  const [pending] = await db.select({ stateHash: oauthStates.stateHash }).from(oauthStates).where(and(
    eq(oauthStates.stateHash, stateHash), eq(oauthStates.ownerId, content.ownerId),
    eq(oauthStates.provider, expectedProvider), gt(oauthStates.expiresAt, new Date()),
  )).limit(1);
  if (!pending) throw problem('Provider authorization state was already used or expired. Start the connection again.');
  return content;
}
async function forwardOAuthCallback(
  reply: FastifyReply,
  query: { code?: string; state?: string; error?: string },
  expectedProvider: ConnectionProvider,
) {
  let returnTo: string | undefined;
  try {
    if (!query.state) throw problem('Provider did not return an authorization state.');
    returnTo = (await pendingState(query.state, expectedProvider)).returnTo;
    const target = new URL(returnTo);
    target.searchParams.set('view', 'connections');
    if (query.error) {
      const label = providerLabels[expectedProvider];
      target.searchParams.set('connection_error', `${label} access was declined.`);
      target.searchParams.set('connection_provider', providerRoute(expectedProvider));
    } else if (!query.code) {
      target.searchParams.set('connection_error', 'The provider did not return an authorization code.');
      target.searchParams.set('connection_provider', providerRoute(expectedProvider));
    } else {
      target.hash = new URLSearchParams({
        oauth_provider: providerRoute(expectedProvider),
        oauth_code: query.code,
        oauth_state: query.state,
      }).toString();
    }
    return reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer').redirect(target.toString());
  } catch (error) {
    const target = new URL(returnTo ?? env.WEB_ORIGIN);
    target.searchParams.set('view', 'connections');
    target.searchParams.set('connection_error', error instanceof Error ? error.message : 'Provider authorization could not complete.');
    return reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer').redirect(target.toString());
  }
}

async function googleToken(form: Record<string, string>) {
  const body = new URLSearchParams({ ...form, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET! });
  const response = await providerFetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok) throw problem(typeof result.error_description === 'string' ? result.error_description : 'Google could not complete authorization.', 502);
  return result as { access_token: string; refresh_token?: string; expires_in: number; scope: string; token_type: string };
}

function assertJiraConfigured() { assertProviderConfigured('jira_cloud'); }

async function jiraToken(form: Record<string, string>) {
  assertJiraConfigured();
  const response = await providerFetch('https://auth.atlassian.com/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ...form, client_id: env.JIRA_CLIENT_ID, client_secret: env.JIRA_CLIENT_SECRET }),
  });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok) throw problem(typeof result.error_description === 'string' ? result.error_description : 'Jira authorization could not be completed.', 502);
  return result as { access_token: string; refresh_token?: string; expires_in: number; scope: string; token_type: string };
}

async function jiraAccessToken(ownerId: string, forceRefresh = false) {
  const row = await getConnection(ownerId, 'jira_cloud');
  const metadata = row.metadata as { cloudId?: string };
  if (!metadata.cloudId || !row.encryptedRefreshToken) throw problem('Connect Jira Cloud first.', 409);
  if (!forceRefresh && row.encryptedAccessToken && row.accessTokenExpiresAt && row.accessTokenExpiresAt.getTime() > Date.now() + 60_000) {
    return { token: decrypt(row.encryptedAccessToken), cloudId: metadata.cloudId };
  }
  const pending = jiraTokenRefreshes.get(ownerId);
  if (pending) return pending;
  const refresh = (async () => {
    const latest = await getConnection(ownerId, 'jira_cloud');
    const latestMetadata = latest.metadata as { cloudId?: string };
    if (!latestMetadata.cloudId || !latest.encryptedRefreshToken) throw problem('Connect Jira Cloud first.', 409);
    if (!forceRefresh && latest.encryptedAccessToken && latest.accessTokenExpiresAt && latest.accessTokenExpiresAt.getTime() > Date.now() + 60_000) {
      return { token: decrypt(latest.encryptedAccessToken), cloudId: latestMetadata.cloudId };
    }
    const tokens = await jiraToken({ grant_type: 'refresh_token', refresh_token: decrypt(latest.encryptedRefreshToken) });
    if (!tokens.refresh_token) throw problem('Jira did not return a rotated refresh token. Reconnect Jira Cloud.', 502);
    // Match the refresh token generation as well as active state: a late refresh must not undo a disconnect or newer OAuth grant.
    const [updated] = await db.update(integrations).set({
      encryptedAccessToken: encrypt(tokens.access_token), encryptedRefreshToken: encrypt(tokens.refresh_token),
      accessTokenExpiresAt: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000),
      scopes: tokens.scope?.split(/[ ,]+/) ?? latest.scopes,
    }).where(and(eq(integrations.id, latest.id), eq(integrations.encryptedRefreshToken, latest.encryptedRefreshToken!), isNull(integrations.revokedAt))).returning({ id: integrations.id });
    if (!updated) throw problem('Jira connection changed while its credentials were refreshing. Connect Jira again to continue.', 409);
    return { token: tokens.access_token, cloudId: latestMetadata.cloudId };
  })();
  jiraTokenRefreshes.set(ownerId, refresh);
  try { return await refresh; }
  finally { if (jiraTokenRefreshes.get(ownerId) === refresh) jiraTokenRefreshes.delete(ownerId); }
}

function assertNotionConfigured() { assertProviderConfigured('notion'); }

async function notionToken(form: Record<string, string>) {
  assertNotionConfigured();
  const basic = Buffer.from(`${env.NOTION_CLIENT_ID}:${env.NOTION_CLIENT_SECRET}`).toString('base64');
  const response = await providerFetch('https://api.notion.com/v1/oauth/token', {
    method: 'POST', headers: notionHeaders(`Basic ${basic}`),
    body: JSON.stringify(form),
  });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok) throw problem(typeof result.error === 'string' ? result.error : 'Notion authorization could not be completed.', 502);
  return result as { access_token: string; refresh_token: string; expires_in?: number; workspace_id: string; workspace_name?: string | null; bot_id?: string };
}

async function notionAccessToken(ownerId: string, forceRefresh = false): Promise<string> {
  const row = await getConnection(ownerId, 'notion');
  if (!forceRefresh && row.encryptedAccessToken && row.accessTokenExpiresAt && row.accessTokenExpiresAt.getTime() > Date.now() + 60_000) return decrypt(row.encryptedAccessToken);
  const pending = notionTokenRefreshes.get(ownerId);
  if (pending) return pending;
  const refresh = (async () => {
    const latest = await getConnection(ownerId, 'notion');
    if (!latest.encryptedRefreshToken) throw problem('Reconnect Notion to continue.', 409);
    if (!forceRefresh && latest.encryptedAccessToken && latest.accessTokenExpiresAt && latest.accessTokenExpiresAt.getTime() > Date.now() + 60_000) return decrypt(latest.encryptedAccessToken);
    const tokens = await notionToken({ grant_type: 'refresh_token', refresh_token: decrypt(latest.encryptedRefreshToken) });
    if (!tokens.refresh_token) throw problem('Notion did not return a rotated refresh token. Reconnect Notion.', 502);
    const [updated] = await db.update(integrations).set({
      encryptedAccessToken: encrypt(tokens.access_token), encryptedRefreshToken: encrypt(tokens.refresh_token),
      accessTokenExpiresAt: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000),
    }).where(and(eq(integrations.id, latest.id), eq(integrations.encryptedRefreshToken, latest.encryptedRefreshToken!), isNull(integrations.revokedAt))).returning({ id: integrations.id });
    if (!updated) throw problem('Notion connection changed while its credentials were refreshing. Connect Notion again to continue.', 409);
    return tokens.access_token;
  })();
  notionTokenRefreshes.set(ownerId, refresh);
  try { return await refresh; }
  finally { if (notionTokenRefreshes.get(ownerId) === refresh) notionTokenRefreshes.delete(ownerId); }
}

async function getConnection(ownerId: string, provider = 'google_calendar') {
  const [row] = await db.select().from(integrations).where(and(
    eq(integrations.ownerId, ownerId), eq(integrations.provider, provider), isNull(integrations.revokedAt),
  )).limit(1);
  if (!row || !connectionIsActive(row)) throw problem(`Connect ${providerLabels[provider as ConnectionProvider] ?? provider} first.`, 409);
  return row;
}

async function accessToken(ownerId: string, forceRefresh = false) {
  const row = await getConnection(ownerId);
  if (!forceRefresh && row.encryptedAccessToken && row.accessTokenExpiresAt && row.accessTokenExpiresAt.getTime() > Date.now() + 60_000) return decrypt(row.encryptedAccessToken);
  const refreshToken = decrypt(row.encryptedRefreshToken!);
  const tokens = await googleToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
  const expiresAt = new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000);
  const [updated] = await db.update(integrations).set({ encryptedAccessToken: encrypt(tokens.access_token), accessTokenExpiresAt: expiresAt })
    .where(and(eq(integrations.id, row.id), eq(integrations.encryptedRefreshToken, row.encryptedRefreshToken!), isNull(integrations.revokedAt))).returning({ id: integrations.id });
  if (!updated) throw problem('Google Calendar connection changed while its credentials were refreshing. Connect it again to continue.', 409);
  return tokens.access_token;
}

async function calendarApi(ownerId: string, path: string, init: RequestInit = {}) {
  const send = (token: string) => providerFetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  let response = await send(await accessToken(ownerId));
  if (response.status === 401) response = await send(await accessToken(ownerId, true));
  const result = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = result as { error?: { message?: string } };
    throw problem(error?.error?.message || `Google Calendar returned ${response.status}.`, response.status === 401 ? 502 : 502);
  }
  return result as Record<string, any> | null;
}

function additionalConfig(provider: AdditionalProvider): ProviderConfig {
  assertProviderConfigured(provider);
  const config = env as Record<string, unknown>; const prefix = providerPrefix(provider);
  return { clientId: config[`${prefix}_CLIENT_ID`] as string, clientSecret: config[`${prefix}_CLIENT_SECRET`] as string, redirectUri: config[`${prefix}_REDIRECT_URI`] as string };
}
const additionalRefreshes = new Map<string, Promise<{ token: string; encryptedToken: string }>>();
async function additionalAccessToken(ownerId: string, provider: AdditionalProvider) {
  const row = await getConnection(ownerId, provider);
  if (row.encryptedAccessToken && (!row.accessTokenExpiresAt || row.accessTokenExpiresAt.getTime() > Date.now() + 60_000)) {
    return { token: decrypt(row.encryptedAccessToken), encryptedToken: row.encryptedAccessToken };
  }
  const key = `${ownerId}:${provider}`; const pending = additionalRefreshes.get(key);
  if (pending) return pending;
  const refresh = (async () => {
    const latest = await getConnection(ownerId, provider);
    if (!latest.encryptedRefreshToken) throw problem('Reconnect this account to restore access.', 409);
    const tokens = await exchangeProviderToken(provider, additionalConfig(provider), { grant_type: 'refresh_token', refresh_token: decrypt(latest.encryptedRefreshToken) });
    const encryptedToken = encrypt(tokens.access_token);
    const [updated] = await db.update(integrations).set({
      encryptedAccessToken: encryptedToken,
      encryptedRefreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : latest.encryptedRefreshToken,
      accessTokenExpiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
    }).where(and(eq(integrations.id, latest.id), eq(integrations.encryptedRefreshToken, latest.encryptedRefreshToken), isNull(integrations.revokedAt))).returning({ id: integrations.id });
    if (!updated) throw problem('This connection changed. Refresh and try again.', 409);
    return { token: tokens.access_token, encryptedToken };
  })();
  additionalRefreshes.set(key, refresh);
  try { return await refresh; } finally { if (additionalRefreshes.get(key) === refresh) additionalRefreshes.delete(key); }
}

export const integrationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); });
  app.delete('/account', async (request, reply) => {
    const ownerId = requireOwner(request);
    const adminKey = resolveSupabaseAdminKey(env.SUPABASE_SECRET_KEY, env.SUPABASE_SERVICE_ROLE_KEY);
    if (!adminKey) throw problem('Account deletion is not configured on this server.', 503);
    const connections = await db.select().from(integrations).where(and(
      eq(integrations.ownerId, ownerId), isNull(integrations.revokedAt),
    ));
    const externalRevocationWarnings: string[] = [];
    for (const connection of connections) {
      if (connection.provider === 'icloud') externalRevocationWarnings.push('Revoke Veylo’s app-specific password in your Apple Account settings.');
      if (additionalProviders.includes(connection.provider as AdditionalProvider)) {
        externalRevocationWarnings.push(`Remove Veylo from ${providerLabels[connection.provider as AdditionalProvider]}'s connected-app settings to revoke its remaining grant.`);
      }
    }
    const google = connections.find((connection) => connection.provider === 'google_calendar');
    const notion = connections.find((connection) => connection.provider === 'notion');
    const jira = connections.find((connection) => connection.provider === 'jira_cloud');
    if (google?.encryptedRefreshToken || google?.encryptedAccessToken) {
      try {
        const response = await providerFetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: decrypt(google.encryptedRefreshToken ?? google.encryptedAccessToken!) }),
        });
        if (!response.ok) {
          externalRevocationWarnings.push('Google Calendar access could not be revoked automatically. Remove Veylo from https://myaccount.google.com/connections.');
          request.log.warn({ provider: 'google_calendar', statusCode: response.status }, 'Provider access revocation failed during account deletion');
        }
      } catch (error) {
        externalRevocationWarnings.push('Google Calendar access could not be revoked automatically. Remove Veylo from https://myaccount.google.com/connections.');
        request.log.warn({ provider: 'google_calendar', errorName: error instanceof Error ? error.name : 'UnknownError' }, 'Provider access revocation failed during account deletion');
      }
    }
    if (notion?.encryptedAccessToken || notion?.encryptedRefreshToken) {
      if (!env.NOTION_CLIENT_ID || !env.NOTION_CLIENT_SECRET) {
        externalRevocationWarnings.push('Notion access could not be revoked automatically. Remove Veylo from your Notion settings under Connections.');
      } else {
        try {
          const credentials = Buffer.from(`${env.NOTION_CLIENT_ID}:${env.NOTION_CLIENT_SECRET}`).toString('base64');
          const response = await providerFetch('https://api.notion.com/v1/oauth/revoke', {
            method: 'POST',
            headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/json', 'Notion-Version': '2026-03-11' },
            body: JSON.stringify({ token: decrypt(notion.encryptedAccessToken ?? notion.encryptedRefreshToken!) }),
          });
          if (!response.ok) {
            externalRevocationWarnings.push('Notion access could not be revoked automatically. Remove Veylo from your Notion settings under Connections.');
            request.log.warn({ provider: 'notion', statusCode: response.status }, 'Provider access revocation failed during account deletion');
          }
        } catch (error) {
          externalRevocationWarnings.push('Notion access could not be revoked automatically. Remove Veylo from your Notion settings under Connections.');
          request.log.warn({ provider: 'notion', errorName: error instanceof Error ? error.name : 'UnknownError' }, 'Provider access revocation failed during account deletion');
        }
      }
    }
    if (jira) externalRevocationWarnings.push('Jira access was disconnected from Veylo, but Atlassian requires you to remove its grant at https://id.atlassian.com/manage-profile/apps.');
    await db.delete(pushDevices).where(eq(pushDevices.ownerId, ownerId));
    const admin = createClient(env.SUPABASE_URL, adminKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await admin.auth.admin.deleteUser(ownerId);
    if (error) throw problem('Your account could not be deleted. Try again or contact support.', 502);
    return { deleted: true, externalRevocationWarnings };
  });

  app.get('/integrations/catalog', async (request) => {
    requireOwner(request);
    return { providers: (Object.keys(providerLabels) as ConnectionProvider[]).map((provider) => ({
      provider, configured: providerConfigured(provider, env),
    })) };
  });

  app.post('/integrations/icloud/connect', async (request) => {
    const ownerId = requireOwner(request); assertProviderConfigured('icloud');
    const parsed = icloudCredentialsSchema.safeParse(request.body);
    if (!parsed.success) throw problem('Enter your Apple Account email and an app-specific password in xxxx-xxxx-xxxx-xxxx format.', 400);
    const credentials = parsed.data;
    await discoverIcloudCalendars(credentials);
    const values = { ownerId, provider: 'icloud', encryptedAccessToken: encrypt(JSON.stringify(credentials)),
      encryptedRefreshToken: null, accessTokenExpiresAt: null, scopes: ['calendar:read'], metadata: {}, revokedAt: null };
    await db.insert(integrations).values(values).onConflictDoUpdate({ target: [integrations.ownerId, integrations.provider], set: { ...values, connectedAt: new Date() } });
    return { connected: true, provider: 'icloud' };
  });
  app.get('/integrations/icloud/entries', async (request) => {
    const ownerId = requireOwner(request); const row = await getConnection(ownerId, 'icloud');
    if (!row.encryptedAccessToken) throw problem('Reconnect iCloud Calendar to restore access.', 409);
    const result = await readIcloudEntries(icloudCredentialsSchema.parse(JSON.parse(decrypt(row.encryptedAccessToken))));
    const [current] = await db.update(integrations).set({ lastSyncedAt: new Date() }).where(and(
      eq(integrations.id, row.id), eq(integrations.encryptedAccessToken, row.encryptedAccessToken), isNull(integrations.revokedAt),
    )).returning({ id: integrations.id });
    if (!current) throw problem('This connection changed. Refresh and try again.', 409);
    return result;
  });
  app.delete('/integrations/icloud', async (request) => {
    const ownerId = requireOwner(request);
    await db.update(integrations).set({ encryptedAccessToken: null, encryptedRefreshToken: null, revokedAt: new Date() })
      .where(and(eq(integrations.ownerId, ownerId), eq(integrations.provider, 'icloud')));
    return { revocationWarning: 'iCloud disconnected from Veylo. Revoke its app-specific password in your Apple Account settings.' };
  });

  for (const provider of additionalProviders) {
    app.post(`/integrations/${provider}/connect`, async (request) => {
      const ownerId = requireOwner(request); assertProviderConfigured(provider);
      const { target } = z.object({ target: z.enum(['web', 'mobile']).default('web') }).parse(request.body ?? {});
      const state = await signState(ownerId, target === 'mobile' ? env.MOBILE_REDIRECT_URI : env.WEB_ORIGIN, provider);
      return { authorizationUrl: authorizationUrl(provider, additionalConfig(provider), state, pkceVerifier(state, env.OAUTH_STATE_SECRET!)) };
    });
    app.get(`/integrations/${provider}/callback`, async (request, reply) =>
      forwardOAuthCallback(reply, request.query as { code?: string; state?: string; error?: string }, provider));
    app.post(`/integrations/${provider}/complete`, async (request) => {
      const authenticatedOwnerId = requireOwner(request); assertProviderConfigured(provider);
      const { code, state } = z.object({ code: z.string().min(1).max(4096), state: z.string().min(1).max(4096) }).parse(request.body);
      const { ownerId } = await consumeState(state, provider, authenticatedOwnerId);
      const tokens = await exchangeProviderToken(provider, additionalConfig(provider), {
        grant_type: 'authorization_code', code, code_verifier: pkceVerifier(state, env.OAUTH_STATE_SECRET!),
      });
      const values = {
        ownerId, provider, encryptedAccessToken: encrypt(tokens.access_token),
        encryptedRefreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
        accessTokenExpiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
        scopes: tokens.scope?.split(/[ ,]+/) ?? providerScopes[provider], revokedAt: null, metadata: {},
      };
      await db.insert(integrations).values(values).onConflictDoUpdate({ target: [integrations.ownerId, integrations.provider], set: { ...values, connectedAt: new Date() } });
      return { connected: true, provider };
    });
    app.get(`/integrations/${provider}/entries`, async (request) => {
      const ownerId = requireOwner(request);
      const { token, encryptedToken } = await additionalAccessToken(ownerId, provider);
      const result = await readProviderEntries(provider, token);
      const [current] = await db.update(integrations).set({ lastSyncedAt: new Date() }).where(and(
        eq(integrations.ownerId, ownerId), eq(integrations.provider, provider),
        eq(integrations.encryptedAccessToken, encryptedToken), isNull(integrations.revokedAt),
      )).returning({ id: integrations.id });
      if (!current) throw problem('This connection changed. Refresh and try again.', 409);
      return result;
    });
    app.delete(`/integrations/${provider}`, async (request) => {
      const ownerId = requireOwner(request);
      await db.update(integrations).set({ encryptedAccessToken: null, encryptedRefreshToken: null, revokedAt: new Date() })
        .where(and(eq(integrations.ownerId, ownerId), eq(integrations.provider, provider)));
      return { revocationWarning: `${providerLabels[provider]} disconnected from Veylo. You can also remove Veylo from your provider’s connected-app settings.` };
    });
  }

  app.get('/integrations', async (request) => {
    const ownerId = requireOwner(request);
    const rows = await db.select().from(integrations).where(eq(integrations.ownerId, ownerId));
    return { integrations: rows.map((row) => ({
      provider: row.provider, connected: connectionIsActive(row),
      scopes: row.scopes, connectedAt: row.connectedAt.toISOString(),
      siteName: row.provider === 'jira_cloud' ? (row.metadata as { siteName?: string }).siteName ?? null : null,
      workspaceName: row.provider === 'notion' ? (row.metadata as { workspaceName?: string }).workspaceName ?? null : null,
      lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    })) };
  });

  app.post('/integrations/google/connect', async (request) => {
    const ownerId = requireOwner(request); assertConfigured();
    const target = z.object({ target: z.enum(['web', 'mobile']).default('web') }).parse(request.body ?? {});
    const returnTo = target.target === 'mobile' ? env.MOBILE_REDIRECT_URI : env.WEB_ORIGIN;
    const state = await signState(ownerId, returnTo, 'google_calendar');
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID!);
    url.searchParams.set('redirect_uri', env.GOOGLE_REDIRECT_URI!);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('scope', ['openid', 'email', ...scopes].join(' '));
    url.searchParams.set('state', state);
    return { authorizationUrl: url.toString() };
  });

  app.post('/integrations/jira/connect', async (request) => {
    const ownerId = requireOwner(request); assertJiraConfigured();
    const target = z.object({ target: z.enum(['web', 'mobile']).default('web') }).parse(request.body ?? {});
    const returnTo = target.target === 'mobile' ? env.MOBILE_REDIRECT_URI : env.WEB_ORIGIN;
    const state = await signState(ownerId, returnTo, 'jira_cloud');
    const url = new URL('https://auth.atlassian.com/authorize');
    url.searchParams.set('audience', 'api.atlassian.com'); url.searchParams.set('client_id', env.JIRA_CLIENT_ID!);
    url.searchParams.set('scope', 'read:jira-work offline_access'); url.searchParams.set('redirect_uri', env.JIRA_REDIRECT_URI!);
    url.searchParams.set('state', state); url.searchParams.set('response_type', 'code'); url.searchParams.set('prompt', 'consent');
    return { authorizationUrl: url.toString() };
  });

  app.post('/integrations/notion/connect', async (request) => {
    const ownerId = requireOwner(request); assertNotionConfigured();
    const target = z.object({ target: z.enum(['web', 'mobile']).default('web') }).parse(request.body ?? {});
    const returnTo = target.target === 'mobile' ? env.MOBILE_REDIRECT_URI : env.WEB_ORIGIN;
    const state = await signState(ownerId, returnTo, 'notion');
    const url = new URL('https://api.notion.com/v1/oauth/authorize');
    url.searchParams.set('client_id', env.NOTION_CLIENT_ID!); url.searchParams.set('redirect_uri', env.NOTION_REDIRECT_URI!);
    url.searchParams.set('response_type', 'code'); url.searchParams.set('owner', 'user'); url.searchParams.set('state', state);
    return { authorizationUrl: url.toString() };
  });

  app.get('/integrations/notion/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };
    return forwardOAuthCallback(reply, query, 'notion');
  });

  app.post('/integrations/notion/complete', async (request) => {
    const authenticatedOwnerId = requireOwner(request);
    const { code, state } = z.object({ code: z.string().min(1).max(4096), state: z.string().min(1).max(4096) }).parse(request.body);
    const { ownerId } = await consumeState(state, 'notion', authenticatedOwnerId);
    const tokens = await notionToken({ grant_type: 'authorization_code', code, redirect_uri: env.NOTION_REDIRECT_URI! });
    if (!tokens.refresh_token || !tokens.workspace_id) throw problem('Notion did not return the required workspace access. Reconnect Notion.', 502);
    const metadata = { workspaceId: tokens.workspace_id, workspaceName: tokens.workspace_name ?? 'Notion workspace', botId: tokens.bot_id ?? null };
    const values = {
      ownerId, provider: 'notion', providerAccountId: tokens.workspace_id,
      encryptedAccessToken: encrypt(tokens.access_token), encryptedRefreshToken: encrypt(tokens.refresh_token),
      accessTokenExpiresAt: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000),
      scopes: [], revokedAt: null, metadata,
    };
    await db.insert(integrations).values(values).onConflictDoUpdate({ target: [integrations.ownerId, integrations.provider], set: { ...values, connectedAt: new Date() } });
    return { connected: true, provider: 'notion' };
  });

  app.get('/integrations/notion/pages', async (request) => {
    const ownerId = requireOwner(request);
    const query = z.object({ cursor: z.string().uuid().optional() }).safeParse(request.query);
    if (!query.success) throw problem('Notion page cursor is invalid.');
    const searchPages = (token: string) => providerFetch('https://api.notion.com/v1/search', {
      method: 'POST', headers: notionHeaders(`Bearer ${token}`),
      body: JSON.stringify(notionSearchPayload(query.data.cursor)),
    });
    let token = await notionAccessToken(ownerId);
    let response = await searchPages(token);
    if (response.status === 401) { token = await notionAccessToken(ownerId, true); response = await searchPages(token); }
    const result = await response.json() as { results?: Array<Record<string, any>>; message?: string; has_more?: boolean; next_cursor?: string | null };
    if (!response.ok) throw problem(result.message ?? `Notion page import failed (${response.status}).`, 502);
    await db.update(integrations).set({ lastSyncedAt: new Date() }).where(and(eq(integrations.ownerId, ownerId), eq(integrations.provider, 'notion')));
    const pages = (result.results ?? []).slice(0, 100)
      .map(notionPageReference)
      .filter((page): page is NonNullable<typeof page> => page !== null);
    return { pages, ...notionPagePagination(result) };
  });

  app.delete('/integrations/notion', async (request, reply) => {
    const ownerId = requireOwner(request);
    const [connection] = await db.select().from(integrations).where(and(
      eq(integrations.ownerId, ownerId), eq(integrations.provider, 'notion'), isNull(integrations.revokedAt),
    )).limit(1);
    let revocationWarning: string | undefined;
    const encryptedToken = connection?.encryptedAccessToken ?? connection?.encryptedRefreshToken;
    if (encryptedToken) {
      if (!env.NOTION_CLIENT_ID || !env.NOTION_CLIENT_SECRET) {
        revocationWarning = 'Notion disconnected from Veylo. Remove its remaining grant from Notion settings under Connections.';
      } else {
        try {
          const credentials = Buffer.from(`${env.NOTION_CLIENT_ID}:${env.NOTION_CLIENT_SECRET}`).toString('base64');
          const response = await providerFetch('https://api.notion.com/v1/oauth/revoke', {
            method: 'POST',
            headers: notionHeaders(`Basic ${credentials}`),
            body: JSON.stringify({ token: decrypt(encryptedToken) }),
          });
          if (!response.ok) revocationWarning = 'Notion disconnected from Veylo, but its grant could not be revoked automatically. Remove it from Notion settings under Connections.';
        } catch {
          revocationWarning = 'Notion disconnected from Veylo, but its grant could not be revoked automatically. Remove it from Notion settings under Connections.';
        }
      }
    }
    await db.update(integrations).set({ encryptedAccessToken: null, encryptedRefreshToken: null, revokedAt: new Date() })
      .where(and(eq(integrations.ownerId, ownerId), eq(integrations.provider, 'notion')));
    return { disconnected: true, ...(revocationWarning ? { revocationWarning } : {}) };
  });

  app.get('/integrations/jira/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };
    return forwardOAuthCallback(reply, query, 'jira_cloud');
  });

  app.post('/integrations/jira/complete', async (request) => {
    const authenticatedOwnerId = requireOwner(request);
    const { code, state } = z.object({ code: z.string().min(1).max(4096), state: z.string().min(1).max(4096) }).parse(request.body);
    const { ownerId } = await consumeState(state, 'jira_cloud', authenticatedOwnerId);
    const tokens = await jiraToken({ grant_type: 'authorization_code', code, redirect_uri: env.JIRA_REDIRECT_URI! });
    if (!tokens.refresh_token) throw problem('Jira did not grant offline access. Reconnect and approve the requested permissions.', 502);
    if (!tokens.scope?.split(' ').includes('read:jira-work')) throw problem('Jira read permission was not approved.', 403);
    const resourcesResponse = await providerFetch('https://api.atlassian.com/oauth/token/accessible-resources', {
      headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
    });
    const resources = await resourcesResponse.json() as Array<{ id: string; name: string; url: string; scopes?: string[] }>;
    if (!resourcesResponse.ok || !Array.isArray(resources)) throw problem('Jira could not list the sites available to this connection.', 502);
    const site = resources.find((resource) => resource.scopes?.includes('read:jira-work'));
    if (!site) throw problem('No Jira Cloud site is available for this account.', 403);
    if (typeof site.url !== 'string' || !jiraSiteBase(site.url)) throw problem('Jira returned an invalid secure site URL.', 502);
    const values = {
      ownerId, provider: 'jira_cloud', providerAccountId: site.id,
      encryptedAccessToken: encrypt(tokens.access_token), encryptedRefreshToken: encrypt(tokens.refresh_token),
      accessTokenExpiresAt: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000),
      scopes: tokens.scope?.split(/[ ,]+/) ?? site.scopes ?? [], revokedAt: null,
      metadata: { cloudId: site.id, siteName: site.name, siteUrl: site.url, accessibleResources: resources.map(({ id, name, url }) => ({ id, name, url })) },
    };
    await db.insert(integrations).values(values).onConflictDoUpdate({
      target: [integrations.ownerId, integrations.provider],
      set: { ...values, connectedAt: new Date() },
    });
    return { connected: true, provider: 'jira_cloud', siteName: site.name };
  });

  app.get('/integrations/jira/issues', async (request) => {
    const ownerId = requireOwner(request);
    const queryIssues = async (token: string, cloudId: string) => providerFetch(`https://api.atlassian.com/ex/jira/${encodeURIComponent(cloudId)}/rest/api/3/search/jql`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(jiraAssignedIssuesQuery),
    });
    let auth = await jiraAccessToken(ownerId);
    let response = await queryIssues(auth.token, auth.cloudId);
    if (response.status === 401) { auth = await jiraAccessToken(ownerId, true); response = await queryIssues(auth.token, auth.cloudId); }
    const result = await response.json() as { errorMessages?: string[] };
    if (!response.ok) throw problem(result.errorMessages?.[0] ?? `Jira issue import failed (${response.status}).`, 502);
    const [connection] = await db.select().from(integrations).where(and(eq(integrations.ownerId, ownerId), eq(integrations.provider, 'jira_cloud'))).limit(1);
    await db.update(integrations).set({ lastSyncedAt: new Date() }).where(and(eq(integrations.ownerId, ownerId), eq(integrations.provider, 'jira_cloud')));
    const metadata = (connection?.metadata ?? {}) as { siteUrl?: string; siteName?: string };
    return { siteName: metadata.siteName ?? 'Jira Cloud', issues: jiraIssueReferences(result, metadata.siteUrl ?? '') };
  });

  app.delete('/integrations/jira', async (request, reply) => {
    const ownerId = requireOwner(request);
    await db.update(integrations).set({ encryptedAccessToken: null, encryptedRefreshToken: null, revokedAt: new Date() })
      .where(and(eq(integrations.ownerId, ownerId), eq(integrations.provider, 'jira_cloud')));
    return reply.code(204).send();
  });

  // OAuth redirect endpoint: ownership is carried in the short-lived signed state.
  app.get('/integrations/google/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };
    return forwardOAuthCallback(reply, query, 'google_calendar');
  });

  app.post('/integrations/google/complete', async (request) => {
    const authenticatedOwnerId = requireOwner(request);
    const { code, state } = z.object({ code: z.string().min(1).max(4096), state: z.string().min(1).max(4096) }).parse(request.body);
    const { ownerId } = await consumeState(state, 'google_calendar', authenticatedOwnerId);
    const tokens = await googleToken({ grant_type: 'authorization_code', code, redirect_uri: env.GOOGLE_REDIRECT_URI! });
    if (!hasRequiredScopes(tokens.scope, scopes)) throw problem('Google Calendar permissions were not approved.');
    const refreshToken = tokens.refresh_token;
    if (!refreshToken) {
      const existing = await getConnection(ownerId);
      await db.update(integrations).set({
        encryptedAccessToken: encrypt(tokens.access_token), accessTokenExpiresAt: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000),
        scopes: tokens.scope.split(' '), revokedAt: null,
      }).where(eq(integrations.id, existing.id));
    } else {
      await db.insert(integrations).values({
        ownerId, provider: 'google_calendar', encryptedAccessToken: encrypt(tokens.access_token),
        encryptedRefreshToken: encrypt(refreshToken), accessTokenExpiresAt: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000),
        scopes: tokens.scope.split(' '), revokedAt: null,
      }).onConflictDoUpdate({
        target: [integrations.ownerId, integrations.provider],
        set: { encryptedAccessToken: encrypt(tokens.access_token), encryptedRefreshToken: encrypt(refreshToken),
          accessTokenExpiresAt: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000),
          scopes: tokens.scope.split(' '), revokedAt: null, connectedAt: new Date() },
      });
    }
    return { connected: true, provider: 'google_calendar' };
  });

  app.delete('/integrations/google', async (request, reply) => {
    const ownerId = requireOwner(request);
    const [row] = await db.select().from(integrations).where(and(eq(integrations.ownerId, ownerId), eq(integrations.provider, 'google_calendar'))).limit(1);
    const token = row?.encryptedRefreshToken ?? row?.encryptedAccessToken;
    let revocationWarning: string | undefined;
    if (row) {
      await db.update(integrations).set({ encryptedAccessToken: null, encryptedRefreshToken: null, revokedAt: new Date() }).where(eq(integrations.id, row.id));
    }
    if (token) {
      try {
        const providerToken = decrypt(token);
        const response = await providerFetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: providerToken }) });
        if (!response.ok) {
          revocationWarning = 'Google Calendar disconnected from Veylo, but access could not be revoked automatically. Remove Veylo from https://myaccount.google.com/connections.';
          request.log.warn({ statusCode: response.status }, 'Google token revocation was not confirmed during disconnect');
        }
      } catch {
        revocationWarning = 'Google Calendar disconnected from Veylo, but access could not be revoked automatically. Remove Veylo from https://myaccount.google.com/connections.';
        request.log.warn('Google token revocation could not be confirmed during disconnect');
      }
    }
    return { disconnected: true, ...(revocationWarning ? { revocationWarning } : {}) };
  });

  app.post('/integrations/google/availability', async (request) => {
    const ownerId = requireOwner(request);
    const parsed = z.object({ startsAt: z.string().datetime(), endsAt: z.string().datetime(), timezone: timeZoneSchema })
      .refine((value) => Date.parse(value.endsAt) > Date.parse(value.startsAt), { message: 'endsAt must be after startsAt' })
      .refine((value) => Date.parse(value.endsAt) - Date.parse(value.startsAt) <= 90 * 24 * 60 * 60 * 1000, { message: 'Availability range cannot exceed 90 days' })
      .safeParse(request.body);
    if (!parsed.success) throw problem(parsed.error.issues[0]?.message ?? 'Invalid availability range');
    const data = await calendarApi(ownerId, '/freeBusy', { method: 'POST', body: JSON.stringify(googleFreeBusyRequest(parsed.data.startsAt, parsed.data.endsAt, parsed.data.timezone)) });
    const windows = googleBusyWindows(data);
    await db.update(integrations).set({ lastSyncedAt: new Date() }).where(and(eq(integrations.ownerId, ownerId), eq(integrations.provider, 'google_calendar')));
    return { busy: windows };
  });

  app.post('/integrations/google/events', async (request, reply) => {
    const ownerId = requireOwner(request);
    const parsed = z.object({ timeBlockId: z.string().uuid() }).safeParse(request.body);
    if (!parsed.success) throw problem('Provide a saved time block to add to Google Calendar.');
    const [joined] = await db.select({ block: timeBlocks, intention: intentions }).from(timeBlocks)
      .innerJoin(intentions, eq(timeBlocks.intentionId, intentions.id))
      .where(and(eq(timeBlocks.id, parsed.data.timeBlockId), eq(timeBlocks.ownerId, ownerId), isNull(timeBlocks.deletedAt), isNull(intentions.deletedAt))).limit(1);
    if (!joined) throw problem('Time block was not found.', 404);
    if (joined.block.externalEventId) return { externalEventId: joined.block.externalEventId, externalUrl: joined.block.externalUrl, alreadyExists: true };
    const body = googleEventPayload({
      timeBlockId: joined.block.id,
      startsAt: joined.block.startsAt,
      endsAt: joined.block.endsAt,
      timezone: joined.block.timezone,
      title: joined.intention.title,
      intent: joined.intention.intent,
      purpose: joined.intention.purpose,
    });
    let event: Record<string, any> | null;
    try { event = await calendarApi(ownerId, '/calendars/primary/events', { method: 'POST', body: JSON.stringify(body) }); }
    catch (error) {
      if (!(error instanceof Error) || !/already exists|409/i.test(error.message)) throw error;
      event = await calendarApi(ownerId, `/calendars/primary/events/${body.id}`);
    }
    const [updated] = await db.update(timeBlocks).set({
      externalProvider: 'google_calendar', externalEventId: event?.id ?? body.id,
      externalUrl: typeof event?.htmlLink === 'string' ? event.htmlLink : null,
      syncState: 'synced', updatedAt: new Date(),
    }).where(and(eq(timeBlocks.id, joined.block.id), eq(timeBlocks.ownerId, ownerId))).returning();
    return reply.code(updated ? 201 : 200).send({ externalEventId: updated?.externalEventId, externalUrl: updated?.externalUrl, alreadyExists: false });
  });
};
