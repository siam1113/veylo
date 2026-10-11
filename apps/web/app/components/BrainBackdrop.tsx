import { useEffect, useRef, useState } from 'react';
import type { BrainScene } from './brain-scene';

export function BrainIcon() {
  return <svg className="brain-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5.5C12 1.5 6 2 6 6a4 4 0 0 0-3 6.5A4.5 4.5 0 0 0 7 20c2 3 5 1 5-1V5.5Zm0 0C12 1.5 18 2 18 6a4 4 0 0 1 3 6.5 4.5 4.5 0 0 1-4 7.5c-2 3-5 1-5-1" /><path d="M6 6c0 2 1 3 3 3M3 12.5c2-1 4 0 4 2M7 20v-3m11-11c0 2-1 3-3 3m6 3.5c-2-1-4 0-4 2M17 20v-3" /></svg>;
}

export function BrainDumpIcon() {
  return <span className="brain-dump-icon" aria-hidden="true"><BrainIcon /><svg className="brain-dump-arrow" viewBox="0 0 14 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 1v11m-4-4 4 4 4-4M2 15v2h10v-2" /></svg></span>;
}

type Props = { listening: boolean; reduceMotion: boolean; theme: 'light' | 'dark' };

export function BrainBackdrop({ listening, reduceMotion, theme }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<BrainScene | null>(null);
  const [ready, setReady] = useState(false);
  const options = useRef({ listening, reduceMotion, theme });
  options.current = { listening, reduceMotion, theme };

  useEffect(() => {
    let disposed = false;
    const element = host.current;
    if (!element) return;
    // Load the 3D engine only when the capture screen is opened.
    void import('./brain-scene').then(({ createBrainScene }) => {
      if (disposed) return;
      scene.current = createBrainScene(element, options.current, () => { if (!disposed) setReady(true); });
    }).catch(() => { /* The static brain keeps capture usable without WebGL. */ });
    return () => { disposed = true; scene.current?.dispose(); scene.current = null; };
  }, []);

  useEffect(() => { scene.current?.update({ listening, reduceMotion, theme }); }, [listening, reduceMotion, theme]);

  return <div ref={host} className={`brain-backdrop ${ready ? 'is-ready' : ''}`} aria-hidden="true">
    <div className="brain-fallback"><BrainIcon /></div>
  </div>;
}
