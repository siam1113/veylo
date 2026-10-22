import { UiIcon, type UiIconName } from './UiIcon';

export type SpaceUpcomingEntry = { id: string; intentionId: string; title: string; kind: string; label: string; time: string; duration: number };
export type SpaceSuggestionEntry = { id: string; title: string; rationale: string };

/** The next few planned sessions — sits in the today-card column, right below
 * "Dump now", so what's coming up is visible alongside the capture prompt. */
export function SpaceUpcomingPanel({ upcoming, kindNames, kindIcons, onOpenIntention, onOpenTime }: {
  upcoming: SpaceUpcomingEntry[];
  kindNames: Record<string, string>;
  kindIcons: Record<string, UiIconName>;
  onOpenIntention: (id: string) => void;
  onOpenTime: () => void;
}) {
  return (
    <div className="space-panel">
      <div className="space-panel-head"><h3>Upcoming</h3><button type="button" className="text-button" onClick={onOpenTime}>Time <span>↗</span></button></div>
      {upcoming.length ? (
        <div className="space-upcoming-list">
          {upcoming.map((entry) => (
            <button type="button" className="space-upcoming-card" key={entry.id} onClick={() => onOpenIntention(entry.intentionId)}>
              <span className="space-upcoming-icon"><UiIcon name={kindIcons[entry.kind] ?? 'kind-unclassified'} /></span>
              <span className="space-upcoming-body"><b>{entry.title}</b><small>{kindNames[entry.kind] ?? 'Thought'} · {entry.duration} min</small></span>
              <span className="space-upcoming-time"><span className="space-upcoming-time-label">{entry.label}</span><span className="space-upcoming-time-clock">{entry.time}</span></span>
            </button>
          ))}
        </div>
      ) : <p className="space-panel-empty">Nothing on the calendar yet.</p>}
    </div>
  );
}

/** Quiet suggestions — sits in the right column, below "Why(s) of the Day". */
export function SpaceSuggestedPanel({ suggestions, onOpenIntention, onOpenSuggestions }: {
  suggestions: SpaceSuggestionEntry[];
  onOpenIntention: (id: string) => void;
  onOpenSuggestions: () => void;
}) {
  return (
    <div className="space-panel">
      <div className="space-panel-head"><h3>Suggested</h3><button type="button" className="text-button" onClick={onOpenSuggestions}>See all <span>↗</span></button></div>
      {suggestions.length ? (
        <div className="space-suggested-list">
          {suggestions.map((entry) => (
            <button type="button" className="space-suggested-item" key={entry.id} onClick={() => onOpenIntention(entry.id)}>
              <span className="suggested-dot" aria-hidden="true">✧</span>
              <span><b>{entry.title}</b><small>{entry.rationale}</small></span>
            </button>
          ))}
        </div>
      ) : <p className="space-panel-empty">No nudges right now.</p>}
    </div>
  );
}
