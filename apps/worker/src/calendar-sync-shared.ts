// Pure logic shared between Google and Outlook's autonomous background sync - neither
// provider's response shape leaks past each provider's own parser, which maps into this
// generic shape before handing off here. Keeping this one copy is what keeps
// title-divergence protection (the trickiest invariant in the sync system) from drifting
// between two providers. Deliberately has zero imports (no db/schema) so parser tests for
// either provider stay runnable without a database - see calendar-sync-mutations.ts for the
// DB-touching half of this split.
export type ParsedCalendarEvent = {
  id: string;
  cancelled: boolean;
  title: string | null;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string | null;
  htmlLink: string | null;
};

export type ExistingBlock = { timeBlockId: string; intentionId: string; intentionTitle?: string; externalTitle?: string | null };

export type UpsertAction =
  | { kind: 'skip' }
  | { kind: 'create'; event: ParsedCalendarEvent }
  | { kind: 'update'; timeBlockId: string; intentionId: string; event: ParsedCalendarEvent; titleDiverged: boolean }
  | { kind: 'archive'; timeBlockId: string; intentionId: string };

export function decideUpsertAction(event: ParsedCalendarEvent, existing: ExistingBlock | null): UpsertAction {
  if (event.cancelled) return existing ? { kind: 'archive', timeBlockId: existing.timeBlockId, intentionId: existing.intentionId } : { kind: 'skip' };
  if (!event.startsAt || !event.endsAt) return { kind: 'skip' };
  if (!existing) return { kind: 'create', event };
  // externalTitle is the title we last applied FROM the provider (null means never applied
  // yet, e.g. a ClearHead-originated push read back for the first time). If the live ClearHead title
  // no longer matches that last-applied value, the user edited it locally since - ClearHead wins,
  // and the title stays frozen (not refreshed from the provider) from here on.
  const titleDiverged = existing.externalTitle != null && existing.intentionTitle !== existing.externalTitle;
  return { kind: 'update', timeBlockId: existing.timeBlockId, intentionId: existing.intentionId, event, titleDiverged };
}

const TITLE_MAX_LENGTH = 160;
// A first-time sync anchored to the exact instant it happens to run would permanently
// miss any event already in the past by then. Incremental/delta sync never re-scans a
// time window afterward, only deltas since the token/link, so a short lookback on the
// very first sync catches recent events without importing years of calendar history.
export const INITIAL_SYNC_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
export function initialSyncTimeMin(): string {
  return new Date(Date.now() - INITIAL_SYNC_LOOKBACK_MS).toISOString();
}

export function clampTitle(title: string): string {
  return title.length > TITLE_MAX_LENGTH ? title.slice(0, TITLE_MAX_LENGTH) : title;
}

export function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === '23505');
}
