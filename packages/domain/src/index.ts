import { z } from 'zod';

export const intentionKinds = [
  'idea', 'action', 'commitment', 'question', 'goal', 'meeting', 'note', 'unclassified',
] as const;
export const intentionStatuses = [
  'captured', 'exploring', 'ready', 'planned', 'active', 'completed', 'archived',
] as const;
export const intentionHorizons = ['today', 'week', 'month', 'someday', 'custom'] as const;
export const rawCaptureMaxLength = 8000;

export const intentionSchema = z.object({
  id: z.string().uuid(),
  rawCapture: z.string().min(1).max(rawCaptureMaxLength).refine((value) => value.trim().length > 0, 'Capture cannot be blank.'),
  title: z.string().min(1).max(160),
  kind: z.enum(intentionKinds),
  intent: z.string().max(4000).nullable().default(null),
  purpose: z.string().max(4000).nullable().default(null),
  desiredOutcome: z.string().max(4000).nullable().default(null),
  roughPlan: z.string().max(8000).nullable().default(null),
  horizon: z.enum(intentionHorizons).nullable().default(null),
  effortEstimate: z.number().int().min(0).max(10080).nullable().default(null),
  energyContext: z.string().max(120).nullable().default(null),
  status: z.enum(intentionStatuses).default('captured'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  version: z.number().int().positive().default(1),
});

export const captureInputSchema = z.object({
  rawCapture: z.string().min(1).max(rawCaptureMaxLength).refine((value) => value.trim().length > 0, 'Capture cannot be blank.'),
  clientId: z.string().uuid(),
});

export function appendVoiceTranscript(existingCapture: string, transcript: string): { rawCapture: string; truncated: boolean } {
  const spoken = transcript.trim();
  const separator = existingCapture && spoken && !/\s$/u.test(existingCapture) ? ' ' : '';
  const combined = `${existingCapture}${separator}${spoken}`;
  return { rawCapture: combined.slice(0, rawCaptureMaxLength), truncated: combined.length > rawCaptureMaxLength };
}

export const thoughtFieldKeys = ['intent', 'purpose', 'desiredOutcome', 'roughPlan', 'horizon', 'effortEstimate', 'energyContext'] as const;
export const thoughtFieldSchema = z.object({
  key: z.enum(thoughtFieldKeys),
  label: z.string().trim().min(1).max(120),
  hint: z.string().max(300),
}).strict();
export const thoughtFieldsSchema = z.array(thoughtFieldSchema).max(7).refine(
  (fields) => new Set(fields.map((field) => field.key)).size === fields.length,
  'Each field must have a unique key.',
);
export type ThoughtField = z.infer<typeof thoughtFieldSchema>;
export const thoughtEvaluationSchema = z.object({
  kind: z.enum(intentionKinds), fields: thoughtFieldsSchema,
  evaluatedAt: z.string().datetime(), sourceVersion: z.number().int().positive(),
});
export type ThoughtEvaluation = z.infer<typeof thoughtEvaluationSchema>;

/** Small defaults remain usable offline; an evaluation replaces their prompts. */
export function defaultThoughtFields(kind: string): ThoughtField[] {
  const intent = kind === 'question' ? 'What are you trying to understand?' : kind === 'note' ? 'What would you like to remember?' : kind === 'idea' ? 'What is the idea?' : 'What do you want to do?';
  const fields: ThoughtField[] = [{ key: 'intent', label: intent, hint: '' }];
  if (['action', 'commitment', 'meeting', 'goal'].includes(kind)) fields.push({ key: 'roughPlan', label: 'What is the next step?', hint: '' }, { key: 'horizon', label: 'When might this fit?', hint: '' });
  else if (kind === 'idea') fields.push({ key: 'purpose', label: 'Why does it matter?', hint: '' });
  return fields;
}

export const intentionInterpretationSchema = z.object({
  title: z.string().trim().min(1).max(160),
  kind: z.enum(intentionKinds),
  horizon: z.enum(intentionHorizons).nullable(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(500),
  fields: thoughtFieldsSchema,
  gist: z.string().trim().min(1).max(2000),
}).strict();

export const intentionPatchSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  kind: z.enum(intentionKinds).optional(),
  intent: z.string().max(4000).nullable().optional(),
  purpose: z.string().max(4000).nullable().optional(),
  desiredOutcome: z.string().max(4000).nullable().optional(),
  roughPlan: z.string().max(8000).nullable().optional(),
  horizon: z.enum(intentionHorizons).nullable().optional(),
  effortEstimate: z.number().int().min(0).max(10080).nullable().optional(),
  energyContext: z.string().max(120).nullable().optional(),
  status: z.enum(intentionStatuses).optional(),
  expectedVersion: z.number().int().positive(),
});

export const timeZoneSchema = z.string().min(1).max(80).refine((value) => {
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; }
  catch { return false; }
}, 'Choose a valid timezone.');

