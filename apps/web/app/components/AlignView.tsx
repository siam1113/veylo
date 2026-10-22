import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { AlignmentContent, AlignmentKind, IntentionStatus } from '@clearhead/domain';
import type { SyncIntention } from '../lib/sync.client';
import type { LocalAlignment } from '../lib/alignments.client';
import { Modal } from './Modal';
import { TabHeader } from './TabHeader';
import { SegmentedTabs } from './SegmentedTabs';
import { UiIcon, type UiIconName } from './UiIcon';
import { ThoughtStatus, thoughtStatusMeta } from './ThoughtStatus';
import { RollingLabel } from './RollingLabel';
import { useReducedMotionPref } from '../lib/motion-prefs.client';
import { listItemVariants, listItemTransition, listCardTransition, listHoverLift, listRowHoverLift, listTap } from '../lib/list-motion';
import { RichTextField } from './RichTextField';
import { RichTextView } from './RichTextView';
import { PreviewModal } from './PreviewModal';
import { isRichTextEmpty } from '../lib/rich-text';
import { BreakdownBar } from './BreakdownBar';

const thoughtTallyOrder: IntentionStatus[] = ['completed', 'active', 'ready', 'planned', 'exploring', 'captured', 'archived'];
const thoughtKindIcons: Record<string, UiIconName> = { idea: 'kind-idea', action: 'kind-action', question: 'kind-question', goal: 'kind-goal', commitment: 'kind-commitment', meeting: 'kind-meeting', note: 'kind-note', unclassified: 'kind-unclassified' };
// Fixed display + color-slot order for thought kinds. Never reorder per entry — the
// order is what keeps each kind's color stable and CVD-distinguishable across cards.
const thoughtKindOrder = ['idea', 'action', 'question', 'goal', 'commitment', 'meeting', 'note', 'unclassified'] as const;
const thoughtKindLabels: Record<string, [string, string]> = { idea: ['Idea', 'Ideas'], action: ['Action', 'Actions'], question: ['Question', 'Questions'], goal: ['Goal', 'Goals'], commitment: ['Commitment', 'Commitments'], meeting: ['Conversation', 'Conversations'], note: ['Note', 'Notes'], unclassified: ['Unsorted', 'Unsorted'] };
function thoughtKindLabel(kind: string, count: number) { const pair = thoughtKindLabels[kind] ?? thoughtKindLabels.unclassified; return pair[count === 1 ? 0 : 1]; }

/** Shared by the card's linked-thought count badge and the preview modal's breakdown, so
 * both read the same tally instead of recomputing it with slightly different logic. */
