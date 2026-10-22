import { useEffect, useRef, useState, type ReactNode } from 'react';
import { UiIcon } from './UiIcon';
import { presetsFor, requestPolish, PolishRequestError, type PolishFieldKind } from '../lib/ai-polish.client';

const stages = ['Reading your words…', 'Digesting the context…', 'Polishing…', 'Finishing touches…'];
const STAGE_INTERVAL_MS = 900;

type Stage = 'idle' | 'menu' | 'working' | 'preview' | 'error';

/** The sparkle icon anchored bottom-right of a field, plus its popover menu, progress
 * animation, and preview-before-apply flow. Never touches the field's value itself — the
 * parent only sees `onApply` once the user explicitly picks "Use this". */
export function AiPolish({ fieldKind, contextTitle, getText, renderPreview, onApply, disabled }: {
  fieldKind: PolishFieldKind; contextTitle?: string; getText: () => string;
  renderPreview: (text: string) => ReactNode; onApply: (text: string) => void; disabled?: boolean;
}) {
  const [stage, setStage] = useState<Stage>('idle');
  const [stageIndex, setStageIndex] = useState(0);
  const [custom, setCustom] = useState('');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const mounted = useRef(true);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearInterval(timer.current); }; }, []);
  useEffect(() => {
    if (stage !== 'menu') return;
    const close = (event: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setStage('idle'); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [stage]);

  async function send(instruction: string) {
    const text = getText().trim();
    if (!text) { setError('Add a little text first.'); setStage('error'); return; }
    setStage('working'); setStageIndex(0);
    timer.current = setInterval(() => setStageIndex((index) => Math.min(index + 1, stages.length - 1)), STAGE_INTERVAL_MS);
    try {
      const polished = await requestPolish({ fieldKind, contextTitle, text, instruction });
      if (!mounted.current) return;
      clearInterval(timer.current);
      setResult(polished); setStage('preview');
    } catch (err) {
      if (!mounted.current) return;
      clearInterval(timer.current);
      setError(err instanceof PolishRequestError ? err.message : 'Could not polish this text right now.');
      setStage('error');
    }
  }

  function reset() { setStage('idle'); setCustom(''); setResult(''); setError(''); }

  return <>
    <div className="ai-polish" ref={wrapRef}>
      <button type="button" className="ai-polish-trigger" aria-label="Polish with AI" title="Polish with AI"
        disabled={disabled || stage === 'working' || stage === 'preview'}
        onClick={() => setStage(stage === 'menu' ? 'idle' : 'menu')}>
        <UiIcon name="suggestions" />
      </button>
      {stage === 'menu' && <div className="ai-polish-menu" role="menu">
        <p className="ai-polish-menu-title">Polish this with AI</p>
        <div className="ai-polish-presets">
          {presetsFor(fieldKind).map((preset) => <button type="button" key={preset.label} role="menuitem" onClick={() => void send(preset.instruction)}>{preset.label}</button>)}
        </div>
        <div className="ai-polish-custom">
          <input type="text" value={custom} maxLength={300} placeholder="Or tell it what to do…" aria-label="Custom instruction"
            onChange={(event) => setCustom(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (custom.trim()) void send(custom.trim()); } }} />
          <button type="button" disabled={!custom.trim()} aria-label="Send instruction" onClick={() => { if (custom.trim()) void send(custom.trim()); }}>↗</button>
        </div>
      </div>}
    </div>
    {stage === 'working' && <div className="ai-polish-overlay" role="status" aria-live="polite">
      <span className="ai-polish-spinner" aria-hidden="true" />
      <p>{stages[stageIndex]}</p>
    </div>}
    {stage === 'preview' && <div className="ai-polish-overlay ai-polish-preview">
      <p className="ai-polish-preview-label">Here's a polished version</p>
      <div className="ai-polish-preview-body">{renderPreview(result)}</div>
      <div className="ai-polish-preview-actions">
        <button type="button" className="outline-button" onClick={reset}>Discard</button>
        <button type="button" className="save-detail" onClick={() => { onApply(result); reset(); }}>Use this</button>
      </div>
    </div>}
    {stage === 'error' && <div className="ai-polish-overlay ai-polish-error" role="alert">
      <p>{error}</p>
      <div className="ai-polish-preview-actions"><button type="button" className="outline-button" onClick={reset}>Dismiss</button></div>
    </div>}
  </>;
}
