import { API, authClient } from './backend.client';

export type PolishFieldKind = 'title' | 'intent' | 'purpose' | 'desiredOutcome' | 'roughPlan' | 'alignmentNote';

export type PolishPreset = { label: string; instruction: string };

const basePresets: PolishPreset[] = [
  { label: 'Fix grammar & clarity', instruction: 'Fix grammar, spelling, and awkward phrasing. Keep the meaning and length about the same.' },
  { label: 'Make it more concise', instruction: 'Shorten this and cut repetition while keeping all the key points.' },
  { label: 'Add more detail', instruction: 'Expand this with a bit more useful detail and context, without rambling.' },
  { label: 'Tighten the structure', instruction: 'Reorganize this into clear, short bullet points or steps where that helps.' },
  { label: 'Make the tone warmer', instruction: 'Make the tone warmer and more conversational, less formal.' },
];

/** Titles are one line — structure/bullets don't apply. */
const titlePresets: PolishPreset[] = [
  { label: 'Fix grammar & clarity', instruction: 'Fix grammar, spelling, and awkward phrasing. Keep the meaning and length about the same.' },
  { label: 'Make it more concise', instruction: 'Shorten this to the essential words while keeping the meaning.' },
  { label: 'Make it clearer', instruction: 'Make this easier to understand at a glance.' },
];

export function presetsFor(fieldKind: PolishFieldKind): PolishPreset[] {
  return fieldKind === 'title' ? titlePresets : basePresets;
}

export class PolishRequestError extends Error {}

/** Sends the current field text and a chosen/custom instruction to the server's AI-polish
 * endpoint and returns the rewritten text. Throws PolishRequestError with a user-facing
 * message on failure. */
export async function requestPolish(input: { fieldKind: PolishFieldKind; contextTitle?: string; text: string; instruction: string }): Promise<string> {
  if (!authClient) throw new PolishRequestError('Sign in to use AI polish.');
  const { data } = await authClient.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new PolishRequestError('Sign in to use AI polish.');
  let response: Response;
  try {
    response = await fetch(`${API.replace(/\/$/, '')}/v1/text/polish`, {
      method: 'POST',
      signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    throw new PolishRequestError('Could not reach the server. Check your connection and try again.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new PolishRequestError(body?.message || 'Could not polish this text right now.');
  }
  const body = await response.json() as { text?: unknown };
  if (typeof body.text !== 'string' || !body.text.trim()) throw new PolishRequestError('Could not polish this text right now.');
  return body.text;
}