export function alignmentThoughtBreakdown(entry: { intentionIds: string[] }, items: SyncIntention[]) {
  const linked = items.filter((item) => entry.intentionIds.includes(item.id));
  const tally = linked.reduce<Partial<Record<IntentionStatus, number>>>((acc, link) => {
    const key = link.status as IntentionStatus;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const kindTally = linked.reduce<Partial<Record<string, number>>>((acc, link) => {
    const key = thoughtKindIcons[link.kind] ? link.kind : 'unclassified';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const presentKinds = thoughtKindOrder.filter((key) => kindTally[key]);
  return { linked, tally, kindTally, presentKinds };
}

export const alignmentTypes: Record<AlignmentKind, { label: string; plural: string; hint: string; example: string; contextLabel: string; contextHint: string; icon: UiIconName }> = {
  reason: { label: 'Reason', plural: 'Reasons', hint: 'A reason this matters, even just for now.', example: 'Make weekday mornings less rushed', contextLabel: 'Why does this matter to you?', contextHint: 'Add the motivation, people, or circumstances you want to keep in mind.', icon: 'reason' },
  goal: { label: 'Goal', plural: 'Goals', hint: 'A result you want to reach.', example: 'Finish the first draft', contextLabel: 'What would success look like, and by when?', contextHint: 'Describe a clear outcome, milestone, or target date. The date is optional.', icon: 'goal' },
  direction: { label: 'Direction', plural: 'Directions', hint: 'A path you want to explore or grow into.', example: 'Make more room for creative work', contextLabel: 'What would help you explore this direction?', contextHint: 'Note an area to explore, a small experiment, or a next step.', icon: 'direction' },
  value: { label: 'Value', plural: 'Values', hint: 'Something you want your choices to reflect.', example: 'Stay present with the people I care about', contextLabel: 'How would you like this value to show up?', contextHint: 'Describe the choices, habits, or relationships where this matters.', icon: 'value' },
};
type Save = (entry: AlignmentContent & { id?: string }, version: number | null, replaceConflict?: boolean) => void;

/** The card's overflow menu: Preview/Edit/Archive/Delete live here so the card itself only
 * shows status and the linked-thoughts badge. Closes on an outside click, Escape, or after
 * any menu item is chosen (a click on an item bubbles to the panel's own close handler). */
function AlignCardMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => { if (container.current && !container.current.contains(event.target as Node)) setOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('mousedown', closeOutside); document.removeEventListener('keydown', closeOnEscape); };
  }, [open]);
  return <div className="alignment-card-menu" ref={container}>
    <button ref={trigger} type="button" className="alignment-card-menu-trigger" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((value) => !value)}><UiIcon name="more" /></button>
    {open && <div className="alignment-card-menu-panel" role="menu" aria-label={label} onClick={() => setOpen(false)}>{children}</div>}
  </div>;
}

