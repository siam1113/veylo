import type { CSSProperties } from 'react';
import { sanitizeRichHtml, truncateRichHtml } from '../lib/rich-text';

/** Read-only renderer for stored rich-text HTML (or AI-polish preview HTML) — used in card
 * previews and the eye-icon preview modal so formatting stays visible wherever the text shows
 * up, not just inside the editor. `clamp` reuses the app's existing line-clamp convention;
 * `maxChars` instead cuts at an exact character count (see truncateRichHtml), independent
 * of card width or font size. */
export function RichTextView({ html, clamp, maxChars, className = '' }: { html: string | null | undefined; clamp?: number | true; maxChars?: number; className?: string }) {
  if (!html) return null;
  const safe = sanitizeRichHtml(html);
  if (!safe.replace(/<[^>]*>/g, '').trim()) return null;
  const shown = maxChars ? truncateRichHtml(safe, maxChars).html : safe;
  const style = clamp ? { '--rich-clamp': clamp === true ? 3 : clamp } as CSSProperties : undefined;
  return <div className={`rich-content${clamp ? ' clamp' : ''}${className ? ` ${className}` : ''}`} style={style} dangerouslySetInnerHTML={{ __html: shown }} />;
}
