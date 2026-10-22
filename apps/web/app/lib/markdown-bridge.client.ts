import { Editor } from '@tiptap/core';
import { createRichEditorExtensions } from './rich-editor-extensions';

/** Converts the lightweight Markdown subset AI polish returns into the same HTML shape the
 * live rich-text fields store, using a throwaway (unmounted) editor instance — reusing the
 * Tiptap/Markdown parser rather than hand-rolling one, just for this one-off conversion. */
export function markdownToHtml(markdown: string): string {
  const scratch = new Editor({ extensions: createRichEditorExtensions(), content: markdown });
  const html = scratch.getHTML();
  scratch.destroy();
  return html;
}
