import { intentionHorizons, intentionKinds } from '@veylo/domain';

export type LayaGrounding = {
  model: string;
  candidateKind: (typeof intentionKinds)[number];
  kindConfidence: number;
  kindProbabilities: Record<string, number>;
  candidateHorizon: (typeof intentionHorizons)[number] | null;
  horizonConfidence: number;
  horizonProbabilities: Record<string, number>;
  explicitTimeframeProbability: number;
  multipleThoughtsProbability: number;
  evaluatedAt: string;
};

type ChoiceAnswer = { choice?: unknown; answer_confidence?: unknown; probabilities?: unknown };
type LayaResponse = { answers?: Record<string, { noul?: unknown } & ChoiceAnswer>; model?: unknown; routing?: { model?: unknown } };

const horizonChoices = ['today', 'week', 'month', 'someday', 'custom', 'none'] as const;

export async function groundCaptureWithLaya(rawCapture: string): Promise<LayaGrounding> {
  const apiKey = process.env.LAYA_API_KEY;
  // laya-serve is unauthenticated by default for local use. Set LAYA_API_KEY
  // only when the configured endpoint has bearer authentication enabled.
  const baseUrl = (process.env.LAYA_API_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetch(`${baseUrl}/v1/systemone`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      model: process.env.LAYA_MODEL || 'typed-decisions',
      state: rawCapture,
      questions: {
        kind: {
          type: 'choice',
          instructions: 'Which single category best fits the main thought? Classify the meaning, not the wording.',
          criteria: {
            idea: 'a possibility, concept, or open-ended aspiration',
            action: 'a concrete task the person wants to do',
            commitment: 'a promise or responsibility the person has taken on',
            question: 'something the person wants answered or understood',
            goal: 'a result the person wants to achieve',
            meeting: 'a conversation or meeting to have',
            note: 'information the person wants to remember, with no task or question',
            unclassified: 'unclear, mixed, or none of the above',
          },
        },
        horizon: {
          type: 'choice',
          instructions: 'Which time horizon is explicitly supported by the thought? Choose none unless a timeframe is stated clearly.',
          criteria: {
            today: 'today or before the current day ends',
            week: 'this week or within the next seven days',
            month: 'this month or within the next month',
            someday: 'an explicitly vague future such as someday or one day',
            custom: 'a stated date or timeframe that does not fit the other options',
            none: 'no timeframe is clearly stated',
          },
        },
        explicit_timeframe: {
          type: 'noul',
          instructions: 'Does the thought explicitly state a date, deadline, or time horizon?',
        },
        multiple_thoughts: {
          type: 'noul',
          instructions: 'Does the capture contain multiple distinct thoughts rather than one main thought?',
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`Laya groundwork failed with HTTP ${response.status}.`);

  const result = await response.json() as LayaResponse;
  const kind = result.answers?.kind;
  const horizon = result.answers?.horizon;
  const explicitTimeframe = result.answers?.explicit_timeframe?.noul;
  const multipleThoughts = result.answers?.multiple_thoughts?.noul;
  if (typeof kind?.choice !== 'string' || !intentionKinds.includes(kind.choice as (typeof intentionKinds)[number])
    || typeof horizon?.choice !== 'string' || !horizonChoices.includes(horizon.choice as (typeof horizonChoices)[number])
    || typeof kind.answer_confidence !== 'number' || typeof horizon.answer_confidence !== 'number'
    || typeof explicitTimeframe !== 'number' || typeof multipleThoughts !== 'number'
    || ![kind.answer_confidence, horizon.answer_confidence, explicitTimeframe, multipleThoughts].every((score) => Number.isFinite(score) && score >= 0 && score <= 1)) {
    throw new Error('Laya returned invalid groundwork signals.');
  }
  const choiceProbabilities = (value: unknown): Record<string, number> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])));
  };
  return {
    model: typeof result.routing?.model === 'string' ? result.routing.model : typeof result.model === 'string' ? result.model : 'Laya',
    candidateKind: kind.choice as (typeof intentionKinds)[number],
    kindConfidence: kind.answer_confidence,
    kindProbabilities: choiceProbabilities(kind.probabilities),
    candidateHorizon: horizon.choice === 'none' ? null : horizon.choice as (typeof intentionHorizons)[number],
    horizonConfidence: horizon.answer_confidence,
    horizonProbabilities: choiceProbabilities(horizon.probabilities),
    explicitTimeframeProbability: explicitTimeframe,
    multipleThoughtsProbability: multipleThoughts,
    evaluatedAt: new Date().toISOString(),
  };
}
