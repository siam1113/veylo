/** A short, human label for an IANA zone, e.g. "America/New_York" -> "New York". */
export function zoneCityName(zone: string): string {
  const last = zone.split('/').pop() ?? zone;
  return last.replace(/_/g, ' ');
}

/** The wall-clock time in another zone for the same instant shown on the local clock. */
export function zoneTimeLabel(instant: Date, zone: string): string {
  return instant.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: zone });
}

/** -1/0/1 when the other zone's calendar date differs from the local date for this instant. */
export function zoneDayOffset(instant: Date, zone: string): number {
  const local = instant.toLocaleDateString('en-CA');
  const remote = instant.toLocaleDateString('en-CA', { timeZone: zone });
  return local === remote ? 0 : remote > local ? 1 : -1;
}

/** Short weekday for this instant as seen in another zone, e.g. "Sun" - shown instead of a
 * bare +1/-1 so a day difference reads as an actual day, not a number that could be
 * mistaken for an hour offset. */
export function zoneWeekday(instant: Date, zone: string): string {
  return instant.toLocaleDateString(undefined, { weekday: 'short', timeZone: zone });
}

/** A deterministic accent hue per zone, so the same pinned city reads as the same color
 * everywhere it appears (day view gutter, week view events) without storing anything. */
export function zoneHue(zone: string): number {
  let hash = 0;
  for (let index = 0; index < zone.length; index++) hash = (hash * 31 + zone.charCodeAt(index)) >>> 0;
  return hash % 360;
}

/** Position intervals on a local, midnight-to-midnight clock face. */
export function dayInterval(date: Date, start: Date, end: Date) {
  const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const nextMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= midnight || start >= nextMidnight || end <= start) return null;
  const from = start <= midnight ? 0 : start.getHours() * 60 + start.getMinutes();
  const to = end >= nextMidnight ? 1440 : end.getHours() * 60 + end.getMinutes();
  // During a daylight-saving clock rollback, keep the interval visible.
  return { start: from, end: Math.max(from + 1, to) };
}

/** Assign simultaneous intervals separate lanes within each overlap group. */
export function arrangeIntervals<T extends { start: number; end: number }>(intervals: T[]) {
  const sorted = [...intervals].sort((a, b) => a.start - b.start || b.end - a.end);
  const result: Array<T & { lane: number; lanes: number }> = [];
  let group: typeof result = [];
  let laneEnds: number[] = [];
  let groupEnd = -1;
  const flush = () => { for (const entry of group) entry.lanes = laneEnds.length; result.push(...group); };
  for (const interval of sorted) {
    if (interval.start >= groupEnd) { flush(); group = []; laneEnds = []; }
    let lane = laneEnds.findIndex((end) => end <= interval.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = interval.end;
    group.push({ ...interval, lane, lanes: 1 });
    groupEnd = Math.max(groupEnd, interval.end);
  }
  flush();
  return result;
}