export type CalendarAvailabilityRange = Readonly<{ start: string; end: string }>;

/** Cached free/busy data applies only to the exact date range requested from the provider. */
export function calendarAvailabilityMatchesRange(
  checked: CalendarAvailabilityRange | null,
  visible: CalendarAvailabilityRange,
): boolean {
  return checked !== null && checked.start === visible.start && checked.end === visible.end;
}

export type TimedWindow = Readonly<{ start: string; end: string }>;

/** Find the first quarter-hour slot inside local working hours without overlapping known commitments. */
export function findAvailableSlot(options: {
  days: Date[];
  durationMinutes: number;
  busyWindows: TimedWindow[];
  plannedBlocks: TimedWindow[];
  now?: Date;
  workdayStartHour?: number;
  workdayEndHour?: number;
}): { startsAt: Date; endsAt: Date } | null {
  const { days, durationMinutes, busyWindows, plannedBlocks } = options;
  const stepMinutes = 15;
  const startHour = options.workdayStartHour ?? 9;
  const endHour = options.workdayEndHour ?? 17;
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || startHour < 0 || endHour > 24 || startHour >= endHour) return null;
  const known = [...busyWindows, ...plannedBlocks].map((window) => ({ start: Date.parse(window.start), end: Date.parse(window.end) }));
  if (known.some((window) => !Number.isFinite(window.start) || !Number.isFinite(window.end) || window.end <= window.start)) return null;
  const now = options.now ?? new Date();
  for (const day of days) {
    if (!Number.isFinite(day.getTime())) continue;
    const workStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), startHour);
    const workEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), endHour);
    if (workEnd.getTime() <= now.getTime()) continue;
    let candidate = workStart.getTime();
    if (day.getFullYear() === now.getFullYear() && day.getMonth() === now.getMonth() && day.getDate() === now.getDate()) {
      const nowMinute = now.getHours() * 60 + now.getMinutes() + (now.getSeconds() > 0 || now.getMilliseconds() > 0 ? 1 : 0);
      const firstMinute = Math.ceil(nowMinute / stepMinutes) * stepMinutes;
      const elapsed = firstMinute - startHour * 60;
      candidate = Math.max(candidate, new Date(day.getFullYear(), day.getMonth(), day.getDate(), startHour, elapsed).getTime());
    }
    while (candidate + durationMinutes * 60_000 <= workEnd.getTime()) {
      const end = candidate + durationMinutes * 60_000;
      const conflict = known.some((window) => window.start < end && window.end > candidate);
      if (!conflict) return { startsAt: new Date(candidate), endsAt: new Date(end) };
      candidate += stepMinutes * 60_000;
    }
  }
  return null;
}

export const timeBlockInputSchema = z.object({
  clientId: z.string().uuid(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  timezone: timeZoneSchema,
  externalProvider: z.string().nullable().optional(),
}).refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), {
  message: 'endsAt must be after startsAt', path: ['endsAt'],
});

export type Intention = z.infer<typeof intentionSchema>;
export type IntentionKind = (typeof intentionKinds)[number];
export type IntentionStatus = (typeof intentionStatuses)[number];
export type CaptureInput = z.infer<typeof captureInputSchema>;
export type IntentionPatch = z.infer<typeof intentionPatchSchema>;

export type SuggestionFeedbackState = 'open' | 'accepted' | 'dismissed' | 'snoozed';
export type SuggestionRankedItem<T extends {
  id: string; status: string; purpose?: string | null; horizon?: string | null;
  effortEstimate?: number | null; updatedAt: string; blocks?: Array<{ date?: string; startsAt?: string }>;
  suggestionDismissed?: boolean; snoozedUntil?: string | null;
}> = { item: T; score: number; rationale: string };

/** Keep offline sync requests below the API body limit while allowing a single
 * maximum-size intention to travel intact. */
export function chunkJsonPayload<T>(
  items: readonly T[],
  wrap: (batch: T[]) => unknown,
  maxBytes = 48 * 1024,
  maxItems = 100,
): T[][] {
  const chunks: T[][] = [];
  let batch: T[] = [];
  const jsonByteLength = (value: unknown) => {
    const text = JSON.stringify(value) ?? 'null';
    let bytes = 0;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length
        && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    }
    return bytes;
  };
  for (const item of items) {
    const candidate = [...batch, item];
    const size = jsonByteLength(wrap(candidate));
    if (batch.length && (candidate.length > maxItems || size > maxBytes)) {
      chunks.push(batch);
      batch = [item];
    } else {
      batch = candidate;
    }
  }
  if (batch.length) chunks.push(batch);
  return chunks;
}

/** Rank local intentions using only user-authored context. The weights are a
 * first heuristic from the V1 plan, not a learned or validated model. */
