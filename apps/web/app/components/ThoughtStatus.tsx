import type { IntentionStatus } from '@veylo/domain';
import { UiIcon, type UiIconName } from './UiIcon';

const statuses: Record<IntentionStatus, { label: string; tone: string; icon: UiIconName }> = {
  captured: { label: 'Captured', tone: 'captured', icon: 'inbox' },
  exploring: { label: 'Exploring', tone: 'exploring', icon: 'explore' },
  ready: { label: 'Ready', tone: 'ready', icon: 'check' },
  planned: { label: 'Planned', tone: 'planned', icon: 'calendar' },
  active: { label: 'In progress', tone: 'active', icon: 'play' },
  completed: { label: 'Completed', tone: 'completed', icon: 'check' },
  archived: { label: 'Archived', tone: 'archived', icon: 'archive' },
};

export function ThoughtStatus({ status, compact = false }: { status: string; compact?: boolean }) {
  const value = statuses[status as IntentionStatus] ?? statuses.captured;
  return <span className={`thought-status thought-status-${value.tone}${compact ? ' is-compact' : ''}`} title={compact ? value.label : undefined} aria-label={compact ? value.label : undefined}>
    <UiIcon name={value.icon} />{compact ? null : value.label}
  </span>;
}
