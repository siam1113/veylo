import type { SyncIntention, SyncBlock } from '../lib/sync.client';
import type { UiIconName } from './UiIcon';
import { BreakdownBar } from './BreakdownBar';
import { buildKindMinutes } from '../lib/time-breakdown';
import { durationLabel } from './time-insights';

/** The Space tab's time-breakdown panel: today's scheduled minutes by intention kind.
 * Shares the right column with "Why(s) of the Day" — the caller wraps both in the
 * column's <aside>. */
export function SpaceTimeBreakdown({ scheduled, today, kinds, kindNames, kindIcons }: {
  scheduled: Array<{ item: SyncIntention; block: SyncBlock }>;
  today: Date;
  kinds: string[];
  kindNames: Record<string, string>;
  kindIcons: Record<string, UiIconName>;
}) {
  const minutesByKind = buildKindMinutes(scheduled, today, 0, 1);
  const minutesLookup = new Map(minutesByKind.map(({ kind, minutes }) => [kind, minutes]));
  const presentKinds = kinds.filter((kind) => minutesLookup.get(kind));
  if (!presentKinds.length) return null;

  return (
    <div className="space-panel">
      <div className="space-panel-head"><h3>Time breakdown</h3></div>
      <BreakdownBar ariaLabel={`Scheduled time by kind: ${presentKinds.map((kind) => `${durationLabel(minutesLookup.get(kind) ?? 0)} ${kindNames[kind] ?? kind}`).join(', ')}`}
        items={presentKinds.map((kind) => ({ key: kind, label: kindNames[kind] ?? kind, icon: kindIcons[kind], value: minutesLookup.get(kind) ?? 0, valueLabel: durationLabel(minutesLookup.get(kind) ?? 0), colorClass: `kind-${kind}` }))} />
    </div>
  );
}
