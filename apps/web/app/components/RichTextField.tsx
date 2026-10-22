import { useEffect, type ReactNode } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { createRichEditorExtensions, getMarkdown } from '../lib/rich-editor-extensions';
import { markdownToHtml } from '../lib/markdown-bridge.client';
import { sanitizeRichHtml, isRichTextEmpty } from '../lib/rich-text';
import { AiPolish } from './AiPolish';
import type { PolishFieldKind } from '../lib/ai-polish.client';

/** A labeled rich-text field: a Bold/Italic/Strikethrough/Quote/Bullet/Numbered toolbar, the
 * Tiptap editor, and an AI-polish control anchored bottom-right. Value in/out is sanitized
 * HTML (what gets synced and stored); AI polish exchanges Markdown with the server via the
 * editor's Markdown storage, never touching the field until the user accepts a preview. */
export function RichTextField({ id, label, labelHidden, labelExtra, hint, value, onChange, placeholder, polishFieldKind, polishContextTitle, maxLength }: {
  id: string; label: string; labelHidden?: boolean; labelExtra?: ReactNode; hint?: string; value: string; onChange: (html: string) => void;
  placeholder?: string; polishFieldKind?: PolishFieldKind; polishContextTitle?: string; maxLength?: number;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const editor = useEditor({
    extensions: createRichEditorExtensions(placeholder),
    content: value || '',
    editorProps: { attributes: { id, ...(hintId ? { 'aria-describedby': hintId } : {}) } },
    onUpdate: ({ editor: instance }) => {
      const html = instance.getHTML();
      if (maxLength && instance.getText().length > maxLength) return;
      onChange(html);
    },
  }, []);

  // Keeps the editor in sync with external updates (e.g. a remote sync pull) without
  // clobbering the user's own in-progress edit.
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    if (sanitizeRichHtml(editor.getHTML()) !== sanitizeRichHtml(value || '')) editor.commands.setContent(value || '', { emitUpdate: false });
  }, [value, editor]);

  // useEditor returns null for one tick when it detects a non-browser render (e.g. this
  // component rendered via renderToStaticMarkup in tests) — Tiptap's own SSR guard.
  if (!editor) return null;

  return <div className="detail-field rich-field ai-polish-host">
    <label htmlFor={id} className={labelHidden ? 'sr-only' : undefined}>{label}{labelExtra}</label>
    {hint ? <p className="thought-field-hint" id={hintId}>{hint}</p> : null}
    <div className="rich-toolbar" role="toolbar" aria-label={`Formatting for ${label}`}>
      <button type="button" aria-pressed={editor.isActive('bold')} aria-label="Bold" onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></button>
      <button type="button" aria-pressed={editor.isActive('italic')} aria-label="Italic" onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().toggleItalic().run()}><i>i</i></button>
      <button type="button" aria-pressed={editor.isActive('strike')} aria-label="Strikethrough" onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></button>
      <span className="rich-toolbar-divider" aria-hidden="true" />
      <button type="button" aria-pressed={editor.isActive('bulletList')} aria-label="Bullet list" onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().toggleBulletList().run()}>•</button>
      <button type="button" aria-pressed={editor.isActive('orderedList')} aria-label="Numbered list" onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1.</button>
      <button type="button" aria-pressed={editor.isActive('blockquote')} aria-label="Quote" onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().toggleBlockquote().run()}>”</button>
    </div>
    <div className="rich-editor-shell">
      <EditorContent editor={editor} />
      {polishFieldKind ? <AiPolish
        fieldKind={polishFieldKind}
        contextTitle={polishContextTitle}
        disabled={isRichTextEmpty(value)}
        getText={() => getMarkdown(editor)}
        renderPreview={(markdown) => <div className="rich-content" dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(markdownToHtml(markdown)) }} />}
        onApply={(markdown) => { editor.commands.setContent(markdown); onChange(editor.getHTML()); }}
      /> : null}
    </div>
  </div>;
}
