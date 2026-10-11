import { useState, type FormEvent } from 'react';
import type { AlignmentContent, AlignmentKind } from '@veylo/domain';
import type { SyncIntention } from '../lib/sync.client';
import type { LocalAlignment } from '../lib/alignments.client';
import { Modal } from './Modal';
import { UiIcon, type UiIconName } from './UiIcon';
import { ThoughtStatus } from './ThoughtStatus';

export const alignmentTypes: Record<AlignmentKind, { label: string; plural: string; hint: string; example: string; contextLabel: string; contextHint: string; icon: UiIconName }> = {
  reason: { label: 'Reason', plural: 'Reasons', hint: 'A reason this matters, even just for now.', example: 'Make weekday mornings less rushed', contextLabel: 'Why does this matter to you?', contextHint: 'Add the motivation, people, or circumstances you want to keep in mind.', icon: 'reason' },
  goal: { label: 'Goal', plural: 'Goals', hint: 'A result you want to reach.', example: 'Finish the first draft', contextLabel: 'What would success look like, and by when?', contextHint: 'Describe a clear outcome, milestone, or target date. The date is optional.', icon: 'goal' },
  direction: { label: 'Direction', plural: 'Directions', hint: 'A path you want to explore or grow into.', example: 'Make more room for creative work', contextLabel: 'What would help you explore this direction?', contextHint: 'Note an area to explore, a small experiment, or a next step.', icon: 'direction' },
  value: { label: 'Value', plural: 'Values', hint: 'Something you want your choices to reflect.', example: 'Stay present with the people I care about', contextLabel: 'How would you like this value to show up?', contextHint: 'Describe the choices, habits, or relationships where this matters.', icon: 'value' },
};
type Save = (entry: AlignmentContent & { id?: string }, version: number | null, replaceConflict?: boolean) => void;

