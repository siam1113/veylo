import { createHash, createHmac } from 'node:crypto';
import { z } from 'zod';
import { readWorkEntries, isWorkProvider } from './work-connections.js';

export const additionalProviders = ['outlook', 'clickup', 'asana', 'trello', 'todoist', 'microsoft_todo', 'linear', 'github', 'slack'] as const;
export type AdditionalProvider = typeof additionalProviders[number];
export type ConnectionProvider = 'google_calendar' | 'jira_cloud' | 'notion' | 'icloud' | AdditionalProvider;
export const providerLabels: Record<ConnectionProvider, string> = {
  google_calendar: 'Google Calendar', jira_cloud: 'Jira Cloud', notion: 'Notion',
  icloud: 'iCloud Calendar', todoist: 'Todoist', microsoft_todo: 'Microsoft To Do', linear: 'Linear', github: 'GitHub Issues', slack: 'Slack',
  outlook: 'Outlook Calendar', clickup: 'ClickUp', asana: 'Asana', trello: 'Trello',
};
export const providerRoute = (provider: ConnectionProvider) => provider === 'google_calendar' ? 'google' : provider === 'jira_cloud' ? 'jira' : provider;
export const providerPrefix = (provider: ConnectionProvider) => providerRoute(provider).toUpperCase();
export function providerConfigured(provider: ConnectionProvider, config: Record<string, unknown>) {
  if (provider === 'icloud') return Boolean(config.TOKEN_ENCRYPTION_KEY);
  return ['CLIENT_ID', 'CLIENT_SECRET', 'REDIRECT_URI'].every((key) => Boolean(config[`${providerPrefix(provider)}_${key}`]))
    && Boolean(config.OAUTH_STATE_SECRET && config.TOKEN_ENCRYPTION_KEY);
}
export function connectionIsActive(row: { revokedAt: Date | null; encryptedAccessToken: string | null; encryptedRefreshToken: string | null }) {
  return !row.revokedAt && Boolean(row.encryptedAccessToken || row.encryptedRefreshToken);
}
export type ProviderConfig = { clientId: string; clientSecret: string; redirectUri: string };
export const providerScopes: Record<AdditionalProvider, string[]> = {
  todoist: ['data:read'], microsoft_todo: ['offline_access', 'Tasks.Read'], linear: ['read'], github: [], slack: ['search:read'],
  // ReadWrite (not just ReadBasic) so ClearHead can push time blocks to Outlook, not only preview them.
  // Every connection made before this widened scope must reconnect before push will work for it.
  outlook: ['offline_access', 'Calendars.ReadWrite'], clickup: [],
  asana: ['tasks:read', 'workspaces:read', 'users:read'],
  trello: ['read:member:trello', 'read:board:trello', 'read:card:trello', 'offline_access'],
};
const authorizationEndpoints = {
  todoist: 'https://app.todoist.com/oauth/authorize', microsoft_todo: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  linear: 'https://linear.app/oauth/authorize', github: 'https://github.com/login/oauth/authorize', slack: 'https://slack.com/oauth/v2/authorize',
  outlook: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  clickup: 'https://app.clickup.com/api', asana: 'https://app.asana.com/-/oauth_authorize',
  trello: 'https://auth.atlassian.com/authorize',
};
const tokenEndpoints = {
  todoist: 'https://api.todoist.com/oauth/access_token', microsoft_todo: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  linear: 'https://api.linear.app/oauth/token', github: 'https://github.com/login/oauth/access_token', slack: 'https://slack.com/api/oauth.v2.access',
  outlook: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  clickup: 'https://api.clickup.com/api/v2/oauth/token', asana: 'https://app.asana.com/-/oauth_token',
  trello: 'https://auth.atlassian.com/oauth/token',
};
// The verifier is reproducible only by the server, bound to the one-time signed state.
export function pkceVerifier(state: string, secret: string) {
  return createHmac('sha256', secret).update(`connection-pkce:${state}`).digest('base64url');
}
export function authorizationUrl(provider: AdditionalProvider, config: ProviderConfig, state: string, verifier: string) {
  const url = new URL(authorizationEndpoints[provider]);
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', state }).toString();
  if (providerScopes[provider].length) url.searchParams.set(provider === 'slack' ? 'user_scope' : 'scope', providerScopes[provider].join(provider === 'slack' || provider === 'todoist' || provider === 'linear' ? ',' : ' '));
  if (!['clickup', 'todoist', 'slack'].includes(provider)) {
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
  }
  if (provider === 'trello') url.searchParams.set('prompt', 'consent');
  return url.toString();
}
const problem = (message: string, statusCode = 502) => Object.assign(new Error(message), { statusCode });
export async function providerJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw problem(response.status === 401 || response.status === 403
    ? 'Access expired or was declined. Reconnect this account and try again.'
    : 'The connected service could not respond. Try again shortly.', response.status === 401 || response.status === 403 ? 409 : 502);
  return response.json() as Promise<T>;
}
const tokenSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1).optional(), expires_in: z.number().positive().optional(), scope: z.string().optional() });
export async function exchangeProviderToken(provider: AdditionalProvider, config: ProviderConfig, grant: Record<string, string>) {
  const payload = { client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, ...grant };
  const json = provider === 'clickup' || provider === 'trello';
  const result = await providerJson<Record<string, unknown>>(tokenEndpoints[provider], {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': json ? 'application/json' : 'application/x-www-form-urlencoded' },
    body: json ? JSON.stringify(payload) : new URLSearchParams(payload).toString(),
  });
  if (provider === 'slack' && result.ok !== true) throw problem('Slack authorization was declined or expired. Reconnect and try again.', 409);
  const response = provider === 'slack' && grant.grant_type === 'authorization_code' ? result.authed_user as Record<string, unknown> | undefined : result;
  if (provider === 'slack' && response?.token_type !== 'user') throw problem('Slack did not authorize your user account. Reconnect with message search access.', 409);
  const parsed = tokenSchema.safeParse(response ? { ...response, scope: Array.isArray(response.scope) ? response.scope.join(' ') : response.scope } : response);
  if (!parsed.success) throw problem('The service returned an incomplete authorization. Reconnect and try again.');
  if (grant.grant_type === 'authorization_code' && (['outlook', 'microsoft_todo', 'asana', 'trello', 'linear'].includes(provider) || parsed.data.expires_in) && !parsed.data.refresh_token) {
    throw problem('Offline access was not granted. Reconnect and allow the requested permissions.');
  }
  if (provider === 'slack' && grant.grant_type === 'authorization_code' && !parsed.data.scope?.split(/[ ,]+/).includes('search:read')) throw problem('Allow Slack message search to connect this account.', 409);
  return parsed.data;
}
export type ConnectionEntry = { id: string; title: string; url?: string; date?: string | null; context?: string; captureText?: string; kind?: string };
export type ConnectionEntries = { entries: ConnectionEntry[]; hasMore: boolean; notice?: string };
export function safeLink(value: string | undefined, hostname: string) {
  try { const url = new URL(value ?? ''); return url.protocol === 'https:' && (url.hostname === hostname || url.hostname.endsWith(`.${hostname}`)) ? url.toString() : undefined; } catch { return undefined; }
}
export async function readProviderEntries(provider: AdditionalProvider, token: string): Promise<ConnectionEntries> {
  if (isWorkProvider(provider)) return readWorkEntries(provider, token);
  const headers = { Authorization: `Bearer ${token}` };
  const read = <T>(url: string, extraHeaders = {}) => providerJson<T>(url, { headers: { ...headers, ...extraHeaders } });
  if (provider === 'outlook') {
    const start = new Date(); const end = new Date(start.getTime() + 30 * 86400_000);
    const query = new URLSearchParams({ startDateTime: start.toISOString(), endDateTime: end.toISOString(), '$select': 'id,subject,start,webLink,isCancelled', '$orderby': 'start/dateTime', '$top': '100' });
    const data = await read<{ value: Array<{ id: string; subject: string; start: { dateTime: string }; webLink?: string; isCancelled?: boolean }>; '@odata.nextLink'?: string }>(`https://graph.microsoft.com/v1.0/me/calendarView?${query}`, { Prefer: 'outlook.timezone="UTC"' });
    return { entries: data.value.filter((event) => !event.isCancelled).map((event) => ({ id: event.id, title: event.subject || 'Untitled event', date: /Z$|[+-]\d\d:\d\d$/.test(event.start.dateTime) ? event.start.dateTime : `${event.start.dateTime}Z`, url: safeLink(event.webLink, 'live.com') ?? safeLink(event.webLink, 'office.com') ?? safeLink(event.webLink, 'office365.com'), context: 'Outlook Calendar' })), hasMore: Boolean(data['@odata.nextLink']) };
  }
  if (provider === 'trello') {
    const cards = await read<Array<{ id: string; name: string; due: string | null; closed: boolean; dueComplete: boolean; url: string }>>('https://api.trello.com/1/members/me/cards?filter=visible&fields=id,name,due,dueComplete,closed,url');
    const open = cards.filter((card) => !card.closed && !card.dueComplete);
    return { entries: open.slice(0, 100).map((card) => ({ id: card.id, title: card.name, date: card.due, url: safeLink(card.url, 'trello.com'), context: 'Assigned card' })), hasMore: open.length > 100 };
  }
  if (provider === 'clickup') {
    const user = await read<{ user: { id: number } }>('https://api.clickup.com/api/v2/user');
    const { teams } = await read<{ teams: Array<{ id: string; name: string }> }>('https://api.clickup.com/api/v2/team');
    const entries: ConnectionEntry[] = []; let hasMore = teams.length > 5;
    for (const team of teams.slice(0, 5)) {
      const query = new URLSearchParams({ 'assignees[]': String(user.user.id), include_closed: 'false', page: '0', order_by: 'due_date' });
      const data = await read<{ tasks: Array<{ id: string; name: string; due_date: string | null; url: string }>; last_page?: boolean }>(`https://api.clickup.com/api/v2/team/${encodeURIComponent(team.id)}/task?${query}`);
      hasMore ||= data.last_page === false || data.tasks.length >= 100;
      entries.push(...data.tasks.map((task) => ({ id: task.id, title: task.name, date: task.due_date && Number.isFinite(Number(task.due_date)) ? new Date(Number(task.due_date)).toISOString() : null, url: safeLink(task.url, 'clickup.com'), context: team.name })));
    }
    return { entries: entries.slice(0, 100), hasMore: hasMore || entries.length > 100 };
  }
  const workspaces = await read<{ data: Array<{ gid: string; name: string }>; next_page?: unknown }>('https://app.asana.com/api/1.0/workspaces?limit=100');
  const entries: ConnectionEntry[] = []; let hasMore = Boolean(workspaces.next_page) || workspaces.data.length > 5;
  for (const workspace of workspaces.data.slice(0, 5)) {
    const query = new URLSearchParams({ workspace: workspace.gid, assignee: 'me', completed_since: 'now', limit: '100', opt_fields: 'name,due_on,due_at,permalink_url,completed' });
    const result = await read<{ data: Array<{ gid: string; name: string; due_on: string | null; due_at: string | null; permalink_url?: string; completed: boolean }>; next_page?: unknown }>(`https://app.asana.com/api/1.0/tasks?${query}`);
    hasMore ||= Boolean(result.next_page);
    entries.push(...result.data.filter((task) => !task.completed).map((task) => ({ id: task.gid, title: task.name, date: task.due_at ?? task.due_on, url: safeLink(task.permalink_url, 'asana.com'), context: workspace.name })));
  }
  return { entries: entries.slice(0, 100), hasMore: hasMore || entries.length > 100 };
}
