import { test, expect } from '@playwright/test';
const userId = '3078190f-ff7b-44ed-bf0e-739ef0219372';
test('Align creates a standalone entry in its own editor and restores it after reload', async ({ page }) => {
  const entries = new Map<string, Record<string, unknown>>();
  await page.addInitScript(({ userId }) => {
    localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: 'test-token', token_type: 'bearer', refresh_token: 'test-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: { id: userId, email: 'align@veylo.test', aud: 'authenticated', role: 'authenticated' } }));
    localStorage.setItem(`veylo-onboarding-v1:${userId}`, 'complete');
  }, { userId });
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', ''); let result: unknown = {};
    if (path === '/preferences') result = { aiInterpretationEnabled: false, reduceMotion: true, suggestionsEnabled: false, suggestionLimit: 0 };
    if (path === '/integrations') result = { integrations: [] };
    if (path === '/relationships') result = { relationships: [] };
    if (path === '/suggestion-feedback') result = { feedback: [] };
    if (path === '/sync') result = { intentions: [], timeBlocks: [], serverTime: new Date().toISOString() };
    if (path === '/alignments') {
      if (route.request().method() === 'PUT') { const input = route.request().postDataJSON(); const saved = { ...input, version: (entries.get(input.id)?.version as number ?? 0) + 1, updatedAt: new Date().toISOString() }; entries.set(input.id, saved); result = { alignment: saved }; }
      else result = { alignments: [...entries.values()] };
    }
    await route.fulfill({ json: result });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Close dumping thoughts' }).click();
  await page.getByRole('button', { name: 'Align', exact: true }).click();
  await page.getByRole('button', { name: 'Add to Align' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add to Align' });
  await expect(dialog).toBeVisible();
  const backdrop = page.locator('body > .modal-scrim');
  await expect(backdrop).toBeVisible();
  await expect(backdrop).toHaveCSS('backdrop-filter', 'none');
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  await expect.poll(async () => {
    const bounds = await backdrop.boundingBox();
    const viewport = page.viewportSize()!;
    return bounds && Math.abs(bounds.x) < 1 && Math.abs(bounds.y) < 1 && Math.abs(bounds.width - viewport.width) < 1 && Math.abs(bounds.height - viewport.height) < 1;
  }).toBe(true);
  await expect(page.getByRole('region', { name: 'Intention details' })).not.toBeVisible();
  await dialog.getByLabel('Name your reason').fill('A calmer morning');
  await dialog.getByRole('button', { name: 'Create reason' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'A calmer morning' })).toBeVisible();
  await expect(page.getByText('No thoughts linked yet. This can stand on its own.')).toBeVisible();
  await expect.poll(() => entries.size).toBe(1);
  await page.reload();
  await page.getByRole('button', { name: 'Close dumping thoughts' }).click();
  await page.getByRole('button', { name: 'Align', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A calmer morning' })).toBeVisible();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A calmer morning' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await page.getByRole('button', { name: /^All/ }).click();
  await expect(page.getByRole('heading', { name: 'A calmer morning' })).toBeVisible();
});
