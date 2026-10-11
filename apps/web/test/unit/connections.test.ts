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
      serverConnections = [...serverConnections, { provider: 'icloud', connected: true }];
      return Response.json({ connected: true });
    }
    if (path.endsWith('/complete')) {
      const provider = path.split('/').at(-2)!;
      const id = provider === 'google' ? 'google_calendar' : provider === 'jira' ? 'jira_cloud' : provider;
      serverConnections = [...serverConnections, { provider: id, connected: true }];
      return Response.json({ connected: true });
    }
    if (init?.method === 'DELETE') {
      const provider = path.split('/').at(-1)!;
      const id = provider === 'google' ? 'google_calendar' : provider === 'jira' ? 'jira_cloud' : provider;
      serverConnections = serverConnections.filter((item) => item.provider !== id);
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
      assert.ok((await client.refreshConnections()).some((item) => item.provider === id));
      assert.deepEqual(await client.disconnectProvider(provider), {});
      assert.ok(updates.at(-1)?.every((item) => item.provider !== id));
    }
    await client.connectIcloud({ appleId: 'test@example.com', appPassword: 'aaaa-bbbb-cccc-dddd' });
    assert.ok(updates.at(-1)?.some((item) => item.provider === 'icloud' && item.connected));
    assert.equal(JSON.stringify(updates).includes('aaaa-bbbb'), false);
    await client.disconnectProvider('icloud');
    assert.ok(updates.at(-1)?.every((item) => item.provider !== 'icloud'));
  } finally {
    client.dispose(); globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
