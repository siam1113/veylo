import type { FastifyPluginAsync } from 'fastify';
import { voiceAgentDefaultName, voiceAgentSessionRequestSchema, voiceAgentToneInstructions, voiceToolDefinitions } from '@veylo/domain';
import { requireOwner } from '../auth.js';
import { env } from '../env.js';

const bad = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const OPENAI_REQUEST_TIMEOUT_MS = 20_000;

function openAiFetch(url: string, init: RequestInit = {}) {
  const timeout = AbortSignal.timeout(OPENAI_REQUEST_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(url, { ...init, signal });
}

const buildInstructions = (name: string, tone: keyof typeof voiceAgentToneInstructions) => `You are ${name}, the voice assistant inside Veylo — a calm, private space for capturing and shaping intentions.

${voiceAgentToneInstructions[tone]} Never read back long lists aloud; summarize counts instead ("you have four things in Explore") and let the user ask for detail.

Focus: help the user capture, organize, schedule, and connect their intentions, and move them to the right part of the app when that's more useful than describing it. Stay inside Veylo's domain — you are not a general-purpose assistant.

When a capture is vague, ask one short clarifying question instead of guessing. Narrate briefly before acting ("Adding that now...") so the user isn't surprised.

Safety: delete_all_intentions, disconnect_integration, and add_calendar_event each require explicit confirmation. Call the tool once with confirm:false to describe exactly what will happen, wait for the user to clearly say yes, then call it again with confirm:true. Never set confirm:true yourself without the user having just said yes out loud. request_account_deletion never deletes anything — it only opens the account settings page, because deleting an account signs the user out and cannot be undone; tell the user they'll need to confirm it manually there.`;

// A preview session skips tools and the full persona — the client supplies the exact sample
// line to speak as one-off `response.create` instructions the moment the data channel opens.
const PREVIEW_INSTRUCTIONS = 'Wait for the next instruction, then say only the exact line you are given, once, in a natural and friendly tone, and nothing else.';

export const voiceRoutes: FastifyPluginAsync = async (app) => {
  app.post('/voice/session', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (request, reply) => {
    requireOwner(request);
    if (!env.OPENAI_API_KEY) throw bad('Voice mode is not configured on this server.', 503);

    const parsed = voiceAgentSessionRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) throw bad(parsed.error.issues[0]?.message ?? 'Invalid voice session request.');
    const { name = voiceAgentDefaultName, tone = 'warm', voice, preview = false } = parsed.data;

    const response = await openAiFetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: {
          type: 'realtime',
          model: env.OPENAI_REALTIME_MODEL,
          instructions: preview ? PREVIEW_INSTRUCTIONS : buildInstructions(name, tone),
          audio: {
            ...(voice ? { output: { voice } } : {}),
            // Transcribes the user's speech too, so the client can render it as chat bubbles.
            ...(preview ? {} : { input: { transcription: { model: 'whisper-1' } } }),
          },
          ...(preview ? {} : { tools: voiceToolDefinitions }),
        },
      }),
    });
    if (!response.ok) {
      request.log.error({ status: response.status, body: await response.text() }, 'OpenAI realtime session mint failed');
      throw bad('Could not start voice mode. Try again in a moment.', 502);
    }
    const data = await response.json() as { value: string; expires_at: number };
    reply.header('Cache-Control', 'no-store');
    return { clientSecret: data.value, expiresAt: data.expires_at, model: env.OPENAI_REALTIME_MODEL };
  });
};
