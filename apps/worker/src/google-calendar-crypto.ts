import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Must stay byte-compatible with apps/api/src/routes/integrations.ts's private
// encrypt/decrypt (AES-256-GCM, "v1.<iv>.<tag>.<body>", key = sha256(TOKEN_ENCRYPTION_KEY)).
// The worker decrypts tokens the API encrypted and vice versa; if either file's
// format drifts from the other, every stored Google token becomes unreadable.
const toBase64Url = (value: Buffer | string) => Buffer.from(value).toString('base64url');
const fromBase64Url = (value: string) => Buffer.from(value, 'base64url');

function tokenEncryptionKey() {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error('TOKEN_ENCRYPTION_KEY is not configured.');
  return createHash('sha256').update(key, 'utf8').digest();
}

export function encryptGoogleToken(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', tokenEncryptionKey(), iv);
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `v1.${toBase64Url(iv)}.${toBase64Url(cipher.getAuthTag())}.${toBase64Url(body)}`;
}

export function decryptGoogleToken(value: string): string {
  const [version, iv, tag, body] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !body) throw new Error('Stored Google token has an unknown format.');
  const decipher = createDecipheriv('aes-256-gcm', tokenEncryptionKey(), fromBase64Url(iv));
  decipher.setAuthTag(fromBase64Url(tag));
  return Buffer.concat([decipher.update(fromBase64Url(body)), decipher.final()]).toString('utf8');
}
