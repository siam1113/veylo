import assert from 'node:assert/strict';
import test from 'node:test';
import { encryptGoogleToken, decryptGoogleToken } from '../src/google-calendar-crypto.ts';

// Round-trips only. The byte format (v1.<iv>.<tag>.<body>, AES-256-GCM, key =
// sha256(TOKEN_ENCRYPTION_KEY)) must stay identical to apps/api/src/routes/
// integrations.ts's private encrypt/decrypt, since each process decrypts
// tokens the other encrypted. That cross-file compatibility can't be checked
// by a unit test in either app alone — only by this comment and manual review.

test('a token survives an encrypt/decrypt round trip', () => {
  process.env.TOKEN_ENCRYPTION_KEY = 'test-key-0123456789abcdef0123456789abcdef';
  const token = 'ya29.example-google-access-token';
  assert.equal(decryptGoogleToken(encryptGoogleToken(token)), token);
});

test('encrypting the same value twice produces different ciphertext (random IV)', () => {
  process.env.TOKEN_ENCRYPTION_KEY = 'test-key-0123456789abcdef0123456789abcdef';
  const token = 'ya29.example-google-access-token';
  assert.notEqual(encryptGoogleToken(token), encryptGoogleToken(token));
});

test('decrypting a malformed value throws rather than returning garbage', () => {
  process.env.TOKEN_ENCRYPTION_KEY = 'test-key-0123456789abcdef0123456789abcdef';
  assert.throws(() => decryptGoogleToken('not-the-right-format'));
});