export function rankIntentionSuggestions<T extends {
  id: string; status: string; purpose?: string | null; horizon?: string | null;
  effortEstimate?: number | null; updatedAt: string; blocks?: Array<{ date?: string; startsAt?: string }>;
  suggestionDismissed?: boolean; snoozedUntil?: string | null;
}>(
  items: T[],
  feedback: Array<{ clientId: string; state: SuggestionFeedbackState; snoozedUntil: string | null }>,
  options: { now?: Date; limit?: number } = {},
): Array<SuggestionRankedItem<T>> {
  const now = options.now ?? new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const feedbackById = new Map(feedback.map((item) => [item.clientId, item]));
  const horizonScores: Record<string, number> = { today: 1, week: 0.82, month: 0.62, custom: 0.58, someday: 0.24 };
  const ranked = items.flatMap((item) => {
    if (item.status === 'completed' || item.status === 'archived') return [];
    if (item.blocks?.some((block) => block.startsAt
      ? Date.parse(block.startsAt) >= now.getTime()
      : Boolean(block.date && block.date >= today))) return [];
    const previous = feedbackById.get(item.id);
    if (!previous && item.suggestionDismissed) return [];
    if (!previous && item.snoozedUntil && Date.parse(item.snoozedUntil) > now.getTime()) return [];
    if (previous?.state === 'accepted' || previous?.state === 'dismissed') return [];
    if (previous?.state === 'snoozed' && previous.snoozedUntil && Date.parse(previous.snoozedUntil) > now.getTime()) return [];

    const horizon = item.horizon ?? '';
    const purposeAlignment = item.purpose?.trim() ? 1 : 0.35;
    const timeFit = horizonScores[horizon] ?? 0.5;
    const urgency = horizon === 'today' ? 1 : horizon === 'week' ? 0.8 : horizon === 'month' ? 0.55 : horizon === 'someday' ? 0.15 : 0.35;
    const updatedAt = Date.parse(item.updatedAt);
    const updatedDaysAgo = Number.isFinite(updatedAt) ? Math.max(0, (now.getTime() - updatedAt) / 86_400_000) : 365;
    const interest = Math.max(0, 1 - updatedDaysAgo / 30);
    const effort = item.effortEstimate;
    const effortFit = effort == null ? 0.55 : effort <= 30 ? 1 : effort <= 60 ? 0.85 : effort <= 120 ? 0.65 : 0.4;
    const statusFit = item.status === 'ready' || item.status === 'active' ? 1 : item.status === 'planned' ? 0.75 : item.status === 'exploring' ? 0.7 : 0.6;
    const feasibility = (effortFit + statusFit) / 2;
    const score = 0.3 * purposeAlignment + 0.25 * timeFit + 0.2 * urgency + 0.15 * interest + 0.1 * feasibility;
    const rationale = purposeAlignment >= timeFit && purposeAlignment >= interest && item.purpose?.trim()
      ? `Connected to ${item.purpose.trim()}.`
      : timeFit >= urgency && horizon
        ? `You marked this for ${horizon === 'today' ? 'today' : horizon === 'week' ? 'this week' : horizon === 'month' ? 'this month' : horizon === 'custom' ? 'a time you chose' : horizon}.`
        : effort != null && effort <= 60
          ? `A small next step could fit in about ${effort} minutes.`
          : updatedDaysAgo <= 7
            ? 'You have been shaping this recently.'
            : 'This intention is ready whenever you are.';
    return [{ item, score, rationale }];
  });
  ranked.sort((left, right) => right.score - left.score || Date.parse(right.item.updatedAt) - Date.parse(left.item.updatedAt));
  const limit = options.limit ?? ranked.length;
  return ranked.filter((entry) => entry.score >= 0.6).slice(0, Math.max(0, limit));
}

export * from './originals.js';

export const alignmentKinds = ['reason', 'goal', 'direction', 'value'] as const;
export const alignmentContentSchema = z.object({
  kind: z.enum(alignmentKinds),
  title: z.string().trim().min(1).max(160),
  note: z.string().trim().max(4000).default(''),
  intentionIds: z.array(z.string().uuid()).max(500).refine((ids) => new Set(ids).size === ids.length, 'Each thought can be linked once.').default([]),
  archived: z.boolean().default(false),
});
export const alignmentWriteSchema = alignmentContentSchema.extend({
  id: z.string().uuid(), mutationId: z.string().uuid(), expectedVersion: z.number().int().positive().nullable(),
});
export const alignmentRecordSchema = alignmentContentSchema.extend({
  id: z.string().uuid(), version: z.number().int().positive(), updatedAt: z.string().datetime(),
});
export type AlignmentKind = (typeof alignmentKinds)[number];
export type AlignmentContent = z.infer<typeof alignmentContentSchema>;
export type AlignmentRecord = z.infer<typeof alignmentRecordSchema>;
export type AlignmentWrite = z.infer<typeof alignmentWriteSchema>;
