export type GoogleBusyWindow = { start: string; end: string };

export function googleFreeBusyRequest(startsAt: string, endsAt: string, timezone: string) {
  return {
    timeMin: startsAt,
    timeMax: endsAt,
    timeZone: timezone,
    items: [{ id: 'primary' }],
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Expose only valid busy boundaries; provider event metadata never crosses the API boundary. */
export function googleBusyWindows(value: unknown): GoogleBusyWindow[] {
  const calendars = record(record(value)?.calendars);
  const primary = record(calendars?.primary);
  const busy = primary?.busy;
  if (!Array.isArray(busy)) return [];

  return busy.flatMap((entry) => {
    const window = record(entry);
    const start = window?.start;
    const end = window?.end;
    if (typeof start !== 'string' || typeof end !== 'string') return [];
    const startsAt = Date.parse(start);
    const endsAt = Date.parse(end);
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) return [];
    return [{ start, end }];
  });
}
