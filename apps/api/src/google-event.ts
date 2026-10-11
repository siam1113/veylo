import { createHash } from 'node:crypto';

export type GoogleEventInput = {
  timeBlockId: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  title: string;
  intent: string | null;
  purpose: string | null;
};

/** Google event IDs remain stable across retries for the same Veylo time block. */
export function googleEventId(timeBlockId: string): string {
  return `v${createHash('sha256').update(`veylo:${timeBlockId}`).digest('hex').slice(0, 31)}`;
}

/** Build the approved event from planned time and user-authored intention fields only. */
export function googleEventPayload(input: GoogleEventInput) {
  const description = [input.intent, input.purpose ? `Why it matters: ${input.purpose}` : ''].filter(Boolean).join('\n\n');
  return {
    id: googleEventId(input.timeBlockId),
    summary: input.title,
    description,
    start: { dateTime: input.startsAt.toISOString(), timeZone: input.timezone },
    end: { dateTime: input.endsAt.toISOString(), timeZone: input.timezone },
  };
}
