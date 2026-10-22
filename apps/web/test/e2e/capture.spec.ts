import assert from 'node:assert/strict';
import test, { expect } from '@playwright/test';
import postgres from 'postgres';

const userId = '3078190f-ff7b-44ed-bf0e-739ef0219372';
const authStorageKey = 'sb-127-auth-token';
const token = 'clearhead-playwright-user-token';
const rawCapture = 'Maybe I should call Maya about the garden idea on Friday.';
const title = 'Call Maya about the garden idea on Friday';
const offlineCapture = 'Maybe I should plan a quiet Sunday dinner.';
const offlineTitle = 'Plan a quiet Sunday dinner';
const quotaCapture = 'Maybe I should make room for a weekly walk.';
const quotaTitle = 'Make room for a weekly walk';

test.afterAll(async () => {
  const database = postgres(process.env.DATABASE_URL ?? 'postgresql://clearhead:clearhead@127.0.0.1:5432/clearhead', { max: 1, prepare: false });
  try { await database`DELETE FROM auth.users WHERE id = ${userId}`; }
  finally { await database.end({ timeout: 5 }); }
});

test('signed-in web capture syncs to PostgreSQL and returns in a clean browser context', async ({ page, browser }) => {
  const database = postgres(process.env.DATABASE_URL ?? 'postgresql://clearhead:clearhead@127.0.0.1:5432/clearhead', { max: 1, prepare: false });
  try {
  await database`DELETE FROM auth.users WHERE id = ${userId}`;
  await page.addInitScript(({ userId, authStorageKey, token }) => {
    const now = Math.floor(Date.now() / 1000);
    localStorage.setItem(authStorageKey, JSON.stringify({
      access_token: token,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: now + 3600,
      refresh_token: 'clearhead-playwright-refresh-token',
      user: {
        id: userId,
        aud: 'authenticated',
        role: 'authenticated',
        email: 'playwright@clearhead.test',
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: {},
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        is_anonymous: false,
      },
    }));
    localStorage.setItem(`clearhead-onboarding-v1:${userId}`, 'complete');
  }, { userId, authStorageKey, token });

  await page.goto('/');
  const capture = page.getByLabel('A thought, a question, a maybe…');
  await expect(capture).toBeVisible();
  await capture.fill(rawCapture);
  await page.getByRole('button', { name: /Dump it/ }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await expect.poll(async () => {
    const rows = await database`SELECT raw_capture FROM intentions WHERE owner_id = ${userId} AND deleted_at IS NULL`;
    return rows.filter((row) => row.raw_capture === rawCapture).length;
  }, { timeout: 15_000 }).toBe(1);

  await page.context().setOffline(true);
  await capture.fill(offlineCapture);
  await page.getByRole('button', { name: /Dump it/ }).click();
  await expect(page.getByText(offlineTitle, { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(({ userId, offlineCapture }) => new Promise<boolean>((resolve) => {
    const request = indexedDB.open('veylo-offline-v1', 1);
    request.onerror = () => resolve(false);
    request.onsuccess = () => {
      const read = request.result.transaction('outbox').objectStore('outbox').get(`snapshot:${userId}`);
      read.onerror = () => resolve(false);
      read.onsuccess = () => resolve(Boolean(
        (read.result as { items?: Array<{ rawCapture: string }> } | undefined)?.items?.some((item) => item.rawCapture === offlineCapture),
      ));
    };
  }), { userId, offlineCapture })).toBe(true);
  await expect.poll(async () => {
    const rows = await database`SELECT raw_capture FROM intentions WHERE owner_id = ${userId} AND deleted_at IS NULL`;
    return rows.filter((row) => row.raw_capture === offlineCapture).length;
  }).toBe(0);

  await page.context().setOffline(false);
  await expect.poll(async () => {
    const rows = await database`SELECT raw_capture FROM intentions WHERE owner_id = ${userId} AND deleted_at IS NULL`;
    return rows.filter((row) => row.raw_capture === offlineCapture).length;
  }, { timeout: 20_000 }).toBe(1);

  const secondContext = await browser.newContext();
  try {
    await secondContext.addInitScript(({ userId, authStorageKey, token }) => {
      const now = Math.floor(Date.now() / 1000);
      localStorage.setItem(authStorageKey, JSON.stringify({
        access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600,
        refresh_token: 'clearhead-playwright-refresh-token',
        user: { id: userId, aud: 'authenticated', role: 'authenticated', email: 'playwright@clearhead.test',
          app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
          created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', is_anonymous: false },
      }));
      localStorage.setItem(`clearhead-onboarding-v1:${userId}`, 'complete');
    }, { userId, authStorageKey, token });

    const cleanPage = await secondContext.newPage();
    await cleanPage.goto('/');
    await expect(cleanPage.getByText(title, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(cleanPage.getByText(offlineTitle, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(cleanPage.getByLabel('A thought, a question, a maybe…')).toBeVisible();
  } finally {
    await secondContext.close();
  }

    const rows = await database`SELECT raw_capture, title, status FROM intentions WHERE owner_id = ${userId} AND deleted_at IS NULL`;
    assert.deepEqual(rows
      .map(({ raw_capture, title, status }) => ({ raw_capture, title, status }))
      .sort((left, right) => left.raw_capture.localeCompare(right.raw_capture)), [
      { raw_capture: rawCapture, title, status: 'captured' },
      { raw_capture: offlineCapture, title: offlineTitle, status: 'captured' },
    ].sort((left, right) => left.raw_capture.localeCompare(right.raw_capture)));
  } finally {
    await database.end({ timeout: 5 });
  }
});

test('capture remains durable when the localStorage intention cache is full', async ({ page }) => {
  const database = postgres(process.env.DATABASE_URL ?? 'postgresql://clearhead:clearhead@127.0.0.1:5432/clearhead', { max: 1, prepare: false });
  try {
    await database`DELETE FROM auth.users WHERE id = ${userId}`;
    await page.addInitScript(({ userId, authStorageKey, token }) => {
      const now = Math.floor(Date.now() / 1000);
      localStorage.setItem(authStorageKey, JSON.stringify({
        access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600,
        refresh_token: 'clearhead-playwright-refresh-token',
        user: { id: userId, aud: 'authenticated', role: 'authenticated', email: 'playwright@clearhead.test',
          app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
          created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', is_anonymous: false },
      }));
      localStorage.setItem(`clearhead-onboarding-v1:${userId}`, 'complete');
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === `clearhead-intentions-v1:${userId}`) throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
        return originalSetItem.call(this, key, value);
      };
      const factory = IDBFactory.prototype;
      const originalOpen = factory.open;
      let delayFirstOpen = true;
      factory.open = function (name, version) {
        const request = originalOpen.call(this, name, version);
        if (name === 'veylo-offline-v1' && delayFirstOpen) {
          delayFirstOpen = false;
          (window as any).__veyloOfflineDbOpening = true;
          let prototype = Object.getPrototypeOf(request);
          let successDescriptor: PropertyDescriptor | undefined;
          while (prototype && !successDescriptor) {
            successDescriptor = Object.getOwnPropertyDescriptor(prototype, 'onsuccess');
            prototype = Object.getPrototypeOf(prototype);
          }
          Object.defineProperty(request, 'onsuccess', {
            configurable: true,
            get() { return successDescriptor?.get?.call(this); },
            set(handler: ((this: IDBOpenDBRequest, event: Event) => unknown) | null) {
              const delayed = handler ? function (this: IDBOpenDBRequest, event: Event) {
                window.setTimeout(() => handler.call(this, event), 1200);
              } : null;
              successDescriptor?.set?.call(this, delayed);
            },
          });
        }
        return request;
      };
    }, { userId, authStorageKey, token });

    await page.goto('/');
    const capture = page.getByLabel('A thought, a question, a maybe…');
    await expect(capture).toBeVisible();
    await page.waitForFunction(() => (window as any).__veyloOfflineDbOpening === true);
    await page.context().setOffline(true);
    await capture.fill(quotaCapture);
    await page.getByRole('button', { name: /Dump it/ }).click();
    await expect(page.getByText(quotaTitle, { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(({ userId, quotaCapture }) => new Promise<boolean>((resolve) => {
      const request = indexedDB.open('veylo-offline-v1', 1);
      request.onerror = () => resolve(false);
      request.onsuccess = () => {
        const read = request.result.transaction('outbox').objectStore('outbox').get(`snapshot:${userId}`);
        read.onerror = () => resolve(false);
        read.onsuccess = () => resolve(Boolean(
          (read.result as { items?: Array<{ rawCapture: string }> } | undefined)?.items?.some((item) => item.rawCapture === quotaCapture),
        ));
      };
    }), { userId, quotaCapture })).toBe(true);
    const rows = await database`SELECT raw_capture FROM intentions WHERE owner_id = ${userId} AND deleted_at IS NULL`;
    assert.equal(rows.some((row) => row.raw_capture === quotaCapture), false, 'offline capture should remain local until reconnect');
    await page.context().setOffline(false);
    await expect.poll(async () => {
      const synced = await database`SELECT raw_capture FROM intentions WHERE owner_id = ${userId} AND deleted_at IS NULL`;
      return synced.filter((row) => row.raw_capture === quotaCapture).length;
    }, { timeout: 20_000 }).toBe(1);
  } finally {
    await database.end({ timeout: 5 });
  }
});
