import assert from 'node:assert/strict';
import test from 'node:test';
import { createSyncClient, oauthProviders, type ConnectionStatus } from '../../app/lib/sync.client.ts';

test('OAuth completion, refresh, and disconnect keep each provider’s identity', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener() {}, removeEventListener() {}, location: { assign() {} } } });
  const updates: ConnectionStatus[][] = []; let serverConnections: ConnectionStatus[] = [];
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-session');
    if (path.endsWith('/icloud/connect')) {
      assert.deepEqual(JSON.parse(String(init?.body)), { appleId: 'test@example.com', appPassword: 'aaaa-bbbb-cccc-dddd' });
      serverConnections = [...serverConnections, { id: 'icloud-1', provider: 'icloud', connected: true }];
      return Response.json({ connected: true });
    }
    if (path.endsWith('/complete')) {
      const provider = path.split('/').at(-2)!;
      const id = provider === 'google' ? 'google_calendar' : provider === 'jira' ? 'jira_cloud' : provider;
      // A provider can now have more than one connected account, so completing OAuth
      // always adds a row rather than replacing whatever was already there for it.
      serverConnections = [...serverConnections, { id: `${id}-1`, provider: id, connected: true }];
      return Response.json({ connected: true });
    }
    if (init?.method === 'DELETE') {
      const integrationId = path.split('/').at(-1)!;
      serverConnections = serverConnections.filter((item) => item.id !== integrationId);
      return new Response(null, { status: 204 });
    }
    return Response.json({ integrations: serverConnections });
  };
  const client = createSyncClient({
    apiUrl: 'https://api.test', userId: 'test-owner', getSession: async () => ({ userId: 'test-owner', accessToken: 'test-session' }), signOut: async () => {},
    onIntegrations: (items) => { updates.push(items); }, onRemote() {}, onRelationships() {}, onSuggestionFeedback() {}, onPreferences() {}, onState() {}, onToast() {},
  });
  try {
    for (const provider of oauthProviders) {
      await client.completeOAuth(provider, 'code', 'state');
      const id = provider === 'google' ? 'google_calendar' : provider === 'jira' ? 'jira_cloud' : provider;
      assert.ok(updates.at(-2)?.some((item) => item.provider === id && item.connected), 'optimistic completion preserves the actual provider');
      const refreshed = await client.refreshConnections();
      const account = refreshed.find((item) => item.provider === id);
      assert.ok(account, `${id} should be connected after completing OAuth`);
      assert.deepEqual(await client.disconnectIntegration(account!.id), {});
      assert.ok(updates.at(-1)?.every((item) => item.provider !== id));
    }
    await client.connectIcloud({ appleId: 'test@example.com', appPassword: 'aaaa-bbbb-cccc-dddd' });
    assert.ok(updates.at(-1)?.some((item) => item.provider === 'icloud' && item.connected));
    assert.equal(JSON.stringify(updates).includes('aaaa-bbbb'), false);
    await client.disconnectIntegration('icloud-1');
    assert.ok(updates.at(-1)?.every((item) => item.provider !== 'icloud'));
  } finally {
    client.dispose(); globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('connecting the same provider twice keeps both accounts until each is disconnected', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener() {}, removeEventListener() {}, location: { assign() {} } } });
  let serverConnections: ConnectionStatus[] = [];
  let nextId = 1;
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/complete')) {
      serverConnections = [...serverConnections, { id: `google_calendar-${nextId++}`, provider: 'google_calendar', connected: true }];
      return Response.json({ connected: true });
    }
    if (init?.method === 'DELETE') {
      const integrationId = path.split('/').at(-1)!;
      serverConnections = serverConnections.filter((item) => item.id !== integrationId);
      return new Response(null, { status: 204 });
    }
    return Response.json({ integrations: serverConnections });
  };
  const client = createSyncClient({
    apiUrl: 'https://api.test', userId: 'test-owner', getSession: async () => ({ userId: 'test-owner', accessToken: 'test-session' }), signOut: async () => {},
    onIntegrations() {}, onRemote() {}, onRelationships() {}, onSuggestionFeedback() {}, onPreferences() {}, onState() {}, onToast() {},
  });
  try {
    await client.completeOAuth('google', 'code-1', 'state-1');
    await client.completeOAuth('google', 'code-2', 'state-2');
    const accounts = await client.refreshConnections();
    const googleAccounts = accounts.filter((item) => item.provider === 'google_calendar');
    assert.equal(googleAccounts.length, 2, 'two completed OAuth flows for the same provider produce two accounts');
    await client.disconnectIntegration(googleAccounts[0]!.id);
    const remaining = await client.refreshConnections();
    assert.equal(remaining.filter((item) => item.provider === 'google_calendar').length, 1, 'disconnecting one account leaves the other connected');
  } finally {
    client.dispose(); globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
