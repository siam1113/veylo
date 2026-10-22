import { createHash } from 'node:crypto';

export type GoogleEventInput = {
  timeBlockId: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  title: string;
  intent: string | null;
  purpose: string | null;
  description?: string;
};

/** Google event IDs remain stable across retries for the same ClearHead time block. */
export function googleEventId(timeBlockId: string): string {
  return `v${createHash('sha256').update(`veylo:${timeBlockId}`).digest('hex').slice(0, 31)}`;
}

/** The description used when there's no AI-generated or user-edited override. */
export function plainEventDescription(intent: string | null, purpose: string | null): string {
  return [intent, purpose ? `Why it matters: ${purpose}` : ''].filter(Boolean).join('\n\n');
}

/** Build the approved event from planned time and user-authored intention fields only. */
export function googleEventPayload(input: GoogleEventInput) {
  const description = input.description ?? plainEventDescription(input.intent, input.purpose);
  return {
    id: googleEventId(input.timeBlockId),
    summary: input.title,
    description,
    start: { dateTime: input.startsAt.toISOString(), timeZone: input.timezone },
    end: { dateTime: input.endsAt.toISOString(), timeZone: input.timezone },
  };
}
