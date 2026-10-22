import { UiIcon, type UiIconName } from './UiIcon';

export type SpaceAlignedGoal = { id: string; title: string; icon: UiIconName; taskCount: number };

/** A daily check, not a history: the unique reasons ("whys") that today's scheduled
 * tasks are tied to — a quick glance at why today's plan is what it is, not a progress
 * tracker (that lives in Align). */
export function SpaceAlignedGoals({ goals, onOpenGoal }: { goals: SpaceAlignedGoal[]; onOpenGoal: () => void }) {
  return (
    <div className="space-panel space-aligned-goals">
      <div className="space-panel-head"><h3>Why(s) of the Day</h3></div>
      {goals.length ? (
        <div className="space-aligned-goals-list">
          {goals.map((goal) => (
            <button type="button" className="space-aligned-task" key={goal.id} onClick={onOpenGoal}>
              <span className="schedule-time"><UiIcon name={goal.icon} /></span>
              <span className="schedule-copy"><b>{goal.title}</b><small>{goal.taskCount} today</small></span>
            </button>
          ))}
        </div>
      ) : (
        <p className="space-panel-empty">No reasons linked to today's plan yet.</p>
      )}
    </div>
  );
}
