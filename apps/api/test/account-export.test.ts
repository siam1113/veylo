import assert from 'node:assert/strict';
import test from 'node:test';
import { shapeAccountExportConnection } from '../src/account-export.js';

const base = {
  providerAccountId: 'provider-user-123', scopes: ['read:issues'],
  connectedAt: new Date('2026-10-10T12:00:00.000Z'), lastSyncedAt: null, revokedAt: null,
};

test('Jira export keeps its site reference but drops token and unknown metadata', () => {
  const connection = shapeAccountExportConnection({
    ...base, provider: 'jira_cloud',
    metadata: { siteName: 'ClearHead team', siteUrl: 'https://example.atlassian.net', accessToken: 'secret', refreshToken: 'secret', email: 'private@example.com' },
  });

  assert.deepEqual(connection, {
    ...base, provider: 'jira_cloud',
    metadata: { siteName: 'ClearHead team', siteUrl: 'https://example.atlassian.net' },
  });
});

test('Notion export keeps only the workspace label and Google exports no provider metadata', () => {
  const notion = shapeAccountExportConnection({
    ...base, provider: 'notion', metadata: { workspaceName: 'Personal', accessToken: 'secret', botId: 'private-id' },
  });
  const google = shapeAccountExportConnection({
    ...base, provider: 'google_calendar', metadata: { email: 'private@example.com', refreshToken: 'secret' },
  });

  assert.deepEqual(notion.metadata, { workspaceName: 'Personal' });
  assert.deepEqual(google.metadata, {});
});

test('unexpected provider metadata types are omitted instead of exported', () => {
  const connection = shapeAccountExportConnection({
    ...base, provider: 'jira_cloud', metadata: { siteName: 42, siteUrl: ['https://example.atlassian.net'], apiToken: 'secret' },
  });

  assert.deepEqual(connection.metadata, { siteName: null, siteUrl: null });
});
