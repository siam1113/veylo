import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@clearhead/db/client';
import { integrations } from '@clearhead/db/schema';
import { decryptGoogleToken, encryptGoogleToken } from './google-calendar-crypto.js';

export { decryptGoogleToken, encryptGoogleToken };

export async function getGoogleConnection(integrationId: string) {
  const [row] = await db.select().from(integrations).where(and(
    eq(integrations.id, integrationId), eq(integrations.provider, 'google_calendar'), isNull(integrations.revokedAt),
  )).limit(1);
  if (!row || row.revokedAt || !(row.encryptedAccessToken || row.encryptedRefreshToken)) return null;
  return row;
}

async function refreshGoogleToken(refreshToken: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are not configured.');
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret });
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof result.error_description === 'string' ? result.error_description : 'Google could not refresh the access token.';
    // Google reports a dead refresh token (consent revoked, password changed, token expired)
    // as error: 'invalid_grant' - that can never succeed on retry, unlike a transient
    // network/5xx failure, so the caller stops retrying forever instead of re-queuing it.
    throw Object.assign(new Error(message), { code: typeof result.error === 'string' ? result.error : undefined });
  }
  return result as { access_token: string; expires_in: number };
}

export async function getGoogleAccessToken(integrationId: string, forceRefresh = false): Promise<string | null> {
  const row = await getGoogleConnection(integrationId);
  if (!row) return null;
  if (!forceRefresh && row.encryptedAccessToken && row.accessTokenExpiresAt && row.accessTokenExpiresAt.getTime() > Date.now() + 60_000) {
    return decryptGoogleToken(row.encryptedAccessToken);
  }
  if (!row.encryptedRefreshToken) return row.encryptedAccessToken ? decryptGoogleToken(row.encryptedAccessToken) : null;
  let tokens: { access_token: string; expires_in: number };
  try {
    tokens = await refreshGoogleToken(decryptGoogleToken(row.encryptedRefreshToken));
  } catch (error) {
    if ((error as { code?: string }).code === 'invalid_grant') {
      await db.update(integrations).set({ encryptedAccessToken: null, encryptedRefreshToken: null, revokedAt: new Date() })
        .where(and(eq(integrations.id, row.id), isNull(integrations.revokedAt)));
      return null;
    }
    throw error;
  }
  const expiresAt = new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000);
  const [updated] = await db.update(integrations).set({ encryptedAccessToken: encryptGoogleToken(tokens.access_token), accessTokenExpiresAt: expiresAt })
    .where(and(eq(integrations.id, row.id), eq(integrations.encryptedRefreshToken, row.encryptedRefreshToken), isNull(integrations.revokedAt))).returning({ id: integrations.id });
  if (!updated) return null; // Connection changed/disconnected mid-refresh; let the caller skip this tick.
  return tokens.access_token;
}

export async function calendarApiRequest(integrationId: string, path: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, any> | null }> {
  const send = async (token: string) => fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const token = await getGoogleAccessToken(integrationId);
  if (!token) return { status: 409, body: null };
  let response = await send(token);
  if (response.status === 401) {
    const refreshed = await getGoogleAccessToken(integrationId, true);
    if (!refreshed) return { status: 409, body: null };
    response = await send(refreshed);
  }
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, body };
}
