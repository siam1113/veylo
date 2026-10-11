import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { initialOriginalVersions, appendOriginalPiece, mergeOriginalVersions, originalPieceInputSchema, originalContext } from '../dist/index.js';
const created = '2026-10-10T08:00:00.000Z';
const synced = '2026-10-10T09:00:00.000Z';
const evening = '2026-10-10T18:00:00.000Z';

test('a later dump is a separate immutable piece within the same version', () => {
  const id = randomUUID();
  const original = initialOriginalVersions(id, '  A morning thought.\n', created, synced);
  const input = { id: randomUUID(), versionId: id, content: 'An evening detail.', createdAt: evening, startNewVersion: false };
  const next = appendOriginalPiece(original, input, null);
  assert.equal(original[0].pieces.length, 1);
  assert.equal(next.length, 1);
  assert.equal(next[0].pieces.length, 2);
  assert.equal(next[0].pieces[0].content, '  A morning thought.\n');
  assert.equal(next[0].pieces[1].syncedAt, null);
  assert.equal(appendOriginalPiece(next, input, synced), next, 'retries are idempotent');
  assert.throws(() => appendOriginalPiece(next, { ...input, content: 'Replace evening words' }, synced), /already saved/);
});

test('new versions group new pieces without losing previous versions', () => {
  const initial = initialOriginalVersions(randomUUID(), 'First direction', created, synced);
  const versionId = randomUUID();
  const next = appendOriginalPiece(initial, { id: randomUUID(), versionId, content: 'Different direction', createdAt: evening, startNewVersion: true }, null);
  assert.equal(next.length, 2);
  assert.deepEqual(next[0], initial[0]);
  assert.equal(next[1].id, versionId);
  assert.throws(() => appendOriginalPiece(initial, { id: randomUUID(), versionId, content: 'Unknown', createdAt: evening, startNewVersion: false }, null), /unavailable/);
});

test('remote sync retains offline pieces and acknowledges duplicates without copying them', () => {
  const id = randomUUID();
  const first = initialOriginalVersions(id, 'Initial idea', created, synced);
  const a = { id: randomUUID(), versionId: id, content: 'Offline piece', createdAt: evening, startNewVersion: false };
  const b = { id: randomUUID(), versionId: id, content: 'Other device piece', createdAt: evening, startNewVersion: false };
  const local = appendOriginalPiece(first, a, null);
  const remote = appendOriginalPiece(first, b, synced);
  const merged = mergeOriginalVersions(remote, local);
  assert.deepEqual(merged[0].pieces.map((piece) => piece.content), ['Initial idea', 'Other device piece', 'Offline piece']);
  const acknowledged = mergeOriginalVersions(appendOriginalPiece(remote, a, synced), local);
  assert.equal(acknowledged[0].pieces.length, 3);
  assert.equal(acknowledged[0].pieces.at(-1).syncedAt, synced);
});

test('piece input validates nonblank bounded raw words and evaluation keeps recent context', () => {
  const id = randomUUID(); const base = { id: randomUUID(), versionId: id, createdAt: evening, startNewVersion: false };
  assert.equal(originalPieceInputSchema.safeParse({ ...base, content: ' \n ' }).success, false);
  assert.equal(originalPieceInputSchema.safeParse({ ...base, content: 'x'.repeat(8001) }).success, false);
  const words = '  Exact words.\n';
  assert.equal(originalPieceInputSchema.parse({ ...base, content: words }).content, words);
  const versions = appendOriginalPiece(initialOriginalVersions(id, 'x'.repeat(1000), created, synced), { ...base, content: 'The evening insight.' }, null);
  const context = originalContext(versions, 200);
  assert.match(context, /The evening insight/);
  assert.match(context, /Earlier pieces omitted/);
  assert.equal(versions[0].pieces[0].content.length, 1000);
});
