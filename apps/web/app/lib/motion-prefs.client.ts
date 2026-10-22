import { useEffect, useState } from 'react';

/** True when the OS-level reduced-motion preference is set, or the account's own
 * "reduce motion" preference has toggled the `.reduce-motion` class onto <html>
 * (see root.tsx/home.tsx). Framer Motion animations run on JS, not CSS, so they
 * don't pick up the app's `*{animation-duration:.01ms!important}` override — this
 * hook is how motion-based components opt into the same preference instead. */
export function useReducedMotionPref(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof document !== 'undefined' &&
    (document.documentElement.classList.contains('reduce-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches),
  );
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const html = document.documentElement;
    const update = () => setReduced(html.classList.contains('reduce-motion') || media.matches);
    update();
    media.addEventListener('change', update);
    const observer = new MutationObserver(update);
    observer.observe(html, { attributes: true, attributeFilter: ['class'] });
    return () => { media.removeEventListener('change', update); observer.disconnect(); };
  }, []);
  return reduced;
}
