import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizationUrl, exchangeProviderToken, readProviderEntries } from '../src/connection-providers.js';

const config = { clientId: 'client', clientSecret: 'secret', redirectUri: 'https://api.example/callback' };
const grant = { grant_type: 'authorization_code', code: 'code' };

test('new OAuth requests use least-privilege provider-specific scopes', () => {
  const url = (provider: Parameters<typeof authorizationUrl>[0]) => new URL(authorizationUrl(provider, config, 'state', 'verifier'));
  assert.equal(url('todoist').searchParams.get('scope'), 'data:read');
  assert.equal(url('microsoft_todo').searchParams.get('scope'), 'offline_access Tasks.Read');
  assert.equal(url('linear').searchParams.get('scope'), 'read');
  assert.equal(url('github').searchParams.has('scope'), false);
  assert.equal(url('github').searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url('slack').searchParams.get('user_scope'), 'search:read');
  assert.equal(url('slack').searchParams.has('scope'), false);
});

test('Slack stores only the authorized user token and handles rotation and API errors', async () => {
  const original = globalThis.fetch;
  let response: unknown = { ok: true, access_token: 'bot-secret', authed_user: { access_token: 'user-secret', token_type: 'user', scope: 'search:read', expires_in: 43200, refresh_token: 'rotate' } };
  globalThis.fetch = async () => Response.json(response);
  try {
    assert.equal((await exchangeProviderToken('slack', config, grant)).access_token, 'user-secret');
    response = { ok: true, access_token: 'rotated-user', token_type: 'user', expires_in: 43200, refresh_token: 'next' };
    assert.equal((await exchangeProviderToken('slack', config, { grant_type: 'refresh_token', refresh_token: 'rotate' })).refresh_token, 'next');
    response = { ok: true, access_token: 'bot-secret', token_type: 'bot' };
    await assert.rejects(exchangeProviderToken('slack', config, grant), /user account/);
    response = { ok: false, error: 'invalid_code' };
    await assert.rejects(exchangeProviderToken('slack', config, grant), /declined or expired/);
    response = { ok: true, authed_user: { access_token: 'user-secret', token_type: 'user', scope: 'identity.basic' } };
    await assert.rejects(exchangeProviderToken('slack', config, grant), /message search/);
  } finally { globalThis.fetch = original; }
});

test('non-expiring tokens are accepted, while rotating providers require offline access', async () => {
  const original = globalThis.fetch;
  let response: unknown = { access_token: 'token' };
  globalThis.fetch = async (_input, init) => {
    assert.equal(new Headers(init?.headers).get('Accept'), 'application/json');
    return Response.json(response);
  };
  try {
    for (const provider of ['todoist', 'github'] as const) assert.equal((await exchangeProviderToken(provider, config, grant)).access_token, 'token');
    for (const provider of ['linear', 'microsoft_todo'] as const) await assert.rejects(exchangeProviderToken(provider, config, grant), /Offline access/);
    response = { access_token: 'token', refresh_token: 'refresh', expires_in: 86400, scope: ['read'] };
    assert.equal((await exchangeProviderToken('linear', config, grant)).scope, 'read');
  } finally { globalThis.fetch = original; }
});

test('work previews filter completed tasks and PRs, preserve due dates and disclose pagination', async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(url.toString());
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer token');
    if (url.hostname === 'api.todoist.com') return Response.json({ results: [{ id: 't1', content: 'Plan', due: { date: '2026-10-12' }, url: 'javascript:alert(1)' }, { id: 'done', content: 'Done', is_completed: true }], next_cursor: 'next' });
    if (url.pathname.endsWith('/todo/lists')) return Response.json({ value: [{ id: 'list/a', displayName: 'Work' }], '@odata.nextLink': 'next' });
    if (url.hostname === 'graph.microsoft.com') {
      assert.equal(url.searchParams.get('$filter'), "status ne 'completed'");
      assert.ok(url.pathname.includes('list%2Fa'));
      return Response.json({ value: [{ id: 'm1', title: 'Review', status: 'notStarted', dueDateTime: { dateTime: '2026-10-13T00:00:00.000' } }, { id: 'm2', title: 'Done', status: 'completed' }] });
    }
    if (url.hostname === 'api.linear.app') {
      assert.equal(init?.method, 'POST'); assert.match(String(init?.body), /assignedIssues/);
      return Response.json({ data: { viewer: { assignedIssues: { nodes: [{ id: 'l1', identifier: 'DEV-1', title: 'Build', dueDate: '2026-10-14', url: 'https://linear.app/work/issue/DEV-1', team: { name: 'Dev' }, state: { type: 'started' } }, { id: 'l2', state: { type: 'completed' } }], pageInfo: { hasNextPage: true } } } } });
    }
    assert.equal(url.hostname, 'api.github.com'); assert.equal(url.searchParams.get('filter'), 'assigned');
    return Response.json([{ id: 1, number: 7, title: 'Issue', html_url: 'https://github.com/org/repo/issues/7', repository: { full_name: 'org/repo' }, milestone: { due_on: '2026-10-15T00:00:00Z' } }, { id: 2, number: 8, title: 'PR', pull_request: {} }]);
  };
  try {
    const todoist = await readProviderEntries('todoist', 'token');
    assert.equal(todoist.entries.length, 1); assert.equal(todoist.hasMore, true);
    assert.equal(todoist.entries[0].date, '2026-10-12'); assert.match(todoist.entries[0].url!, /^https:\/\/app.todoist.com/);
    const microsoft = await readProviderEntries('microsoft_todo', 'token');
    assert.equal(microsoft.entries.length, 1); assert.equal(microsoft.entries[0].date, '2026-10-13'); assert.equal(microsoft.hasMore, true);
    const linear = await readProviderEntries('linear', 'token');
    assert.equal(linear.entries.length, 1); assert.equal(linear.hasMore, true); assert.equal(linear.entries[0].title, 'DEV-1 · Build');
    const github = await readProviderEntries('github', 'token');
    assert.equal(github.entries.length, 1); assert.equal(github.entries[0].context, 'org/repo'); assert.equal(github.entries[0].date, '2026-10-15T00:00:00Z');
    assert.equal(calls.length, 5);
  } finally { globalThis.fetch = original; }
});

test('Slack searches only own messages and keeps source text; HTTP 200 errors are not success', async () => {
  const original = globalThis.fetch; let failure = false;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'api.linear.app') return Response.json({ errors: [{ message: 'Denied' }] });
    assert.equal(url.searchParams.get('query'), 'from:me'); assert.equal(url.searchParams.get('count'), '50');
    return Response.json(failure ? { ok: false, error: 'missing_scope' } : { ok: true, messages: { matches: [{ ts: '1791763200.000001', text: 'Read <https://example.com|the plan> &amp; discuss', permalink: 'https://team.slack.com/archives/C1/p1791763200000001', channel: { id: 'C1', name: 'plans' } }], total: 70, paging: { pages: 2 } } });
  };
  try {
    const slack = await readProviderEntries('slack', 'token');
    assert.equal(slack.hasMore, true); assert.equal(slack.entries[0].captureText, 'Read the plan (https://example.com) & discuss');
    assert.equal(slack.entries[0].context, '#plans'); assert.match(slack.entries[0].url!, /team.slack.com/);
    failure = true; await assert.rejects(readProviderEntries('slack', 'token'), /Reconnect/);
    await assert.rejects(readProviderEntries('linear', 'token'), /could not load/);
  } finally { globalThis.fetch = original; }
});
