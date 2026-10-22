import type { ReactNode } from 'react';

/** Motion UI's "rolling text" button pattern (motion.dev/ui/components/rolling-text-button),
 * reimplemented with CSS instead of their paywalled source: a duplicate of the label sits
 * directly below the original inside a 1-line mask, and the pair rolls up by exactly one line
 * on the ancestor button's hover/focus — same visual (an odometer-style flip) without a second
 * render pass. Wrap just the text of a primary CTA with this; icons/arrows stay outside it. */
export function RollingLabel({ children }: { children: ReactNode }) {
  return (
    <span className="rolling-label">
      <span className="rolling-label-stack">
        <span className="rolling-label-face">{children}</span>
        <span className="rolling-label-face" aria-hidden="true">{children}</span>
      </span>
    </span>
  );
}
