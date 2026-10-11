export type SpaceUpcomingEntry = { id: string; intentionId: string; title: string; kind: string; label: string; time: string; duration: number };
export type SpaceSuggestionEntry = { id: string; title: string; rationale: string };

/** The Space tab's right-hand rail: the next few planned sessions and any quiet
 * suggestions — both system-surfaced, so they sit together, opposite the user's own
 * recent intentions. */
export function SpaceSchedule({ upcoming, suggestions, kindNames, onOpenIntention, onOpenTime, onOpenSuggestions }: {
  upcoming: SpaceUpcomingEntry[];
  suggestions: SpaceSuggestionEntry[];
  kindNames: Record<string, string>;
  onOpenIntention: (id: string) => void;
  onOpenTime: () => void;
  onOpenSuggestions: () => void;
}) {
  return (
    <aside className="space-schedule" aria-label="Upcoming time and suggestions">
      <div className="space-panel">
        <div className="space-panel-head"><h3>Upcoming</h3><button type="button" className="text-button" onClick={onOpenTime}>Time <span>↗</span></button></div>
        {upcoming.length ? (
          <div className="space-upcoming-list">
            {upcoming.map((entry) => (
              <button type="button" className="schedule-item space-upcoming-item" key={entry.id} onClick={() => onOpenIntention(entry.intentionId)}>
                <span className="schedule-time">{entry.label}<br />{entry.time}</span>
                <span className="schedule-marker" />
                <span className="schedule-copy"><b>{entry.title}</b><small>{entry.duration} minutes · {kindNames[entry.kind] ?? 'Thought'}</small></span>
              </button>
            ))}
          </div>
        ) : <p className="space-panel-empty">Nothing on the calendar yet.</p>}
      </div>
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
    </aside>
  );
}
