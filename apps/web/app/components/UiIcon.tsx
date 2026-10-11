import type { ReactNode, SVGProps } from 'react';

const paths: Record<string, ReactNode> = {
  explore: <><circle cx="12" cy="12" r="8.25" /><path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8 4.8-2.2Z" /></>,
  align: <><path d="M4 6h16M4 12h10M4 18h13" /><circle cx="18" cy="12" r="2" /></>,
  time: <><circle cx="12" cy="12" r="8.25" /><path d="M12 7v5l3.5 2" /></>,
  suggestions: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" /></>,
  connections: <><path d="M9.5 14.5 14.5 9.5" /><path d="M7.3 16.7 5.9 18a3.5 3.5 0 0 1-4.9-5l4-4a3.5 3.5 0 0 1 5 0M16.7 7.3 18 6a3.5 3.5 0 0 1 5 5l-4 4a3.5 3.5 0 0 1-5 0" /></>,
  reason: <><path d="M20.8 8.8c0 5.1-8.8 10.1-8.8 10.1S3.2 13.9 3.2 8.8A4.3 4.3 0 0 1 12 6.7a4.3 4.3 0 0 1 8.8 2.1Z" /></>,
  goal: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r=".8" fill="currentColor" /><path d="m13 11 6-6m-3 0h3v3" /></>,
  direction: <><circle cx="12" cy="12" r="9" /><path d="m15.8 8.2-2.2 5.4-5.4 2.2 2.2-5.4 5.4-2.2Z" /></>,
  value: <><path d="M12 3 21 12l-9 9-9-9 9-9Z" /><path d="m8.5 12 2.2 2.2 4.8-4.8" /></>,
  inbox: <><path d="M4 4h16l2 10v6H2v-6L4 4Z" /><path d="M2 14h6l2 3h4l2-3h6" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /><path d="m9 15 2 2 4-4" /></>,
  play: <><circle cx="12" cy="12" r="9" /><path d="m10 8 6 4-6 4V8Z" fill="currentColor" stroke="none" /></>,
  edit: <><path d="m14 5 5 5M4 20l4.2-.8L19 8.4 15.6 5 4.8 15.8 4 20Z" /><path d="M13.5 6.5 17.5 10.5" /></>,
  archive: <><path d="M4 7h16v13H4zM3 4h18v3H3zM9 11h6" /></>,
  restore: <><path d="M4 7h16v13H4zM3 4h18v3H3zM9 13a3 3 0 1 0 1-2.2M8 9v3h3" /></>,
  profile: <><circle cx="12" cy="8" r="3.25" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
  personalization: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>,
  preferences: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" fill="currentColor" /><circle cx="15" cy="12" r="2" fill="currentColor" /><circle cx="11" cy="18" r="2" fill="currentColor" /></>,
  check: <path d="m5 12 4.5 4.5L19 7" />,
  alert: <><path d="M12 3 2.8 19h18.4L12 3Z" /><path d="M12 9v4m0 3h.01" /></>,
  cloud: <><path d="M7 18h10a4 4 0 0 0 .4-8A6 6 0 0 0 6 9.2 4.5 4.5 0 0 0 7 18Z" /><path d="m9 13 2 2 4-4" /></>,
};

export type UiIconName = keyof typeof paths;

export function UiIcon({ name, ...props }: { name: UiIconName } & SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{paths[name]}</svg>;
}
