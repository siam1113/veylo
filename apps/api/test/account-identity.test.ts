import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchAccountIdentity } from '../src/account-identity.js';

function withFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl as typeof fetch;
  return run().finally(() => { globalThis.fetch = original; });
}

test('Google identity reads the userinfo endpoint and labels the account by email', async () => {
  const identity = await withFetch(
    async () => Response.json({ sub: 'g-123', email: 'jo@example.com' }),
    () => fetchAccountIdentity('google_calendar', 'token', 'Account 1'),
  );
  assert.deepEqual(identity, { accountId: 'g-123', accountLabel: 'jo@example.com', email: 'jo@example.com' });
});

test('Microsoft Graph identity falls back to displayName when no email is present', async () => {
  const identity = await withFetch(
    async () => Response.json({ id: 'ms-1', displayName: 'Jo Example' }),
    () => fetchAccountIdentity('outlook', 'token', 'Account 1'),
  );
  assert.equal(identity.accountId, 'ms-1');
  assert.equal(identity.accountLabel, 'Jo Example');
  assert.equal(identity.email, undefined);
});

test('a failed identity lookup never throws - it falls back to the generic label', async () => {
  const identity = await withFetch(
    async () => new Response('forbidden', { status: 403 }),
    () => fetchAccountIdentity('google_calendar', 'token', 'Account 2'),
  );
  assert.equal(identity.accountLabel, 'Account 2');
  assert.ok(identity.accountId, 'a synthetic account id is still generated');
});

test('a network error during the identity call never throws - it falls back to the generic label', async () => {
  const identity = await withFetch(
    async () => { throw new Error('network down'); },
    () => fetchAccountIdentity('slack', 'token', 'Account 3'),
  );
  assert.equal(identity.accountLabel, 'Account 3');
});

test('providers with no identity lookup (Notion, Jira, iCloud) use the fallback label without calling fetch', async () => {
  let called = false;
  const identity = await withFetch(
    async () => { called = true; return Response.json({}); },
    () => fetchAccountIdentity('notion', 'token', 'Account 4'),
  );
  assert.equal(called, false);
  assert.equal(identity.accountLabel, 'Account 4');
});
