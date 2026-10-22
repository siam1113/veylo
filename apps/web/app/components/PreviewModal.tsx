import type { ReactNode } from 'react';
import { Modal } from './Modal';
import { RichTextView } from './RichTextView';
import { isRichTextEmpty } from '../lib/rich-text';

/** The eye-icon "quick look" modal for cards — a wide, read-only view of a thought's or
 * alignment entry's rich fields with their formatting intact, separate from the full editor.
 * `extra` is an escape hatch for non-rich-text content (e.g. Align's linked-thought
 * breakdown and list) that doesn't fit the generic label+html `sections` shape. */
export function PreviewModal({ title, lede, sections, extra, onClose }: {
  title: string; lede?: string; sections: Array<{ label: string; html: string | null | undefined }>; extra?: ReactNode; onClose: () => void;
}) {
  const visible = sections.filter((section) => !isRichTextEmpty(section.html));
  return <Modal label={`Preview: ${title}`} onClose={onClose} className="preview-dialog">
    <div className="settings-content preview-content">
      <div className="date-label">PREVIEW</div>
      <h2>{title}</h2>
      {lede ? <p className="settings-lede preview-raw">{lede}</p> : null}
      {visible.length
        ? visible.map((section) => <div className="preview-field" key={section.label}><h3>{section.label}</h3><RichTextView html={section.html} /></div>)
        : (extra ? null : <p className="settings-lede">Nothing added here yet.</p>)}
      {extra}
    </div>
  </Modal>;
}
