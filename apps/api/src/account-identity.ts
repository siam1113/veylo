import { randomUUID } from 'node:crypto';
import type { ConnectionProvider } from './connection-providers.js';

export type AccountIdentity = { accountId: string; accountLabel: string; email?: string };

async function safeJson<T>(url: string, init: RequestInit): Promise<T | null> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch { return null; }
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}`, Accept: 'application/json' });

async function lookupGoogle(token: string): Promise<Partial<AccountIdentity> | null> {
  const user = await safeJson<{ sub?: string; email?: string }>('https://openidconnect.googleapis.com/v1/userinfo', { headers: bearer(token) });
  if (!user?.sub) return null;
  return { accountId: user.sub, email: user.email, accountLabel: user.email ?? user.sub };
}

async function lookupMicrosoftGraph(token: string): Promise<Partial<AccountIdentity> | null> {
  const user = await safeJson<{ id?: string; mail?: string | null; userPrincipalName?: string; displayName?: string }>('https://graph.microsoft.com/v1.0/me', { headers: bearer(token) });
  if (!user?.id) return null;
  const email = user.mail ?? user.userPrincipalName;
  return { accountId: user.id, email, accountLabel: email ?? user.displayName ?? user.id };
}

async function lookupClickUp(token: string): Promise<Partial<AccountIdentity> | null> {
  const result = await safeJson<{ user?: { id?: number; email?: string; username?: string } }>('https://api.clickup.com/api/v2/user', { headers: bearer(token) });
  const user = result?.user;
  if (user?.id == null) return null;
  return { accountId: String(user.id), email: user.email, accountLabel: user.email ?? user.username ?? String(user.id) };
}

async function lookupAsana(token: string): Promise<Partial<AccountIdentity> | null> {
  const result = await safeJson<{ data?: { gid?: string; email?: string; name?: string } }>('https://app.asana.com/api/1.0/users/me', { headers: bearer(token) });
  const data = result?.data;
  if (!data?.gid) return null;
  return { accountId: data.gid, email: data.email, accountLabel: data.email ?? data.name ?? data.gid };
}

async function lookupTrello(token: string): Promise<Partial<AccountIdentity> | null> {
  const member = await safeJson<{ id?: string; email?: string; username?: string; fullName?: string }>('https://api.trello.com/1/members/me', { headers: bearer(token) });
  if (!member?.id) return null;
  return { accountId: member.id, email: member.email, accountLabel: member.email ?? member.fullName ?? member.username ?? member.id };
}

async function lookupLinear(token: string): Promise<Partial<AccountIdentity> | null> {
  const result = await safeJson<{ data?: { viewer?: { id?: string; email?: string; name?: string } } }>('https://api.linear.app/graphql', {
    method: 'POST', headers: { ...bearer(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ viewer { id email name } }' }),
  });
  const viewer = result?.data?.viewer;
  if (!viewer?.id) return null;
  return { accountId: viewer.id, email: viewer.email, accountLabel: viewer.email ?? viewer.name ?? viewer.id };
}

async function lookupGitHub(token: string): Promise<Partial<AccountIdentity> | null> {
  const user = await safeJson<{ id?: number; login?: string; email?: string | null; name?: string | null }>('https://api.github.com/user', {
    headers: { ...bearer(token), 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'ClearHead' },
  });
  if (user?.id == null) return null;
  return { accountId: String(user.id), email: user.email ?? undefined, accountLabel: user.login ?? user.email ?? user.name ?? String(user.id) };
}

async function lookupSlack(token: string): Promise<Partial<AccountIdentity> | null> {
  // Requires identity.basic/identity.email in the user_scope grant; connections made before
  // that scope was requested will 403 here and fall through to the generic fallback label.
  const result = await safeJson<{ ok?: boolean; user?: { id?: string; email?: string; name?: string } }>('https://slack.com/api/users.identity', { headers: bearer(token) });
  const user = result?.ok ? result.user : null;
  if (!user?.id) return null;
  return { accountId: user.id, email: user.email, accountLabel: user.email ?? user.name ?? user.id };
}

// Best-effort only - a provider's identity call failing or not being implemented must never
// break connecting/disconnecting/pushing. Every branch falls back to a synthetic id + a
// generic label so the (owner, provider, providerAccountId) uniqueness guarantee always holds.
export async function fetchAccountIdentity(provider: ConnectionProvider, token: string, fallbackLabel: string): Promise<AccountIdentity> {
  const fallback: AccountIdentity = { accountId: randomUUID(), accountLabel: fallbackLabel };
  try {
    const found = await (async (): Promise<Partial<AccountIdentity> | null> => {
      switch (provider) {
        case 'google_calendar': return lookupGoogle(token);
        case 'outlook': case 'microsoft_todo': return lookupMicrosoftGraph(token);
        case 'clickup': return lookupClickUp(token);
        case 'asana': return lookupAsana(token);
        case 'trello': return lookupTrello(token);
        case 'linear': return lookupLinear(token);
        case 'github': return lookupGitHub(token);
        case 'slack': return lookupSlack(token);
        default: return null; // notion/jira_cloud/icloud/todoist already have (or don't need) their own identity; use the fallback.
      }
    })();
    if (!found?.accountId) return fallback;
    return { accountId: found.accountId, accountLabel: found.accountLabel ?? fallbackLabel, email: found.email };
  } catch {
    return fallback;
  }
}
