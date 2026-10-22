import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeRichHtml, isRichTextEmpty } from '../../app/lib/rich-text';

test('sanitizeRichHtml keeps the allowed formatting tags', () => {
  const html = sanitizeRichHtml('<p>Call the <strong>dentist</strong> <em>soon</em></p><ul><li>confirm insurance</li></ul>');
  assert.equal(html, '<p>Call the <strong>dentist</strong> <em>soon</em></p><ul><li>confirm insurance</li></ul>');
});

test('sanitizeRichHtml keeps strikethrough and blockquote', () => {
  const html = sanitizeRichHtml('<p><s>skip this</s></p><blockquote><p>quoted</p></blockquote>');
  assert.equal(html, '<p><s>skip this</s></p><blockquote><p>quoted</p></blockquote>');
});

test('sanitizeRichHtml strips the stray data-tight attribute Tiptap writes on lists', () => {
  // The actual markup Tiptap's bullet/numbered lists produce (verified against a real
  // editor instance) — DOMPurify keeps data-* attributes by default even with an empty
  // ALLOWED_ATTR, so this needs ALLOW_DATA_ATTR: false to come out clean.
  const html = sanitizeRichHtml('<ul class="tight" data-tight="true"><li><p>one</p></li><li><p>two</p></li></ul>');
  assert.equal(html, '<ul><li><p>one</p></li><li><p>two</p></li></ul>');
});

test('sanitizeRichHtml strips scripts, event handlers, and disallowed tags', () => {
  const html = sanitizeRichHtml('<p onclick="steal()">hi<script>bad()</script><img src=x onerror=bad()><a href="javascript:bad()">link</a></p>');
  assert.doesNotMatch(html, /script|onclick|onerror|<img|<a\b/i);
  assert.match(html, /^<p>hi.*<\/p>$/);
});

test('sanitizeRichHtml renders plain Markdown written outside the editor (e.g. by the voice assistant)', () => {
  // intent/purpose/etc. can be set directly via the voice assistant's update_intention tool,
  // which never passes through Tiptap — so the stored value may be bare Markdown rather than
  // the HTML the rich-text fields normally produce. The preview modal must still format it.
  const html = sanitizeRichHtml('**Call** the dentist\n\n- confirm insurance\n- pick a time');
  assert.doesNotMatch(html, /\*\*|^-\s/m);
  assert.match(html, /<strong>Call<\/strong>/);
  assert.match(html, /<li>confirm insurance<\/li>/);
  assert.match(html, /<li>pick a time<\/li>/);
});

test('isRichTextEmpty treats an empty editor paragraph as empty', () => {
  assert.equal(isRichTextEmpty(''), true);
  assert.equal(isRichTextEmpty(null), true);
  assert.equal(isRichTextEmpty('<p></p>'), true);
  assert.equal(isRichTextEmpty('<p>hi</p>'), false);
});
