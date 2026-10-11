function localClock(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return { date: `${value('year')}-${value('month')}-${value('day')}`, minutes: Number(value('hour')) * 60 + Number(value('minute')) };
}

/** Return the first instant at or after now when quiet hours have ended. */
export function quietUntil(now: Date, timezone: string | null, start: string | null, end: string | null): Date | null {
  if (!timezone || !start || !end) return null;
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  const startAt = startHour! * 60 + startMinute!; const endAt = endHour! * 60 + endMinute!;
  if (startAt === endAt) return null;
  const current = localClock(now, timezone);
  const isQuiet = startAt < endAt
    ? current.minutes >= startAt && current.minutes < endAt
    : current.minutes >= startAt || current.minutes < endAt;
  if (!isQuiet) return null;
  const nextDay = startAt > endAt && current.minutes >= startAt;
  const [year, month, day] = current.date.split('-').map(Number);
  const targetDate = new Date(Date.UTC(year!, month! - 1, day! + (nextDay ? 1 : 0))).toISOString().slice(0, 10);
  const firstMinute = Math.ceil(now.getTime() / 60_000) * 60_000;
  for (let minute = firstMinute; minute <= now.getTime() + 48 * 60 * 60_000; minute += 60_000) {
    const candidate = new Date(minute); const local = localClock(candidate, timezone);
    if (local.date === targetDate && local.minutes >= endAt) return candidate;
  }
  return null;
}