export function AlignView({ entries, items, onSave, onUseSynced, onOpen }: {
  entries: LocalAlignment[]; items: SyncIntention[]; onSave: Save; onUseSynced: (id: string) => void; onOpen: (id: string) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'archived' | AlignmentKind>('all');
  const [layout, setLayout] = useState<'gallery' | 'list'>('gallery');
  const [editor, setEditor] = useState<{ entry?: LocalAlignment; kind: AlignmentKind } | null>(null);
  const [error, setError] = useState('');
  const active = entries.filter((entry) => !entry.archived);
  const visible = entries.filter((entry) => filter === 'archived' ? entry.archived : !entry.archived && (filter === 'all' || entry.kind === filter));
  function archive(entry: LocalAlignment) {
    try { onSave({ ...entry, archived: !entry.archived }, entry.version); setError(''); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not save this change.'); }
  }
  return <section className="view active align-workspace">
    <header className="align-heading"><div><h1>Align</h1><p>Give your thoughts something to move toward.</p></div><button className="capture-button" onClick={() => setEditor({ kind: filter === 'all' || filter === 'archived' ? 'reason' : filter })}>＋ Add to Align</button></header>
    <div className="align-types-intro"><p>A small reason for today. A goal to work toward. A direction to explore. Start wherever you are, and connect thoughts when they come.</p></div>
    <div className="align-controls"><div className="align-filters" role="group" aria-label="Alignment type"><button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All <span>{active.length}</span></button>{(Object.keys(alignmentTypes) as AlignmentKind[]).map((kind) => <button key={kind} aria-pressed={filter === kind} onClick={() => setFilter(kind)}>{alignmentTypes[kind].plural} <span>{active.filter((entry) => entry.kind === kind).length}</span></button>)}<button aria-pressed={filter === 'archived'} onClick={() => setFilter('archived')}>Archived</button></div><div className="view-switch" role="group" aria-label="Align view"><button type="button" aria-label="List view" title="List view" aria-pressed={layout === 'list'} onClick={() => setLayout('list')}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 5h9M7.5 10h9M7.5 15h9M3.5 5h.01M3.5 10h.01M3.5 15h.01" /></svg></button><button type="button" aria-label="Gallery view" title="Gallery view" aria-pressed={layout === 'gallery'} onClick={() => setLayout('gallery')}><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="5.5" height="5.5" rx="1"/><rect x="11.5" y="3" width="5.5" height="5.5" rx="1"/><rect x="3" y="11.5" width="5.5" height="5.5" rx="1"/><rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1"/></svg></button></div></div>
    {error ? <p className="align-error" role="alert">{error}</p> : null}
    <div className={`alignment-list ${layout === 'list' ? 'as-list' : 'as-gallery'}`}>{visible.map((entry) => {
      const type = alignmentTypes[entry.kind];
      const linked = items.filter((item) => entry.intentionIds.includes(item.id));
      const status = entry.archived
        ? { label: 'Archived', tone: 'state-neutral', icon: 'archive' as const }
        : entry.syncState === 'conflict'
          ? { label: 'Needs review', tone: 'state-error', icon: 'alert' as const }
          : entry.syncState === 'pending'
            ? { label: 'Waiting to sync', tone: 'state-pending', icon: 'time' as const }
            : { label: 'Synced', tone: 'state-success', icon: 'cloud' as const };
      return <article className="alignment-card" key={entry.id}><div className="alignment-card-heading"><span className={`alignment-kind kind-${entry.kind}`}><UiIcon name={type.icon} />{type.label}</span><span className={`alignment-sync ${status.tone}`}><UiIcon name={status.icon} />{status.label}</span></div><h2>{entry.title}</h2>{entry.note ? <p className="alignment-note">{entry.note}</p> : null}
        {entry.conflict ? <div className="alignment-conflict" role="status"><b>Changed on another device</b><p>Your edits are kept here. The synced version is “{entry.conflict.title}”. Open the editor to compare both versions.</p><button className="outline-button" onClick={() => setEditor({ entry, kind: entry.kind })}>Review versions</button></div> : entry.syncError ? <p className="align-error" role="status">{entry.syncError}</p> : null}
        <div className="alignment-thoughts"><span className="alignment-thought-count">{linked.length ? `${linked.length} linked thought${linked.length === 1 ? '' : 's'}` : entry.intentionIds.length ? 'Linked thoughts are archived or unavailable.' : 'No thoughts linked yet. This can stand on its own.'}</span>{linked.map((item) => <button key={item.id} onClick={() => onOpen(item.id)}><ThoughtStatus status={item.status} compact />{item.title}</button>)}</div>
        <div className="alignment-actions"><button className="outline-button" onClick={() => setEditor({ entry, kind: entry.kind })}><UiIcon name="edit" />{entry.archived ? 'Edit entry' : 'Edit & link thoughts'}</button><button className="subtle-button" disabled={entry.syncState === 'conflict'} onClick={() => archive(entry)}><UiIcon name={entry.archived ? 'restore' : 'archive'} />{entry.archived ? 'Restore' : 'Archive'}</button></div>
      </article>;
    })}</div>
    {!visible.length ? <div className="alignment-empty"><span aria-hidden="true">{filter !== 'all' && filter !== 'archived' ? <UiIcon name={alignmentTypes[filter].icon} /> : <UiIcon name="align" />}</span><h2>{filter === 'archived' ? 'Nothing archived.' : filter === 'all' ? 'What matters to you right now?' : `Make room for a ${alignmentTypes[filter].label.toLowerCase()}.`}</h2><p>{filter === 'archived' ? 'Archived entries stay here so you can restore them.' : 'Create an entry now. You can link thoughts later.'}</p>{filter !== 'archived' ? <button className="outline-button" onClick={() => setEditor({ kind: filter === 'all' ? 'reason' : filter })}>Add {filter === 'all' ? 'a reason' : `a ${alignmentTypes[filter].label.toLowerCase()}`}</button> : null}</div> : null}
    {editor ? <Modal label={editor.entry ? 'Edit Align entry' : 'Add to Align'} className="alignment-dialog" onClose={() => setEditor(null)}><AlignmentEditor entry={editor.entry} initialKind={editor.kind} items={items} onSave={onSave} onUseSynced={onUseSynced} onClose={() => setEditor(null)} /></Modal> : null}
  </section>;
}

export function AlignmentEditor({ entry, initialKind, items, onSave, onUseSynced, onClose }: {
  entry?: LocalAlignment; initialKind: AlignmentKind; items: SyncIntention[]; onSave: Save; onUseSynced: (id: string) => void; onClose: () => void;
}) {
  const [kind, setKind] = useState(initialKind);
  const [title, setTitle] = useState(entry?.title ?? '');
  const [note, setNote] = useState(entry?.note ?? '');
  const [linkedIds, setLinkedIds] = useState(entry?.intentionIds ?? []);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [replaceConflict, setReplaceConflict] = useState(false);
  const type = alignmentTypes[kind];
  const candidates = items.filter((item) => !search.trim() || item.title.toLowerCase().includes(search.trim().toLowerCase()));
  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      onSave({ id: entry?.id, kind, title: title.trim(), note: note.trim(), intentionIds: linkedIds, archived: entry?.archived ?? false }, entry?.version ?? null, replaceConflict);
      onClose();
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save this entry. Your draft is still here.'); }
  }
  function toggle(id: string) { setLinkedIds((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]); }
  return <form className="alignment-editor" onSubmit={submit}><h2>{entry ? 'Give it shape.' : 'Start with what matters.'}</h2><p className="alignment-editor-lede">This entry is yours, with or without any linked thoughts.</p>
    <fieldset className="alignment-kind-picker"><legend>What are you adding?</legend>{(Object.keys(alignmentTypes) as AlignmentKind[]).map((value) => <label key={value}><input type="radio" name="alignment-kind" checked={kind === value} onChange={() => setKind(value)} /><span className="alignment-choice-icon"><UiIcon name={alignmentTypes[value].icon} /></span><span><b>{alignmentTypes[value].label}</b><small>{alignmentTypes[value].hint}</small></span></label>)}</fieldset>
    <label className="alignment-field">Name your {type.label.toLowerCase()}<input value={title} maxLength={160} required placeholder={type.example} onChange={(event) => setTitle(event.target.value)} /></label>
    <label className="alignment-field">{type.contextLabel} <span>Optional</span><small>{type.contextHint}</small><textarea rows={3} value={note} maxLength={4000} onChange={(event) => setNote(event.target.value)} placeholder={type.contextHint} /></label>
    <fieldset className="alignment-link-picker"><legend>Link thoughts <span>Optional · {linkedIds.length} selected</span></legend><p>You can connect several thoughts, or save this on its own.</p>{items.length ? <><label className="alignment-field">Find a thought<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your thoughts" /></label><div className="alignment-link-list">{candidates.map((item) => <label key={item.id}><input type="checkbox" checked={linkedIds.includes(item.id)} onChange={() => toggle(item.id)} /><span>{item.title}{item.status === 'completed' ? <small>Completed</small> : null}</span></label>)}{!candidates.length ? <p>No thoughts match your search.</p> : null}</div></> : <p>No thoughts yet. You can link them whenever you’re ready.</p>}{linkedIds.filter((id) => !items.some((item) => item.id === id)).map((id) => <label className="alignment-missing-link" key={id}><input type="checkbox" checked onChange={() => toggle(id)} />Archived or unavailable thought <small>Uncheck to remove this link</small></label>)}</fieldset>
    {entry?.conflict ? <div className="alignment-conflict"><h3>Synced version</h3><b>{alignmentTypes[entry.conflict.kind].label}: {entry.conflict.title}</b><p>{entry.conflict.note || 'No extra context.'}</p><p>{entry.conflict.intentionIds.length} linked thoughts</p><button className="outline-button" type="button" onClick={() => { try { onUseSynced(entry.id); onClose(); } catch (error) { setError(error instanceof Error ? error.message : 'Could not save this choice.'); } }}>Use synced version</button><label><input type="checkbox" checked={replaceConflict} onChange={(event) => setReplaceConflict(event.target.checked)} />Replace the synced version with my edits</label></div> : null}
    {error ? <p className="align-error" role="alert">{error}</p> : null}
    <div className="alignment-editor-actions"><button className="outline-button" type="button" onClick={onClose}>Cancel</button><button className="capture-button" disabled={!title.trim() || Boolean(entry?.conflict && !replaceConflict)} type="submit">{entry ? 'Save changes' : `Create ${type.label.toLowerCase()}`}</button></div>
  </form>;
}
