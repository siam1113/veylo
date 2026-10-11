import { useEffect, useState, type ReactNode } from 'react';

export type SpaceHighlight = { label: string; text: ReactNode };

/** Model-written text arrives as a plain string, not hand-built with highlight spans —
 * pick out standalone numbers at render time so the visual "pop" from earlier still
 * applies without the server needing to know about markup. */
function highlightNumbers(text: ReactNode): ReactNode {
  if (typeof text !== 'string') return text;
  const parts = text.split(/(\d+(?:\.\d+)?)/);
  return parts.map((part, i) => (/^\d+(?:\.\d+)?$/.test(part) ? <span className="stat-num" key={i}>{part}</span> : part));
}

/** Today's plan/done/progress, presented one at a time with a soft crossfade-slide
 * instead of three static lines. Auto-advances, pauses on hover/focus, and the
 * rotation stops entirely when the account's reduced-motion preference is on —
 * the slides still work via the dots, they just don't move on their own. */
export function SpaceHighlights({ highlights, reduceMotion }: { highlights: SpaceHighlight[]; reduceMotion: boolean }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = highlights.length;

  useEffect(() => {
    if (reduceMotion || paused || count <= 1) return;
    const timer = setInterval(() => setIndex((current) => (current + 1) % count), 5000);
    return () => clearInterval(timer);
  }, [reduceMotion, paused, count]);

  useEffect(() => { if (index >= count) setIndex(0); }, [count, index]);

  if (!count) return null;

  return (
    <div className="space-highlights" role="region" aria-label="Today's highlights" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <div className="space-highlights-viewport">
        <div className="space-highlights-track" style={{ transform: `translateX(-${index * 100}%)` }}>
          {highlights.map((highlight, i) => (
            <div className="space-highlight-slide" key={i} aria-hidden={i !== index} role="status" aria-live={i === index ? 'polite' : undefined}>
              <span className="space-highlight-label">{highlight.label}</span>
              <span className="space-highlight-value">{highlightNumbers(highlight.text)}</span>
            </div>
          ))}
        </div>
      </div>
      {count > 1 && (
        <div className="space-highlights-dots" role="tablist" aria-label="Highlights">
          {highlights.map((highlight, i) => (
            <button type="button" key={i} role="tab" aria-selected={i === index} aria-label={highlight.label} className={`space-highlights-dot ${i === index ? 'active' : ''}`} onClick={() => setIndex(i)} />
          ))}
        </div>
      )}
    </div>
  );
}
