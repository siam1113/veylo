import { API, authClient } from './backend.client';

export type SpaceCoachContext = {
  openCount: number; doneThisWeek: number; doneLastWeek: number; unalignedOpenCount: number; freeDaysAhead: number;
  minutesByKind: Array<{ kind: string; minutes: number }>;
};

export type SpaceCoachCard = { text: string; action: 'align' | 'time' | 'explore' | 'none' };

const CACHE_KEY = 'clearhead-space-coach-v1';
const BUCKET_HOURS = 4;

type Cached = { bucket: string; cards: SpaceCoachCard[] };

function bucketFor(date: Date): string {
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `${day}-${Math.floor(date.getHours() / BUCKET_HOURS)}`;
}

function readCache(bucket: string): SpaceCoachCard[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as Partial<Cached>;
    return cached.bucket === bucket && Array.isArray(cached.cards) ? cached.cards : null;
  } catch { return null; }
}

function writeCache(bucket: string, cards: SpaceCoachCard[]): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ bucket, cards } satisfies Cached)); } catch { /* Best effort only. */ }
}

const validActions = new Set(['align', 'time', 'explore', 'none']);

/** Up to three coach-style insights about recent activity patterns, cached a few
 * hours via a local bucket so Space doesn't fire a request on every visit. Requires
 * the account's AI-assisted features preference; the server re-checks that too, this
 * just avoids a pointless request when it's off. Returns null on any failure so the
 * caller can fall back to the deterministic cues alone. */
export async function fetchSpaceCoach(context: SpaceCoachContext, now = new Date()): Promise<SpaceCoachCard[] | null> {
  const bucket = bucketFor(now);
  const cached = readCache(bucket);
  if (cached) return cached;
  if (!authClient) return null;
  try {
    const { data } = await authClient.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    const response = await fetch(`${API.replace(/\/$/, '')}/v1/space/coach`, {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(context),
    });
    if (!response.ok) return null;
    const body = await response.json() as { cards?: unknown };
    if (!Array.isArray(body.cards) || !body.cards.length) return null;
    const cards = body.cards.filter((card): card is SpaceCoachCard =>
      Boolean(card) && typeof card === 'object' && typeof (card as SpaceCoachCard).text === 'string' && validActions.has((card as SpaceCoachCard).action));
    if (!cards.length) return null;
    writeCache(bucket, cards);
    return cards;
  } catch { return null; }
}
