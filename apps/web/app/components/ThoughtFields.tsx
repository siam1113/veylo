import { useEffect, useRef, useState } from 'react';
import { defaultThoughtFields, thoughtFieldKeys, type ThoughtField, type CustomField } from '@clearhead/domain';
import type { SyncIntention, SyncClient } from '../lib/sync.client';
import type { PolishFieldKind } from '../lib/ai-polish.client';
import { UiIcon } from './UiIcon';
import { RichTextField } from './RichTextField';

const richTextKeys: Partial<Record<typeof thoughtFieldKeys[number], PolishFieldKind>> = {
  intent: 'intent', purpose: 'purpose', desiredOutcome: 'desiredOutcome', roughPlan: 'roughPlan',
};

export const thoughtFieldLabels: Record<typeof thoughtFieldKeys[number], string> = {
  intent: 'Your thought', purpose: 'Why it matters', desiredOutcome: 'Desired outcome',
  roughPlan: 'Notes and next steps', horizon: 'When might this fit?',
  effortEstimate: 'Estimated effort (minutes)', energyContext: 'Energy or focus context',
};

const maxCustomFields = 10;

export function ThoughtFields({ item, draft, onChange, enabled, client, onPreferences }: {
  item: SyncIntention; draft: Partial<SyncIntention>; onChange: (key: string, value: string | number | null | CustomField[]) => void;
  enabled: boolean; client: SyncClient | null; onPreferences: () => void;
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const started = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const evaluation = item.fieldEvaluation;
  const kind = String(draft.kind ?? item.kind);
  const aiSuggestedKeys = new Set(enabled && evaluation && kind === item.kind ? evaluation.fields.map((field) => field.key) : []);
  const hasUnsavedChanges = ['title', 'kind', ...thoughtFieldKeys].some((key) => draft[key] !== undefined && (draft[key] ?? '') !== (item[key] ?? ''));
  const fields: ThoughtField[] = [...(enabled && evaluation && kind === item.kind ? evaluation.fields : defaultThoughtFields(kind))];
  // Evaluation can never hide existing answers, including unsaved edits.
  for (const key of thoughtFieldKeys) {
    const value = draft[key] === undefined ? item[key] : draft[key];
    if (value !== null && value !== undefined && value !== '' && !fields.some((field) => field.key === key)) fields.push({ key, label: thoughtFieldLabels[key], hint: '' });
  }
  async function evaluate() {
    if (!client || !item.remoteId) return;
    setBusy(true); setMessage('Finding useful questions for this thought…');
    try {
      await client.evaluateThought(item.remoteId);
      if (!mounted.current) return;
      timer.current = setTimeout(() => { setBusy(false); setMessage('Evaluation is taking longer than expected. You can keep editing or retry.'); }, 45000);
    } catch (error) {
      if (mounted.current) { setBusy(false); setMessage(error instanceof Error ? error.message : 'Could not evaluate this thought. Try again.'); }
    }
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimeout(timer.current); }; }, []);
  useEffect(() => {
    if (!started.current && enabled && !evaluation && client && item.remoteId && item.syncState !== 'pending' && !['archived', 'trashed'].includes(item.status)) {
      started.current = true; void evaluate();
    }
  }, [enabled, client, item.remoteId, item.syncState, item.status, evaluation]);
  useEffect(() => { if (evaluation) { clearTimeout(timer.current); setBusy(false); setMessage(''); } }, [evaluation?.evaluatedAt]);
  const customFields: CustomField[] = (draft.customFields === undefined ? item.customFields : draft.customFields) ?? [];
  function setCustomFields(next: CustomField[]) { onChange('customFields', next); }
  function addCustomField() { setCustomFields([...customFields, { key: crypto.randomUUID(), label: '', value: '' }]); }
  function updateCustomField(index: number, change: Partial<CustomField>) { setCustomFields(customFields.map((field, i) => i === index ? { ...field, ...change } : field)); }
  function removeCustomField(index: number) { setCustomFields(customFields.filter((_, i) => i !== index)); }
  useEffect(() => {
    if (!enabled || !client || ['archived', 'trashed'].includes(item.status)) return;
    if (!busy && evaluation && evaluation.sourceVersion >= (item.version ?? 1) - 1 && item.syncState !== 'pending') return;
    const poll = setInterval(() => void client.flush(), 2000);
    const stop = setTimeout(() => clearInterval(poll), 45000);
    return () => { clearInterval(poll); clearTimeout(stop); };
  }, [enabled, client, busy, evaluation?.sourceVersion, item.version, item.syncState, item.status]);
  return <>
    <div className="thought-evaluation">
      <div><b>{enabled && evaluation ? `Shaped as ${evaluation.kind === 'action' ? 'a task' : evaluation.kind === 'idea' ? 'an idea' : `a ${evaluation.kind}`}` : 'Give your thought a little shape'}</b>
        <p role="status">{message || (!enabled ? 'Start with these fields, or enable AI to suggest questions for this thought.' : hasUnsavedChanges || item.syncState === 'pending' ? 'Save and sync your changes to refresh the questions.' : evaluation ? 'Questions adapt to your thought. Every detail is optional.' : 'Start here while we find the details that would help.')}</p></div>
      {!enabled ? <button className="outline-button" type="button" onClick={onPreferences}>AI preferences</button> : <button className="outline-button" type="button" disabled={busy || hasUnsavedChanges || !client || !item.remoteId || item.syncState === 'pending' || ['archived', 'trashed'].includes(item.status)} onClick={() => void evaluate()}>{busy ? 'Evaluating…' : 'Refresh questions'}</button>}
    </div>
    <div className="detail-fields">
      {fields.map(({ key, label, hint }) => {
        const value = draft[key] === undefined ? item[key] : draft[key];
        const inputId = `thought-${key}`;
        const aiBadge = aiSuggestedKeys.has(key) ? <UiIcon className="ai-field-icon" name="suggestions" title="AI suggested field" aria-label="AI suggested field" /> : null;
        const polishFieldKind = richTextKeys[key];
        if (polishFieldKind) {
          return <RichTextField key={key} id={inputId} label={label} labelExtra={aiBadge} hint={hint}
            value={String(value ?? '')} onChange={(html) => onChange(key, html)}
            polishFieldKind={polishFieldKind} polishContextTitle={String(draft.title ?? item.title)}
            maxLength={key === 'roughPlan' ? 8000 : 4000} />;
        }
        return <div className="detail-field" key={key}><label htmlFor={inputId}>{label}{aiBadge}</label>
          {hint ? <p id={`${inputId}-hint`} className="thought-field-hint">{hint}</p> : null}
          {key === 'horizon' ? <select id={inputId} value={String(value ?? '')} aria-describedby={hint ? `${inputId}-hint` : undefined} onChange={(event) => onChange(key, event.target.value || null)}><option value="">Not decided</option><option value="today">Today</option><option value="week">This week</option><option value="month">This month</option><option value="someday">Someday</option><option value="custom">Another time</option></select>
            : key === 'effortEstimate' ? <input id={inputId} type="number" min={0} max={10080} step={1} value={String(value ?? '')} aria-describedby={hint ? `${inputId}-hint` : undefined} onChange={(event) => onChange(key, event.target.value === '' ? null : Number(event.target.value))} />
              : <textarea id={inputId} rows={2} maxLength={120} value={String(value ?? '')} aria-describedby={hint ? `${inputId}-hint` : undefined} onChange={(event) => onChange(key, event.target.value)} />}
        </div>;
      })}
    </div>
    <div className="detail-fields custom-fields">
      <div className="custom-fields-head"><h3>Custom fields</h3>{customFields.length < maxCustomFields ? <button type="button" className="text-button" onClick={addCustomField}>+ Add field</button> : null}</div>
      {customFields.map((field, index) => (
        <div className="detail-field custom-field-row" key={field.key}>
          <div className="custom-field-label-row">
            <input className="custom-field-label-input" value={field.label} placeholder="Field name" maxLength={60} aria-label="Custom field name" onChange={(event) => updateCustomField(index, { label: event.target.value })} />
            <button type="button" className="icon-button custom-field-remove" aria-label={`Remove ${field.label || 'field'}`} onClick={() => removeCustomField(index)}><UiIcon name="close" /></button>
          </div>
          <RichTextField id={`custom-field-${field.key}`} label={`${field.label || 'Custom field'} value`} labelHidden value={field.value} onChange={(html) => updateCustomField(index, { value: html })} placeholder="Add details…" maxLength={4000} />
        </div>
      ))}
      {!customFields.length ? <p className="thought-field-hint">Add a field of your own — give it any label you like.</p> : null}
    </div>
  </>;
}
