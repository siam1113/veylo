import type { SyncIntention, SyncBlock } from './sync.client';

export type KindMinutes = { kind: string; minutes: number };

const localDate = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const dateShift = (date: Date, days: number) => { const result = new Date(date); result.setDate(result.getDate() + days); return result; };

/** Minutes of scheduled time per intention kind, for blocks whose date falls in
 * [today+fromDays, today+toDays). fromDays/toDays can be negative (looking back,
 * e.g. for the AI coach's "what actually happened" signal) or positive (looking
 * ahead, e.g. the Space tab's time-breakdown widget) — same aggregation either way. */
export function buildKindMinutes(scheduled: Array<{ item: SyncIntention; block: SyncBlock }>, today: Date, fromDays: number, toDays: number): KindMinutes[] {
  const start = localDate(dateShift(today, fromDays));
  const end = localDate(dateShift(today, toDays));
  const byKind = new Map<string, number>();
  for (const { item, block } of scheduled) {
    if (block.date < start || block.date >= end) continue;
    byKind.set(item.kind, (byKind.get(item.kind) ?? 0) + block.duration);
  }
  return Array.from(byKind, ([kind, minutes]) => ({ kind, minutes })).sort((a, b) => b.minutes - a.minutes);
}
