import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/ui', workers: 1, use: { baseURL: 'http://127.0.0.1:5191', serviceWorkers: 'block' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5191', url: 'http://127.0.0.1:5191',
    env: { VITE_API_URL: 'http://127.0.0.1:5191/api', VITE_SUPABASE_URL: 'http://127.0.0.1:5191', VITE_SUPABASE_PUBLISHABLE_KEY: 'editor-test-only' },
  },
});
