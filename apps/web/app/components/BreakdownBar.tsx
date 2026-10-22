import { UiIcon, type UiIconName } from './UiIcon';

export type BreakdownItem = { key: string; label: string; icon?: UiIconName; value: number; valueLabel: string; colorClass: string };

/** A proportional segment bar + legend chips, one per category — shared by the Align
 * tab's Type/Status breakdowns and the Space tab's scheduled-time breakdown. Segment
 * width is `value` (flex-grow), the legend shows `valueLabel` so callers can display
 * either a raw count or a formatted duration. Colors come entirely from `colorClass`
 * (e.g. `kind-action`), which sets --segment-color per theme in styles.css. */
export function BreakdownBar({ items, ariaLabel }: { items: BreakdownItem[]; ariaLabel: string }) {
  if (!items.length) return null;
  return (
    <>
      <div className="breakdown-bar" role="img" aria-label={ariaLabel}>
        {items.map((entry) => <span key={entry.key} className={`breakdown-segment ${entry.colorClass}`} style={{ flexGrow: entry.value }} />)}
      </div>
      <div className="breakdown-legend">
        {items.map((entry) => (
          <span key={entry.key} className={`breakdown-chip ${entry.colorClass}`}>
            <i aria-hidden="true" />
            {entry.icon ? <UiIcon name={entry.icon} /> : null}
            <span>{entry.label}</span>
            <b>{entry.valueLabel}</b>
          </span>
        ))}
      </div>
    </>
  );
}
