import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@clearhead/db/client';
import { integrations } from '@clearhead/db/schema';
import { decryptGoogleToken as decryptToken, encryptGoogleToken as encryptToken } from './google-calendar-crypto.js';

// google-calendar-crypto.ts's AES-256-GCM format is provider-agnostic despite its name
// (apps/api/src/routes/integrations.ts documents the exact byte format it must stay in
// sync with) - reused here rather than duplicated.

export async function getOutlookConnection(integrationId: string) {
  const [row] = await db.select().from(integrations).where(and(
    eq(integrations.id, integrationId), eq(integrations.provider, 'outlook'), isNull(integrations.revokedAt),
  )).limit(1);
  if (!row || row.revokedAt || !(row.encryptedAccessToken || row.encryptedRefreshToken)) return null;
  return row;
}

async function refreshOutlookToken(refreshToken: string) {
  const clientId = process.env.OUTLOOK_CLIENT_ID;
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('OUTLOOK_CLIENT_ID/OUTLOOK_CLIENT_SECRET are not configured.');
  const body = new URLSearchParams({
    grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret,
    scope: 'offline_access Calendars.ReadWrite',
  });
  const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof result.error_description === 'string' ? result.error_description : 'Microsoft could not refresh the access token.';
    // Azure AD reports a dead refresh token (consent revoked, password changed, token past
    // its absolute lifetime - e.g. AADSTS65001/70008/700082) as error: 'invalid_grant'. That
    // can never succeed on retry, unlike a transient network/5xx failure - tagging it here
    // lets the caller stop retrying forever instead of re-queuing the same doomed sync tick.
    throw Object.assign(new Error(message), { code: typeof result.error === 'string' ? result.error : undefined });
  }
  return result as { access_token: string; refresh_token?: string; expires_in: number };
}

export async function getOutlookAccessToken(integrationId: string, forceRefresh = false): Promise<string | null> {
  const row = await getOutlookConnection(integrationId);
  if (!row) return null;
  if (!forceRefresh && row.encryptedAccessToken && row.accessTokenExpiresAt && row.accessTokenExpiresAt.getTime() > Date.now() + 60_000) {
    return decryptToken(row.encryptedAccessToken);
  }
  if (!row.encryptedRefreshToken) return row.encryptedAccessToken ? decryptToken(row.encryptedAccessToken) : null;
  let tokens: { access_token: string; refresh_token?: string; expires_in: number };
  try {
    tokens = await refreshOutlookToken(decryptToken(row.encryptedRefreshToken));
  } catch (error) {
    if ((error as { code?: string }).code === 'invalid_grant') {
      // Revoking here (rather than just returning null) stops the hourly scheduler from ever
      // re-selecting this integration again (it filters on isNull(revokedAt)) - without this,
      // every future tick would retry the same unrecoverable refresh and fail the same way.
      await db.update(integrations).set({ encryptedAccessToken: null, encryptedRefreshToken: null, revokedAt: new Date() })
        .where(and(eq(integrations.id, row.id), isNull(integrations.revokedAt)));
      return null;
    }
    throw error;
  }
  const expiresAt = new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000);
  const [updated] = await db.update(integrations).set({
    encryptedAccessToken: encryptToken(tokens.access_token),
    // Microsoft may rotate the refresh token on use; keep whichever one it returns.
    ...(tokens.refresh_token ? { encryptedRefreshToken: encryptToken(tokens.refresh_token) } : {}),
    accessTokenExpiresAt: expiresAt,
  }).where(and(eq(integrations.id, row.id), eq(integrations.encryptedRefreshToken, row.encryptedRefreshToken), isNull(integrations.revokedAt))).returning({ id: integrations.id });
  if (!updated) return null; // Connection changed/disconnected mid-refresh; let the caller skip this tick.
  return tokens.access_token;
}

export async function graphApiRequest(integrationId: string, path: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, any> | null }> {
  // Graph's own @odata.nextLink/@odata.deltaLink are already-complete absolute URLs that
  // must be called as-is (they carry their own query params/version segment) - only a bare
  // path like "/me/calendarView/delta?..." needs the base URL prefixed on.
  const url = path.startsWith('https://') ? path : `https://graph.microsoft.com/v1.0${path}`;
  const send = async (token: string) => fetch(url, {
    ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const token = await getOutlookAccessToken(integrationId);
  if (!token) return { status: 409, body: null };
  let response = await send(token);
  if (response.status === 401) {
    const refreshed = await getOutlookAccessToken(integrationId, true);
    if (!refreshed) return { status: 409, body: null };
    response = await send(refreshed);
  }
  // Paginating a large calendarView expansion can trip Graph's rate limiter. Honor its
  // Retry-After hint a few times instead of failing the sync job outright - a hard failure
  // here discards all progress (no deltaLink persisted yet), so the next retry/scheduled
  // tick would otherwise redo the entire scan from scratch and hit the same limit again.
  for (let attempt = 0; response.status === 429 && attempt < 3; attempt++) {
    const retryAfterSeconds = Number(response.headers.get('retry-after')) || 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, Math.min(retryAfterSeconds, 30) * 1000));
    response = await send(token);
  }
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, body };
}
