import type { ReactNode } from 'react';
import { UiIcon, type UiIconName } from './UiIcon';

/** The one consistent header every tab opens with: icon, title, and a short tagline,
 * all on one line. Lives inside each tab's already-animated view wrapper, so it
 * crossfades along with the rest of the view when switching tabs — no separate
 * animation needed here. */
export function TabHeader({ icon, title, tagline, action }: { icon: UiIconName; title: ReactNode; tagline: ReactNode; action?: ReactNode }) {
  return (
    <div className="tab-header">
      <span className="tab-header-icon"><UiIcon name={icon} /></span>
      <h1 className="tab-header-title">{title}</h1>
      <span className="tab-header-sep" aria-hidden="true" />
      <p className="tab-header-tagline">{tagline}</p>
      {action ? <span className="tab-header-action">{action}</span> : null}
    </div>
  );
}
