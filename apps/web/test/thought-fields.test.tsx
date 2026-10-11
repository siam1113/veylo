import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThoughtFields } from '../app/components/ThoughtFields';
import type { SyncIntention } from '../app/lib/sync.client';

const item: SyncIntention = { id: 'thought', rawCapture: 'A reading room?', title: 'Reading room', kind: 'idea', status: 'captured', createdAt: '2026-10-10T10:00:00Z', updatedAt: '2026-10-10T10:00:00Z' };
const render = (value: SyncIntention, draft: Partial<SyncIntention> = {}, enabled = true) => renderToStaticMarkup(<ThoughtFields item={value} draft={draft} enabled={enabled} client={null} onChange={() => {}} onPreferences={() => {}} />);

test('default questions follow the thought type before evaluation is available', () => {
  assert.match(render(item), /What is the idea\?/);
  const note = render({ ...item, kind: 'note' });
  assert.match(note, /What would you like to remember\?/);
  assert.doesNotMatch(note, /Estimated effort|When might this fit|next step/);
  assert.match(render({ ...item, kind: 'action' }), /When might this fit\?/);
});

test('evaluated fields replace defaults and keep both saved and unsaved answers editable', () => {
  const evaluated: SyncIntention = { ...item, purpose: 'A quiet home', fieldEvaluation: { kind: 'idea', evaluatedAt: '2026-10-10T10:00:00Z', sourceVersion: 1, fields: [{ key: 'desiredOutcome', label: 'What makes the room inviting?', hint: 'Consider the lighting.' }] } };
  const html = render(evaluated, { intent: 'Keep the window seat.' });
  assert.match(html, /What makes the room inviting\?/);
  assert.match(html, /Consider the lighting/);
  assert.match(html, /Keep the window seat\./);
  assert.match(html, /A quiet home/);
  assert.doesNotMatch(html, /What is the idea\?/);
  assert.match(render(evaluated, {}, false), /AI preferences/);
  assert.doesNotMatch(render(evaluated, {}, false), /What makes the room inviting/);
});

test('typed controls stay constrained and a complete note can have no follow-up questions', () => {
  const html = render({ ...item, fieldEvaluation: { kind: 'action', evaluatedAt: '2026-10-10T10:00:00Z', sourceVersion: 1, fields: [{ key: 'horizon', label: 'When?', hint: '' }, { key: 'effortEstimate', label: 'How long?', hint: '' }] } });
  assert.match(html, /<select/);
  assert.match(html, /type="number" min="0" max="10080"/);
  const complete = render({ ...item, kind: 'note', fieldEvaluation: { kind: 'note', evaluatedAt: '2026-10-10T10:00:00Z', sourceVersion: 1, fields: [] } });
  assert.doesNotMatch(complete, /<textarea|<input|<select/);
});
