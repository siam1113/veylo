import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:5173';
const supabaseURL = 'http://127.0.0.1:54321';
const databaseURL = process.env.DATABASE_URL ?? 'postgresql://clearhead:clearhead@127.0.0.1:5432/clearhead';
const serverEnv = { ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseURL };

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'node test/e2e/auth-stub.mjs',
      url: `${supabaseURL}/health`,
      name: 'Test Auth',
      env: { ...serverEnv, AUTH_STUB_PORT: '54321' },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'npm run dev -w @clearhead/api',
      url: 'http://127.0.0.1:4100/health',
      name: 'Fastify API',
      env: {
        ...serverEnv,
        PORT: '4100', HOST: '127.0.0.1', WEB_ORIGIN: baseURL,
        SUPABASE_URL: supabaseURL, SUPABASE_PUBLISHABLE_KEY: 'playwright-test-only',
      },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run dev -w @clearhead/web -- --host 127.0.0.1 --port 5173',
      url: baseURL,
      name: 'React Router web app',
      env: {
        ...serverEnv,
        VITE_API_URL: 'http://127.0.0.1:4100',
        VITE_SUPABASE_URL: supabaseURL,
        VITE_SUPABASE_PUBLISHABLE_KEY: 'playwright-test-only',
      },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
