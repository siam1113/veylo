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
