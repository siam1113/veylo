import type { IntentionStatus } from '@clearhead/domain';
import { UiIcon, type UiIconName } from './UiIcon';

export const thoughtStatusMeta: Record<IntentionStatus, { label: string; tone: string; icon: UiIconName }> = {
  captured: { label: 'Captured', tone: 'captured', icon: 'inbox' },
  exploring: { label: 'Exploring', tone: 'exploring', icon: 'explore' },
  ready: { label: 'Ready', tone: 'ready', icon: 'check' },
  planned: { label: 'Planned', tone: 'planned', icon: 'calendar' },
  active: { label: 'In progress', tone: 'active', icon: 'play' },
  completed: { label: 'Completed', tone: 'completed', icon: 'check-circle' },
  archived: { label: 'Archived', tone: 'archived', icon: 'archive' },
  trashed: { label: 'Trashed', tone: 'trashed', icon: 'trash' },
};

export function ThoughtStatus({ status, compact = false, time }: { status: string; compact?: boolean; time?: string }) {
  const value = thoughtStatusMeta[status as IntentionStatus] ?? thoughtStatusMeta.captured;
  const label = time ? `${value.label} ${time}` : value.label;
  return <span className={`thought-status thought-status-${value.tone}${compact ? ' is-compact' : ''}`} title={compact ? label : undefined} aria-label={compact ? label : undefined}>
    <UiIcon name={value.icon} />{compact ? null : label}
  </span>;
}
