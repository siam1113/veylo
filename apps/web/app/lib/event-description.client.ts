import { API, authClient } from './backend.client';

export class EventDescriptionError extends Error {}

/** Mirrors requestPolish's auth/fetch pattern in ai-polish.client.ts. Returns an
 * AI-generated (or, on any failure/opt-out, server-side plain-concat) description
 * for the given time block's calendar event. Throws EventDescriptionError only when
 * the request itself couldn't be made (signed out, unreachable, non-OK response) -
 * generation failures are handled server-side and never surface here. */
export async function requestEventDescription(input: { timeBlockId: string }): Promise<string> {
  if (!authClient) throw new EventDescriptionError('Sign in to continue.');
  const { data } = await authClient.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new EventDescriptionError('Sign in to continue.');
  let response: Response;
  try {
    response = await fetch(`${API.replace(/\/$/, '')}/v1/calendar-events/description`, {
      method: 'POST',
      signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    throw new EventDescriptionError('Could not reach the server. Check your connection and try again.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new EventDescriptionError(body?.message || 'Could not prepare this event right now.');
  }
  const body = await response.json() as { description?: unknown };
  if (typeof body.description !== 'string') throw new EventDescriptionError('Could not prepare this event right now.');
  return body.description;
}
