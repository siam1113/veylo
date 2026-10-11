import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSupabaseAdminKey } from '../src/supabase-admin-key.ts';

test('prefers the current Supabase secret key', () => {
  assert.equal(resolveSupabaseAdminKey('sb_secret_current', 'legacy-service-role'), 'sb_secret_current');
});

test('keeps the legacy service-role key as a migration fallback', () => {
  assert.equal(resolveSupabaseAdminKey(undefined, 'legacy-service-role'), 'legacy-service-role');
});

test('leaves account deletion unconfigured when no elevated key is set', () => {
  assert.equal(resolveSupabaseAdminKey(), null);
});
