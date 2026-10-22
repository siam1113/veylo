import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { ProviderBadge } from './ProviderBadge';
import { providerDisplayName } from '../lib/provider-logos';
import { requestEventDescription } from '../lib/event-description.client';

const stages = ['Reading the thought…', 'Drafting a description…', 'Tidying it up…'];
const STAGE_INTERVAL_MS = 900;

type Step = 'select' | 'details' | 'preview';
const stepOrder: Step[] = ['select', 'details', 'preview'];
const stepLabels: Record<Step, string> = { select: 'Choose calendar', details: 'Title & description', preview: 'Preview & book' };

function plainFallback(intent: string, purpose: string): string {
  return [intent, purpose ? `Why it matters: ${purpose}` : ''].filter(Boolean).join('\n\n');
}

export type CalendarAccountOption = { id: string; provider: string; accountLabel?: string | null; email?: string | null };

export function AddToCalendarModal({ item, block, accounts, onConfirm, onClose }: {
  item: { title: string; intent: string; purpose: string };
  block: { remoteId: string; date: string; time: string; duration: number };
  accounts: CalendarAccountOption[];
  onConfirm: (title: string, description: string, integrationIds: string[]) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>('select');
  const [working, setWorking] = useState(true);
  const [stageIndex, setStageIndex] = useState(0);
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set(accounts.map((account) => account.id)));
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const mounted = useRef(true);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function generate() {
    setWorking(true); setStageIndex(0);
    timer.current = setInterval(() => setStageIndex((index) => Math.min(index + 1, stages.length - 1)), STAGE_INTERVAL_MS);
    try {
      const result = await requestEventDescription({ timeBlockId: block.remoteId });
      if (!mounted.current) return;
      setDescription(result);
    } catch {
      if (!mounted.current) return;
      // Generation itself always has a server-side fallback; this only catches the
      // request failing outright (offline, signed out) - fall back locally too.
      setDescription(plainFallback(item.intent, item.purpose));
    } finally {
      if (mounted.current) { clearInterval(timer.current); setWorking(false); }
    }
  }

  useEffect(() => {
    mounted.current = true;
    void generate();
    return () => { mounted.current = false; clearInterval(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedCount = selected.size;
  const selectedAccounts = accounts.filter((account) => selected.has(account.id));
  const soleSelected = selectedCount === 1 ? selectedAccounts[0] : undefined;
  const heading = soleSelected ? `Add to ${providerDisplayName(soleSelected.provider)}` : selectedCount === 0 ? 'Add to calendar' : `Add to ${selectedCount} calendars`;
  const stepIndex = stepOrder.indexOf(step);

  return <Modal className="settings-dialog" label="Add to calendar" onClose={onClose}>
    <div className="settings-content">
      <div className="date-label">ADD TO CALENDAR</div>
      <h2>{heading}</h2>
      <p className="wizard-step-indicator">Step {stepIndex + 1} of {stepOrder.length} · {stepLabels[step]}</p>
      <p className="settings-lede">{block.date} at {block.time} · {block.duration} minutes</p>

      {step === 'select' && <>
        <fieldset className="calendar-account-picker">
          <legend>Add to</legend>
          {accounts.map((account) => <label key={account.id} className="calendar-account-option">
            <input type="checkbox" checked={selected.has(account.id)} onChange={() => toggle(account.id)} />
            <ProviderBadge provider={account.provider} />
            <span>{providerDisplayName(account.provider)}{account.accountLabel ? ` · ${account.accountLabel}` : account.email ? ` · ${account.email}` : ''}</span>
          </label>)}
        </fieldset>
        <div className="settings-actions">
          <button className="outline-button" type="button" onClick={onClose}>Cancel</button>
          <button className="capture-button" type="button" disabled={selectedCount === 0} onClick={() => setStep('details')}><span>Continue</span></button>
        </div>
      </>}

      {step === 'details' && <>
        {working ? <div className="calendar-confirm-loading" role="status" aria-live="polite">
          <span className="ai-polish-spinner" aria-hidden="true" />
          <p>{stages[stageIndex]}</p>
        </div> : <div className="detail-fields">
          <div className="detail-field"><label htmlFor="calendar-confirm-title">Title</label><input id="calendar-confirm-title" type="text" maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /></div>
          <div className="detail-field"><label htmlFor="calendar-confirm-description">Description</label><textarea id="calendar-confirm-description" maxLength={2000} rows={6} value={description} onChange={(event) => setDescription(event.target.value)} /></div>
        </div>}
        <p className="settings-lede">This only changes what's sent to your calendar — your thought in ClearHead stays as-is.</p>
        <div className="settings-actions">
          <button className="outline-button" type="button" onClick={() => setStep('select')}>Back</button>
          <button className="outline-button" type="button" disabled={working} onClick={() => void generate()}>Regenerate</button>
          <button className="capture-button" type="button" disabled={working || !title.trim()} onClick={() => setStep('preview')}><span>Continue</span></button>
        </div>
      </>}

      {step === 'preview' && <>
        <div className="calendar-preview">
          <div className="calendar-preview-accounts">
            {selectedAccounts.map((account) => <span key={account.id} className="calendar-preview-account">
              <ProviderBadge provider={account.provider} />
              {providerDisplayName(account.provider)}{account.accountLabel ? ` · ${account.accountLabel}` : account.email ? ` · ${account.email}` : ''}
            </span>)}
          </div>
          <div className="calendar-preview-field"><b>{title}</b></div>
          {description ? <p className="calendar-preview-description">{description}</p> : null}
        </div>
        <div className="settings-actions">
          <button className="outline-button" type="button" onClick={() => setStep('details')}>Back</button>
          <button className="capture-button" type="button" disabled={selectedCount === 0 || !title.trim()} onClick={() => onConfirm(title.trim(), description, [...selected])}><span>Add to calendar</span></button>
        </div>
      </>}
    </div>
  </Modal>;
}
