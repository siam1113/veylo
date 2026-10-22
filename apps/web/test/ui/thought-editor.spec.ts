import { initialOriginalVersions, appendOriginalPiece } from '@clearhead/domain';
import { test, expect } from '@playwright/test';

const userId = '3078190f-ff7b-44ed-bf0e-739ef0219372';
const clientId = '4078190f-ff7b-44ed-bf0e-739ef0219372';
const remoteId = '5078190f-ff7b-44ed-bf0e-739ef0219372';

test('thought workspace adapts fields, preserves edits and original text, and keeps navigation usable', async ({ page }) => {
  let row: Record<string, any> = {
    id: remoteId, clientId, rawCapture: 'Could we turn the spare room into a reading room?', title: 'A reading room', kind: 'idea',
    intent: '', purpose: '', desiredOutcome: '', roughPlan: '', horizon: null, effortEstimate: null, energyContext: '',
    status: 'captured', createdAt: '2026-10-10T10:00:00.000Z', updatedAt: '2026-10-10T10:00:00.000Z', version: 1,
  };
  row.originalVersions = initialOriginalVersions(clientId, row.rawCapture, row.createdAt, row.createdAt);
  let evaluations = 0;
  let evaluationReady = false;
  await page.addInitScript(({ userId }) => {
    localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: 'test-token', token_type: 'bearer', refresh_token: 'test-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: { id: userId, email: 'editor@clearhead.test', aud: 'authenticated', role: 'authenticated' } }));
    localStorage.setItem(`clearhead-onboarding-v1:${userId}`, 'complete');
  }, { userId });
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    let result: unknown = {};
    if (path === '/preferences') result = { aiInterpretationEnabled: true, reduceMotion: true, suggestionsEnabled: false, suggestionLimit: 0 };
    if (path === '/integrations') result = { integrations: [] };
    if (path === '/relationships') result = { relationships: [] };
    if (path.startsWith('/suggestions')) result = { feedback: [] };
    if (path === '/sync' && route.request().method() === 'GET') {
      if (evaluationReady && !row.fieldEvaluation) row = { ...row, version: 2, fieldEvaluation: { kind: 'idea', sourceVersion: 1, evaluatedAt: new Date().toISOString(), fields: [{ key: 'desiredOutcome', label: 'What would make the room inviting?', hint: 'Think about light, seating, or quiet.' }] } };
      result = { intentions: [row], timeBlocks: [], serverTime: new Date().toISOString() };
    }
    if (path === '/sync/push') {
      const items = route.request().postDataJSON().intentions;
      for (const item of items) row = { ...row, ...item, id: remoteId, version: row.version + 1 };
      result = { saved: items.map((item: any) => ({ clientId: item.clientId, remoteId, version: row.version })), conflicts: [], serverTime: new Date().toISOString() };
    }
    if (path.endsWith('/pieces')) { row.originalVersions = appendOriginalPiece(row.originalVersions, route.request().postDataJSON(), new Date().toISOString()); row.version++; result = { intention: row }; }
    if (path.endsWith('/evaluate')) { evaluations++; result = { queued: true }; }
    if (path.endsWith('/history')) result = { history: [{ id: 'revision-1', version: 1, action: 'created', changedFields: ['rawCapture'], createdAt: row.createdAt }] };
    await route.fulfill({ json: result });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Close dumping thoughts' }).click();
  await page.getByRole('button').filter({ has: page.getByRole('heading', { name: 'A reading room' }) }).click();
  const workspace = page.getByRole('region', { name: 'Intention details' });
  await expect(workspace).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Main navigation' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to Explore' })).toBeVisible();
  await page.getByLabel('What is the idea?').fill('Keep the window seat.');
  await expect.poll(() => evaluations).toBe(1);
  evaluationReady = true;
  await expect(page.getByLabel('What would make the room inviting?')).toBeVisible({ timeout: 10000 });
  await expect(page.getByLabel('Your thought', { exact: true })).toHaveValue('Keep the window seat.');
  await page.getByLabel('What would make the room inviting?').fill('Warm lighting');
  await page.getByRole('tab', { name: 'Original', exact: true }).click();
  await expect(workspace.locator('.original-piece').getByText(row.rawCapture, { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Timeline', exact: true }).click();
  await expect(workspace.getByText('Idea added', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Polished', exact: true }).click();
  await expect(page.getByLabel('What would make the room inviting?')).toHaveValue('Warm lighting');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect.poll(() => row.desiredOutcome).toBe('Warm lighting');
  await expect.poll(() => row.intent).toBe('Keep the window seat.');
  await page.getByRole('tab', { name: 'Original', exact: true }).click();
  await page.getByRole('button', { name: 'Dump again', exact: true }).click();
  const dump = page.getByRole('dialog', { name: 'Add to this thought' });
  await expect(dump.getByRole('complementary', { name: 'Previous pieces' })).toBeVisible();
  await expect(dump.getByRole('complementary', { name: 'Gist of previous pieces' })).toBeVisible();
  await dump.getByRole('textbox').fill('This evening I thought of adding a reading lamp.');
  await dump.getByRole('button', { name: 'Keep this piece' }).click();
  await expect(dump).not.toBeVisible();
  await expect.poll(() => row.originalVersions[0].pieces.length).toBe(2);
  await expect(workspace.locator('.original-piece').getByText(row.rawCapture, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start a new session', exact: true }).click();
  await dump.getByRole('textbox').fill('A shared library for the whole family.');
  await dump.getByRole('button', { name: 'Keep this piece' }).click();
  await expect.poll(() => row.originalVersions.length).toBe(2);
  await expect(workspace.getByText('Version 2', { exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/clearhead-thought-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Back to Explore' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Explore', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/clearhead-thought-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Back to Explore' }).click();
  await expect(workspace).not.toBeVisible();
  await page.getByRole('button').filter({ has: page.getByRole('heading', { name: 'A reading room' }) }).click();
  await expect(page.getByLabel('Your thought', { exact: true })).toHaveValue('Keep the window seat.');
  await page.getByRole('button', { name: 'Align', exact: true }).click();
  await expect(workspace).not.toBeVisible();
});
