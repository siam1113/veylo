export type ThoughtIconName = 'polished' | 'original' | 'timeline' | 'added' | 'synced' | 'asked' | 'clarified' | 'version';
const paths: Record<ThoughtIconName, string> = {
  polished: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
  original: 'M7 3h8l4 4v14H5V3h2m8 0v5h4M8 12h8M8 16h6',
  timeline: 'M12 8v5l3 2M3 10a9 9 0 1 1 1 7M3 4v6h6',
  added: 'M12 5v14M5 12h14',
  synced: 'm7 12 3 3 7-7M21 12a9 9 0 1 1-6-8.5',
  asked: 'M8 9a4 4 0 0 1 8 0c0 3-4 3-4 6m0 3h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  clarified: 'M4 4h16v12H9l-5 4V4Zm4 4h8M8 12h5',
  version: 'M7 3h10v4H7V3Zm-3 4h16v14H4V7Zm4 5h8m-8 4h5',
};
export function ThoughtIcon({ name }: { name: ThoughtIconName }) {
  return <svg className="thought-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
