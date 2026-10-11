import { API, authClient } from './backend.client';

export type SpaceInsightContext = {
  hour: number;
  plan: Array<{ title: string; time: string }>;
  done: string[];
  openCount: number;
};

export type SpaceHighlightCard = { label: string; text: string };

const CACHE_KEY = 'veylo-space-insight-v2';
const BUCKET_HOURS = 2;

type Cached = { bucket: string; cards: SpaceHighlightCard[] };

function bucketFor(date: Date): string {
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `${day}-${Math.floor(date.getHours() / BUCKET_HOURS)}`;
}

function readCache(bucket: string): SpaceHighlightCard[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as Partial<Cached>;
    return cached.bucket === bucket && Array.isArray(cached.cards) ? cached.cards : null;
  } catch { return null; }
}

function writeCache(bucket: string, cards: SpaceHighlightCard[]): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ bucket, cards } satisfies Cached)); } catch { /* Best effort only. */ }
}

/** Two to four highlight cards, written by the model, catching the user up on their day —
 * refreshed at most once per two-hour window via a local cache, so Space doesn't fire a
 * request on every visit. Requires the account's AI-assisted features preference; the
 * server re-checks that too, this just avoids a pointless request when it's off. Returns
 * null on any failure so the caller can fall back to a plain deterministic card. */
export async function fetchSpaceHighlights(context: SpaceInsightContext, now = new Date()): Promise<SpaceHighlightCard[] | null> {
  const bucket = bucketFor(now);
  const cached = readCache(bucket);
  if (cached) return cached;
  if (!authClient) return null;
  try {
    const { data } = await authClient.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    const response = await fetch(`${API.replace(/\/$/, '')}/v1/space/insight`, {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hour: context.hour, plan: context.plan, done: context.done, openCount: context.openCount }),
    });
    if (!response.ok) return null;
    const body = await response.json() as { cards?: unknown };
    if (!Array.isArray(body.cards) || !body.cards.length) return null;
    const cards = body.cards.filter((card): card is SpaceHighlightCard =>
      Boolean(card) && typeof card === 'object' && typeof (card as SpaceHighlightCard).label === 'string' && typeof (card as SpaceHighlightCard).text === 'string');
    if (!cards.length) return null;
    writeCache(bucket, cards);
    return cards;
  } catch { return null; }
}
