import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { initialOriginalVersions, appendOriginalPiece } from '@veylo/domain';
import { OriginalThought, OriginalGist, OriginalPieces } from '../app/components/OriginalThought';
import { CapturePanel } from '../app/components/CapturePanel';
import type { SyncIntention } from '../app/lib/sync.client';
const id = '3078190f-ff7b-44ed-bf0e-739ef0219372';
const secondId = '4078190f-ff7b-44ed-bf0e-739ef0219372';
const time = '2026-10-10T08:00:00.000Z';
const first = initialOriginalVersions(id, '  An idea in the morning.\n', time, time);
const versions = appendOriginalPiece(first, { id: secondId, versionId: secondId, startNewVersion: true, content: 'An evening direction.', createdAt: time }, null);
const item: SyncIntention = { id, title: 'A growing idea', kind: 'idea', status: 'captured', rawCapture: first[0]!.pieces[0]!.content, createdAt: time, updatedAt: time, originalVersions: versions };

test('Original groups immutable raw pieces under versions and offers both continuation choices', () => {
  const html = renderToStaticMarkup(<OriginalThought item={item} onDump={() => {}} />);
  assert.match(html, /Version 1/); assert.match(html, /Version 2/);
  assert.match(html, /  An idea in the morning\.\n/);
  assert.match(html, /An evening direction\./);
  assert.match(html, /Dump again/); assert.match(html, /Start a new session/);
  assert.match(html, /Saved on this device/);
  assert.doesNotMatch(html, /Iteration/);
});

test('continuation uses the same write/speak capture with previous pieces left and gist right', () => {
  const html = renderToStaticMarkup(<CapturePanel panelRef={{ current: null }} inputRef={{ current: null }} capture="" onCapture={() => {}} mode="keyboard" onMode={() => {}} listening={false} voiceStatus={null} saving={false} onSave={() => {}} onClose={() => {}} onKeyDown={() => {}} reduceMotion theme="light" previousPieces={<OriginalPieces versions={versions} compact />} gist={<OriginalGist item={item} />} versionLabel="Version 2" />);
  assert.ok(html.indexOf('capture-previous') < html.indexOf('class="capture-main"'));
  assert.ok(html.indexOf('class="capture-main"') < html.indexOf('class="capture-gist"'));
  assert.match(html, /Keep this piece/); assert.match(html, />Speak</);
  assert.match(html, /Back to original idea/);
});

test('previous gist follows version chronology rather than dictionary key order', () => {
  const html = renderToStaticMarkup(<OriginalGist item={{ ...item, originalGists: {
    [secondId]: { text: 'The evening gist.', generatedAt: time, lastPieceId: secondId },
    [id]: { text: 'The morning gist.', generatedAt: time, lastPieceId: id },
  } }} />);
  assert.match(html, /The evening gist/); assert.doesNotMatch(html, /The morning gist/);
});
