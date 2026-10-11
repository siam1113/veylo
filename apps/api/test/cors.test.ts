import assert from 'node:assert/strict';
import test from 'node:test';
import { isCorsOriginAllowed, parseCorsOrigins } from '../src/cors.ts';

test('CORS accepts the configured web app and explicitly listed development origins only', () => {
  const allowed = parseCorsOrigins('https://veylo-web.onrender.com', 'http://localhost:5173, http://127.0.0.1:5173');
  assert.equal(isCorsOriginAllowed('https://veylo-web.onrender.com', allowed), true);
  assert.equal(isCorsOriginAllowed('http://localhost:5173', allowed), true);
  assert.equal(isCorsOriginAllowed('http://127.0.0.1:5173', allowed), true);
  assert.equal(isCorsOriginAllowed('https://other.example', allowed), false);
  assert.equal(isCorsOriginAllowed(undefined, allowed), true);
});

test('CORS accepts localhost dev server ports only when local development is enabled', () => {
  const allowed = parseCorsOrigins('https://veylo-web.onrender.com', '');
  assert.equal(isCorsOriginAllowed('http://localhost:3000', allowed, true), true);
  assert.equal(isCorsOriginAllowed('http://127.0.0.1:5178', allowed, true), true);
  assert.equal(isCorsOriginAllowed('http://[::1]:5173', allowed, true), true);
  assert.equal(isCorsOriginAllowed('https://localhost:3000', allowed, true), false);
  assert.equal(isCorsOriginAllowed('http://localhost:3000', allowed, false), false);
  assert.equal(isCorsOriginAllowed('https://other.example', allowed, true), false);
});