export function AlignView({ entries, items, onSave, onUseSynced, onDelete, onOpenIntention }: {
  entries: LocalAlignment[]; items: SyncIntention[]; onSave: Save; onUseSynced: (id: string) => void; onDelete: (id: string) => void; onOpenIntention: (id: string) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'archived' | AlignmentKind>('all');
  const [layout, setLayout] = useState<'gallery' | 'list'>('gallery');
  const [editor, setEditor] = useState<{ entry?: LocalAlignment; kind: AlignmentKind } | null>(null);
  const [previewFor, setPreviewFor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const reduceMotion = useReducedMotionPref();
  const active = entries.filter((entry) => !entry.archived);
  const visible = entries.filter((entry) => filter === 'archived' ? entry.archived : !entry.archived && (filter === 'all' || entry.kind === filter));
  function archive(entry: LocalAlignment) {
    try { onSave({ ...entry, archived: !entry.archived }, entry.version); setError(''); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not save this change.'); }
  }
  function remove(entry: LocalAlignment) {
    if (!window.confirm('Permanently delete this entry? This cannot be undone.')) return;
    onDelete(entry.id);
  }
  return <section className="view active align-workspace">
    <TabHeader icon="align" title="Align" tagline="Give your thoughts something to move toward." action={<button className="capture-button tab-header-cta" onClick={() => setEditor({ kind: filter === 'all' || filter === 'archived' ? 'reason' : filter })}><RollingLabel>＋ Add to Align</RollingLabel></button>} />
    <div className="align-controls">
      <SegmentedTabs ariaLabel="Alignment type" value={filter} onChange={(next) => setFilter(next as typeof filter)} items={[
        { value: 'all', label: 'All', count: active.length },
        ...(Object.keys(alignmentTypes) as AlignmentKind[]).map((kind) => ({ value: kind, label: alignmentTypes[kind].plural, icon: <UiIcon name={alignmentTypes[kind].icon} />, count: active.filter((entry) => entry.kind === kind).length })),
        { value: 'archived', label: 'Archived', icon: <UiIcon name="archive" /> },
      ]} />
      <SegmentedTabs ariaLabel="Align view" size="sm" iconOnly value={layout} onChange={(next) => setLayout(next as typeof layout)} items={[
        { value: 'list', ariaLabel: 'List view', icon: <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M7.5 5h9M7.5 10h9M7.5 15h9M3.5 5h.01M3.5 10h.01M3.5 15h.01" /></svg> },
        { value: 'gallery', ariaLabel: 'Gallery view', icon: <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="5.5" height="5.5" rx="1" /><rect x="11.5" y="3" width="5.5" height="5.5" rx="1" /><rect x="3" y="11.5" width="5.5" height="5.5" rx="1" /><rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1" /></svg> },
      ]} />
    </div>
    {error ? <p className="align-error" role="alert">{error}</p> : null}
    <div className={`alignment-list ${layout === 'list' ? 'as-list' : 'as-gallery'}`}><AnimatePresence mode="popLayout" initial={false}>{visible.map((entry, index) => {
      const type = alignmentTypes[entry.kind];
      const { linked } = alignmentThoughtBreakdown(entry, items);
      const status = entry.archived
        ? { label: 'Archived', tone: 'state-neutral', icon: 'archive' as const }
        : entry.syncState === 'conflict'
          ? { label: 'Needs review', tone: 'state-error', icon: 'alert' as const }
          : entry.syncState === 'pending'
            ? { label: 'Waiting to sync', tone: 'state-pending', icon: 'time' as const }
            : { label: 'Synced', tone: 'state-success', icon: 'cloud' as const };
      return <motion.article className="alignment-card" key={entry.id} layout="position" variants={listItemVariants} initial="hidden" animate="visible" exit="exit"
        transition={listCardTransition(index, reduceMotion)} whileHover={reduceMotion ? undefined : listHoverLift} whileTap={reduceMotion ? undefined : listTap}>
        <div className="alignment-card-heading"><span className={`alignment-kind kind-${entry.kind}`}><UiIcon name={type.icon} />{type.label}</span><div className="alignment-card-tools">
          <span className={`alignment-sync ${status.tone}`}><UiIcon name={status.icon} />{status.label}</span>
          {linked.length ? <button type="button" className="alignment-thoughts-badge" aria-label={`${linked.length} linked thought${linked.length === 1 ? '' : 's'}, show details`} onClick={() => setPreviewFor(entry.id)}><UiIcon name="connections" /><span className="alignment-breakdown-count">{linked.length}</span></button> : null}
          <AlignCardMenu label={`More actions for ${entry.title}`}>
            <button type="button" role="menuitem" className="alignment-card-menu-item" onClick={() => setPreviewFor(entry.id)}><UiIcon name="preview" /><span>Preview</span></button>
            <button type="button" role="menuitem" className="alignment-card-menu-item" onClick={() => setEditor({ entry, kind: entry.kind })}><UiIcon name="edit" /><span>{entry.archived ? 'Edit entry' : 'Edit & link thoughts'}</span></button>
            <button type="button" role="menuitem" className="alignment-card-menu-item" disabled={entry.syncState === 'conflict'} onClick={() => archive(entry)}><UiIcon name={entry.archived ? 'restore' : 'archive'} /><span>{entry.archived ? 'Restore' : 'Archive'}</span></button>
            <button type="button" role="menuitem" className="alignment-card-menu-item is-danger" disabled={entry.syncState === 'conflict'} onClick={() => remove(entry)}><UiIcon name="trash" /><span>Delete</span></button>
          </AlignCardMenu>
        </div></div><h2>{entry.title}</h2>
        {!isRichTextEmpty(entry.note) ? <div className="alignment-note-block"><span className="alignment-note-label">{type.contextLabel}</span><RichTextView html={entry.note} clamp={3} className="alignment-note" /></div> : null}
        {entry.conflict ? <div className="alignment-conflict" role="status"><b>Changed on another device</b><p>Your edits are kept here. The synced version is “{entry.conflict.title}”. Open the editor to compare both versions.</p><button className="outline-button" onClick={() => setEditor({ entry, kind: entry.kind })}>Review versions</button></div> : entry.syncError ? <p className="align-error" role="status">{entry.syncError}</p> : null}
      </motion.article>;
    })}</AnimatePresence></div>
    {!visible.length ? <div className="alignment-empty"><span aria-hidden="true">{filter !== 'all' && filter !== 'archived' ? <UiIcon name={alignmentTypes[filter].icon} /> : <UiIcon name="align" />}</span><h2>{filter === 'archived' ? 'Nothing archived.' : filter === 'all' ? 'What matters to you right now?' : `Make room for a ${alignmentTypes[filter].label.toLowerCase()}.`}</h2><p>{filter === 'archived' ? 'Archived entries stay here so you can restore them.' : 'Create an entry now. You can link thoughts later.'}</p>{filter !== 'archived' ? <button className="outline-button" onClick={() => setEditor({ kind: filter === 'all' ? 'reason' : filter })}>Add {filter === 'all' ? 'a reason' : `a ${alignmentTypes[filter].label.toLowerCase()}`}</button> : null}</div> : null}
    <AnimatePresence>{editor ? <Modal key="align-editor" label={editor.entry ? 'Edit Align entry' : 'Add to Align'} className="alignment-dialog" onClose={() => setEditor(null)}><AlignmentEditor entry={editor.entry} initialKind={editor.kind} items={items} onSave={onSave} onUseSynced={onUseSynced} onClose={() => setEditor(null)} /></Modal> : null}</AnimatePresence>
    <AnimatePresence>{previewFor ? (() => {
      const previewEntry = entries.find((entry) => entry.id === previewFor);
      if (!previewEntry) return null;
      const { linked, tally, kindTally, presentKinds } = alignmentThoughtBreakdown(previewEntry, items);
      const closeAndOpen = (id: string) => { setPreviewFor(null); onOpenIntention(id); };
      const extra = linked.length ? <div className="alignment-preview-thoughts">
        <div className="alignment-breakdown-row">
          <div className="alignment-breakdown-group">
            <span className="alignment-breakdown-subhead">Type</span>
            <BreakdownBar ariaLabel={`Breakdown by type: ${presentKinds.map((key) => `${kindTally[key]} ${thoughtKindLabel(key, kindTally[key] ?? 0)}`).join(', ')}`}
              items={presentKinds.map((key) => ({ key, label: thoughtKindLabel(key, kindTally[key] ?? 0), icon: thoughtKindIcons[key], value: kindTally[key] ?? 0, valueLabel: String(kindTally[key] ?? 0), colorClass: `kind-${key}` }))} />
          </div>
          <div className="alignment-breakdown-group">
            <span className="alignment-breakdown-subhead">Status</span>
            <BreakdownBar ariaLabel={`Breakdown by status: ${thoughtTallyOrder.filter((key) => tally[key]).map((key) => `${tally[key]} ${thoughtStatusMeta[key].label}`).join(', ')}`}
              items={thoughtTallyOrder.filter((key) => tally[key]).map((key) => { const meta = thoughtStatusMeta[key]; return { key, label: meta.label, icon: meta.icon, value: tally[key] ?? 0, valueLabel: String(tally[key] ?? 0), colorClass: `status-${meta.tone}` }; })} />
          </div>
        </div>
        <div className="alignment-breakdown-group">
          <span className="alignment-breakdown-subhead">Thoughts</span>
          <div className="alignment-linked-list">
            <div className="alignment-linked-head" aria-hidden="true"><span>Thought</span><span>Status</span></div>
            {linked.map((link, linkIndex) => <motion.button type="button" className="alignment-link-row" key={link.id} onClick={() => closeAndOpen(link.id)}
              initial="hidden" animate="visible" variants={listItemVariants} transition={listItemTransition(linkIndex, reduceMotion)}
              whileHover={reduceMotion ? undefined : listRowHoverLift} whileTap={reduceMotion ? undefined : listTap}>
              <span className="alignment-link-icon"><UiIcon name={thoughtKindIcons[link.kind] ?? 'kind-unclassified'} /></span>
              <span className="alignment-link-copy">
                <span className="alignment-link-title">{link.title}</span>
                {link.rawCapture && link.rawCapture !== link.title ? <span className="alignment-link-snippet">{link.rawCapture}</span> : null}
              </span>
              <ThoughtStatus status={link.status} />
              <span className="alignment-link-chevron" aria-hidden="true">›</span>
            </motion.button>)}
          </div>
        </div>
      </div> : previewEntry.intentionIds.length ? <p className="alignment-thought-count">Linked thoughts are archived or unavailable.</p> : null;
      return <PreviewModal key="align-preview" title={previewEntry.title} onClose={() => setPreviewFor(null)} sections={[{ label: alignmentTypes[previewEntry.kind].contextLabel, html: previewEntry.note }]} extra={extra} />;
    })() : null}</AnimatePresence>
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
    <RichTextField id="alignment-note" label={type.contextLabel} labelExtra={<span className="alignment-field-optional">Optional</span>} hint={type.contextHint}
      value={note} onChange={setNote} placeholder={type.contextHint} maxLength={4000}
      polishFieldKind="alignmentNote" polishContextTitle={title.trim() || undefined} />
    <fieldset className="alignment-link-picker"><legend>Link thoughts <span className="alignment-link-optional">Optional</span>{linkedIds.length ? <span className="alignment-link-count">{linkedIds.length} selected</span> : null}</legend><p>You can connect several thoughts, or save this on its own.</p>{items.length ? <><label className="alignment-field">Find a thought<div className="alignment-search-input"><UiIcon name="search" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your thoughts" /></div></label><div className="alignment-link-list">{candidates.map((item) => <label key={item.id} className={`alignment-link-row${linkedIds.includes(item.id) ? ' is-selected' : ''}`}><span className="alignment-link-icon"><UiIcon name={thoughtKindIcons[item.kind] ?? 'kind-unclassified'} /></span><span className="alignment-link-copy"><span className="alignment-link-title">{item.title}</span>{item.status === 'completed' ? <span className="alignment-link-status">Completed</span> : null}</span><input type="checkbox" checked={linkedIds.includes(item.id)} onChange={() => toggle(item.id)} /></label>)}{!candidates.length ? <p className="alignment-link-empty">No thoughts match your search.</p> : null}</div></> : <p>No thoughts yet. You can link them whenever you’re ready.</p>}{linkedIds.filter((id) => !items.some((item) => item.id === id)).map((id) => <label className="alignment-missing-link" key={id}><input type="checkbox" checked onChange={() => toggle(id)} />Archived or unavailable thought <small>Uncheck to remove this link</small></label>)}</fieldset>
    {entry?.conflict ? <div className="alignment-conflict"><h3>Synced version</h3><b>{alignmentTypes[entry.conflict.kind].label}: {entry.conflict.title}</b>{entry.conflict.note ? <RichTextView html={entry.conflict.note} /> : <p>No extra context.</p>}<p>{entry.conflict.intentionIds.length} linked thoughts</p><button className="outline-button" type="button" onClick={() => { try { onUseSynced(entry.id); onClose(); } catch (error) { setError(error instanceof Error ? error.message : 'Could not save this choice.'); } }}>Use synced version</button><label><input type="checkbox" checked={replaceConflict} onChange={(event) => setReplaceConflict(event.target.checked)} />Replace the synced version with my edits</label></div> : null}
    {error ? <p className="align-error" role="alert">{error}</p> : null}
    <div className="alignment-editor-actions"><button className="outline-button" type="button" onClick={onClose}>Cancel</button><button className="capture-button" disabled={!title.trim() || Boolean(entry?.conflict && !replaceConflict)} type="submit">{entry ? 'Save changes' : `Create ${type.label.toLowerCase()}`}</button></div>
  </form>;
}
