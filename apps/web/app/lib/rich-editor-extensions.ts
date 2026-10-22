import type { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown, type MarkdownStorage } from 'tiptap-markdown';

/** A deliberately small rich-text schema: paragraphs, bold, italic, strikethrough, blockquote,
 * and bullet/numbered lists — chosen because tiptap-markdown can round-trip all of them
 * through the plain-text Markdown exchange AI polish uses. Headings, code blocks, links,
 * underline (no Markdown syntax exists for it), and horizontal rules stay out of scope. */
export function createRichEditorExtensions(placeholder = '') {
  return [
    StarterKit.configure({
      heading: false, codeBlock: false, horizontalRule: false,
      code: false, link: false, underline: false,
    }),
    Markdown.configure({ html: true, breaks: false, linkify: false, tightLists: true }),
    Placeholder.configure({ placeholder }),
  ];
}

/** tiptap-markdown predates Tiptap v3's typed `editor.storage` module augmentation, so this
 * casts rather than claiming a module-level `Storage` type it doesn't declare. */
export function getMarkdown(editor: Editor): string {
  return (editor.storage as unknown as { markdown: MarkdownStorage }).markdown.getMarkdown();
}
