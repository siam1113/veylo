import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { useReducedMotionPref } from '../lib/motion-prefs.client';

/** Wrap each `{open && <Modal>...}` usage in <AnimatePresence> so this plays its
 * exit animation before unmounting, instead of vanishing instantly. */
export function Modal({ children, onClose, className = 'detail-dialog', label = 'Dialog' }: { children: ReactNode; onClose: () => void; className?: string; label?: string }) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  useEffect(() => { setContainer(document.body); }, []);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const selector = 'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(selector));
    (focusable()[0] ?? dialog).focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0]; const last = elements.at(-1);
      if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', trapFocus);
    return () => {
      document.removeEventListener('keydown', trapFocus);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [container]);
  const reduced = useReducedMotionPref();
  if (!container) return null;
  return createPortal(
    <motion.div
      className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.16, ease: 'easeOut' }}
    >
      <motion.section
        ref={dialogRef} className={`${className} modal-panel`} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
        initial={reduced ? false : { opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.98 }}
        transition={{ duration: reduced ? 0 : 0.2, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <button className="dialog-close" onClick={onClose} aria-label="Close">×</button>{children}
      </motion.section>
    </motion.div>, container);
}
