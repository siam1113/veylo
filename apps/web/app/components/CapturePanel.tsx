import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import { rawCaptureMaxLength } from '@veylo/domain';
import { BrainBackdrop, BrainIcon } from './BrainBackdrop';
export function CapturePanel({ panelRef, inputRef, capture, onCapture, mode, onMode, listening, voiceStatus, saving, onSave, onClose, onKeyDown, reduceMotion, theme, previousPieces, gist, versionLabel, focused = true }: {
  panelRef: RefObject<HTMLDivElement | null>; inputRef: RefObject<HTMLTextAreaElement | null>;
  capture: string; onCapture: (text: string) => void; mode: 'keyboard' | 'microphone'; onMode: (mode: 'keyboard' | 'microphone') => void;
  listening: boolean; voiceStatus: { kind: string; text: string } | null; saving: boolean;
  onSave: () => void; onClose: () => void; onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  reduceMotion: boolean; theme: 'light' | 'dark'; previousPieces?: ReactNode; gist?: ReactNode; versionLabel?: string;
  /** Inline dashboard capture bar (Space tab) vs. the focused full-screen "Dump now" overlay. */
  focused?: boolean;
}) {
  const continuing = Boolean(previousPieces);
  return <div ref={panelRef} className={`capture-panel ${focused ? 'capture-focused' : ''} ${continuing ? 'capture-continuation' : ''}`} role={focused ? 'dialog' : undefined} aria-modal={focused ? true : undefined} aria-label={continuing ? 'Add to this thought' : 'Dump your thoughts here'} onKeyDown={onKeyDown}>
    <div className="capture-focus-heading"><span className="capture-heading-title"><BrainIcon />{continuing ? 'Keep the thought going' : 'Dumping thoughts'}<span className="capture-mode-label">{mode === 'microphone' ? 'Speaking' : 'Writing'}</span></span><button type="button" disabled={saving} aria-label={continuing ? 'Back to original idea' : 'Close dumping thoughts'} onClick={onClose}>×</button></div>
    <div className="capture-body">
      {continuing ? <aside className="capture-previous" aria-label="Previous pieces"><h2>Previous pieces</h2><p>Your words, as you left them.</p>{previousPieces}</aside> : null}
      <div className="capture-main"><label htmlFor="capture-input" className="capture-label">{continuing ? `What came to mind? · ${versionLabel}` : 'Dump your thoughts here'}</label><div className={`capture-input-frame ${capture.trim() ? 'has-thought' : ''} ${listening ? 'is-listening' : ''}`}><BrainBackdrop listening={listening} reduceMotion={reduceMotion} theme={theme} />{['top-left', 'top-right', 'bottom-left', 'bottom-right'].map((corner) => <span key={corner} className={`capture-corner ${corner}`} aria-hidden="true" />)}<textarea ref={inputRef} id="capture-input" rows={8} value={capture} readOnly={mode === 'microphone'} onFocus={() => onMode('keyboard')} onChange={(event) => onCapture(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); onSave(); } }} placeholder={continuing ? 'A new detail, a different angle, something you noticed…' : '“I’d love to make Sunday dinner feel less rushed…”'} maxLength={rawCaptureMaxLength} /></div>
        <div className={`capture-voice-status ${voiceStatus?.kind ?? ''}`} role="status" aria-live="polite">{listening ? <span className="voice-pulse" aria-hidden="true" /> : null}{voiceStatus?.text}</div>
        <div className="capture-bottom"><div className="capture-input-modes" role="group" aria-label="Choose whether to write or speak your thought"><button className={`capture-mode ${mode === 'keyboard' ? 'active' : ''}`} type="button" aria-pressed={mode === 'keyboard'} onClick={() => onMode('keyboard')}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 15h8" /></svg><span>Write</span></button><button className={`capture-mode ${mode === 'microphone' ? 'active' : ''} ${listening ? 'listening' : ''}`} type="button" aria-pressed={mode === 'microphone'} onClick={() => onMode('microphone')}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3m-4 0h8" /></svg><span>{listening ? 'Listening' : 'Speak'}</span></button></div><button className="capture-button" type="button" onClick={onSave} disabled={!capture.trim() || listening || saving}><span>{saving ? 'Saving…' : continuing ? 'Keep this piece' : 'Keep this thought'}</span><span className="capture-arrow">↗</span></button></div>
      </div>
      {continuing ? <div className="capture-gist">{gist}</div> : null}
    </div>
  </div>;
}
