import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { alignmentContentSchema, type AlignmentRecord, type AlignmentWrite } from '@veylo/domain';
import { createAlignmentStore, type LocalAlignment } from '../../app/lib/alignments.client';
import { AlignmentEditor, AlignView } from '../../app/components/AlignView';
const content = { kind: 'reason' as const, title: 'Less rushed mornings', note: '', intentionIds: [], archived: false };
function harness() {
  const disk = new Map<string, string>();
  const remote = new Map<string, AlignmentRecord & { mutationId: string }>();
  let failStorage = false; let offline = false; let closed = false; let visible: LocalAlignment[] = [];
  const storage = { getItem: (key: string) => disk.get(key) ?? null, setItem(key: string, value: string) { if (failStorage) throw new Error('Storage full'); disk.set(key, value); }, removeItem(key: string) { disk.delete(key); } };
  const request = async <T,>(_path: string, init?: RequestInit): Promise<T> => {
    if (offline) throw new Error('Offline');
    if (init?.method === 'PUT') {
      const input = JSON.parse(String(init.body)) as AlignmentWrite; const current = remote.get(input.id);
      if (current?.mutationId === input.mutationId) return { alignment: current } as T;
      if ((current?.version ?? null) !== input.expectedVersion) throw Object.assign(new Error('Changed elsewhere'), { statusCode: 409, responseBody: { current } });
      const saved = { ...input, version: (current?.version ?? 0) + 1, updatedAt: new Date().toISOString() };
      remote.set(input.id, saved); return { alignment: saved } as T;
    }
    return { alignments: [...remote.values()] } as T;
  };
  const create = (key = 'owner-a') => createAlignmentStore({ key, storage, request, onChange: (rows) => { visible = rows; }, isClosed: () => closed });
  return { create, remote, disk, get visible() { return visible; }, failStorage() { failStorage = true; }, offline(value: boolean) { offline = value; }, close() { closed = true; } };
}
test('standalone entries survive offline reload and sync without duplication', async () => {
  const h = harness(); const first = h.create(); const created = first.save(content, null);
  assert.deepEqual(created.intentionIds, []); assert.equal(created.syncState, 'pending');
  const reloaded = h.create(); assert.equal(reloaded.rows[0]?.title, content.title);
  h.offline(true); await assert.rejects(reloaded.sync(), /Offline/); assert.equal(h.create().rows[0]?.syncState, 'pending');
  h.offline(false); await reloaded.sync(); await reloaded.sync();
  assert.equal(h.remote.size, 1); assert.equal(reloaded.rows[0]?.version, 1); assert.equal(reloaded.rows[0]?.syncState, 'synced');
});
test('links can be added or removed without requiring any thoughts', async () => {
  const h = harness(); const store = h.create(); const row = store.save(content, null); await store.sync();
  const linked = store.save({ ...content, id: row.id, intentionIds: [randomUUID(), randomUUID()] }, 1); await store.sync();
  assert.equal(store.rows[0]?.intentionIds.length, 2);
  store.save({ ...linked, intentionIds: [] }, 2); await store.sync();
  assert.deepEqual(store.rows[0]?.intentionIds, []); assert.equal(store.rows[0]?.title, content.title);
});
test('invalid input and storage failures cannot report a saved entry', () => {
  assert.equal(alignmentContentSchema.safeParse({ ...content, title: '  ' }).success, false);
  const id = randomUUID(); assert.equal(alignmentContentSchema.safeParse({ ...content, intentionIds: [id, id] }).success, false);
  const h = harness(); const store = h.create(); h.failStorage();
  assert.throws(() => store.save(content, null), /Storage full/); assert.equal(store.rows.length, 0); assert.equal(h.visible.length, 0);
});
test('account caches are isolated and closed sessions reject edits', () => {
  const h = harness(); h.create().save(content, null); assert.equal(h.create('owner-b').rows.length, 0);
  const store = h.create(); h.close(); assert.throws(() => store.save(content, null), /closing/);
});
test('cross-device conflicts retain local edits and require explicit resolution', async () => {
  const h = harness(); const store = h.create(); const row = store.save(content, null); await store.sync();
  const remote = h.remote.get(row.id)!;
  h.remote.set(row.id, { ...remote, title: 'Other device version', version: 2, mutationId: randomUUID() });
  store.save({ ...content, id: row.id, title: 'My local version' }, 1); await store.sync();
  assert.equal(store.rows[0]?.syncState, 'conflict'); assert.equal(store.rows[0]?.title, 'My local version');
  assert.equal(store.rows[0]?.conflict?.title, 'Other device version');
  assert.throws(() => store.save({ ...content, id: row.id }, 1), /review/);
  store.save({ ...content, id: row.id, title: 'Reviewed version' }, 1, true); await store.sync();
  assert.equal(h.remote.get(row.id)?.title, 'Reviewed version'); assert.equal(store.rows[0]?.version, 3);
});
test('archive and restore preserve content', async () => {
  const h = harness(); const store = h.create(); const row = store.save(content, null); await store.sync();
  store.save({ ...content, id: row.id, archived: true }, 1); await store.sync(); assert.equal(store.rows[0]?.archived, true);
  store.save({ ...content, id: row.id, archived: false }, 2); await store.sync(); assert.equal(store.rows[0]?.archived, false); assert.equal(store.rows[0]?.title, content.title);
});
test('Align has a dedicated creation flow with optional thoughts', () => {
  const html = renderToStaticMarkup(<AlignView entries={[]} items={[]} onSave={() => {}} onUseSynced={() => {}} onOpen={() => {}} />);
  assert.match(html, /Add to Align/); assert.match(html, /link thoughts later/); assert.doesNotMatch(html, /Name a purpose|Save an intention first/);
  const editor = renderToStaticMarkup(<AlignmentEditor initialKind="reason" items={[]} onSave={() => {}} onUseSynced={() => {}} onClose={() => {}} />);
  assert.match(editor, /Create reason/); assert.match(editor, /No thoughts yet/);
  for (const kind of ['Reason', 'Goal', 'Direction', 'Value']) assert.match(editor, new RegExp(`>${kind}<`));
  assert.doesNotMatch(editor, /Original|Polished|Thought timeline/);
});
