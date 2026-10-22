import DOMPurify from 'isomorphic-dompurify';
import MarkdownIt from 'markdown-it';

const ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 's', 'blockquote', 'ul', 'ol', 'li'];

// Same config as the Markdown extension in rich-editor-extensions.ts. `html: true` makes
// markdown-it pass real HTML straight through unchanged, so running already-HTML field
// values through this is a safe no-op — it only matters for values that were written as
// plain text or Markdown outside the Tiptap editor (e.g. the voice assistant's
// update_intention tool), which would otherwise show their raw '**'/'- ' syntax verbatim.
const markdownToHtmlLite = new MarkdownIt({ html: true, linkify: false, breaks: false });

/** Sanitizes HTML produced by the Tiptap rich-text fields (or returned by AI polish) before
 * it's rendered read-only via dangerouslySetInnerHTML in card previews and preview modals. */
export function sanitizeRichHtml(html: string): string {
  // DOMPurify keeps data-* attributes by default even with an empty ALLOWED_ATTR — Tiptap's
  // bullet/numbered lists carry a stray `data-tight="true"`, so turn that off explicitly.
  return DOMPurify.sanitize(markdownToHtmlLite.render(html), { ALLOWED_TAGS, ALLOWED_ATTR: [], ALLOW_DATA_ATTR: false });
}

/** True when the stored HTML has no visible text (an empty editor still saves `<p></p>`). */
export function isRichTextEmpty(html: string | null | undefined): boolean {
  if (!html) return true;
  return sanitizeRichHtml(html).replace(/<[^>]*>/g, '').trim().length === 0;
}

const voidTags = new Set(['br']);

/** Truncates already-sanitized rich-text HTML (see sanitizeRichHtml) to roughly `maxChars`
 * of visible text, closing whatever tags are still open at the cut point so the result
 * stays valid markup, instead of a CSS line-clamp that cuts at an unpredictable, width- and
 * font-dependent point. Each HTML entity (e.g. `&amp;`) counts as a single character. */
export function truncateRichHtml(html: string, maxChars: number): { html: string; truncated: boolean } {
  const stack: string[] = [];
  let count = 0;
  let cut = -1;
  let i = 0;
  while (i < html.length) {
    const char = html[i];
    if (char === '<') {
      const close = html.indexOf('>', i);
      if (close === -1) break;
      const tag = html.slice(i, close + 1);
      const name = tag.match(/^<\/?([a-zA-Z0-9]+)/)?.[1]?.toLowerCase();
      if (name && !voidTags.has(name)) { if (tag.startsWith('</')) stack.pop(); else stack.push(name); }
      i = close + 1;
      continue;
    }
    if (char === '&') {
      const semicolon = html.indexOf(';', i);
      if (semicolon !== -1 && semicolon - i <= 10) {
        count += 1;
        if (count > maxChars) { cut = i; break; }
        i = semicolon + 1;
        continue;
      }
    }
    count += 1;
    if (count > maxChars) { cut = i; break; }
    i += 1;
  }
  if (cut === -1) return { html, truncated: false };
  let result = `${html.slice(0, cut).replace(/\s+$/, '')}…`;
  for (let j = stack.length - 1; j >= 0; j--) result += `</${stack[j]}>`;
  return { html: result, truncated: true };
}
