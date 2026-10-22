import { z } from 'zod';

/**
 * Tool definitions for the Vey voice assistant (OpenAI Realtime API function-calling).
 * This is the single source of truth shared by the API (sends `voiceToolDefinitions` to
 * OpenAI when minting a session) and the web client (validates tool-call arguments against
 * `voiceToolArgsSchemas` before dispatching). The zod schema is authoritative; the JSON
 * Schema in each definition's `parameters` is written by hand to match it, since this repo
 * has no zod-to-json-schema dependency — keep the two in sync when either changes.
 */

export const voiceToolNames = [
  'list_intentions', 'get_intention', 'list_relationships', 'get_preferences', 'list_connections', 'check_calendar_availability',
  'create_intention', 'update_intention', 'archive_intention', 'restore_intention', 'trash_intention', 'restore_from_trash',
  'schedule_time_block', 'remove_time_block', 'create_relationship', 'delete_relationship',
  'update_preferences', 'set_suggestion_feedback', 'navigate_view', 'add_calendar_event',
  'delete_all_intentions', 'disconnect_integration', 'request_account_deletion',
] as const;
export type VoiceToolName = (typeof voiceToolNames)[number];

export const voiceToolViews = ['space', 'explore', 'align', 'time', 'suggestions', 'connections', 'account'] as const;
export const voiceToolRelations = ['supports', 'related', 'depends_on'] as const;
export const voiceToolIntentionStatuses = ['captured', 'exploring', 'ready', 'planned', 'active', 'completed'] as const;
export const voiceToolHorizons = ['today', 'week', 'month', 'someday', 'custom'] as const;
export const voiceToolSuggestionStates = ['open', 'accepted', 'dismissed', 'snoozed'] as const;
export const voiceToolIntentionListFilters = ['active', 'archived', 'trashed', 'all'] as const;

/**
 * Agent personalization: the voices OpenAI's Realtime API (gpt-realtime) supports, the tone
 * presets offered in Settings > Personalization, and the request body shared by the web
 * client and the `/voice/session` route when minting a Realtime session (for the live
 * assistant, or for a no-mic voice preview — see `preview`).
 */
export const voiceAgentVoices = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'] as const;
export type VoiceAgentVoice = (typeof voiceAgentVoices)[number];

export const voiceAgentTones = ['warm', 'direct', 'playful'] as const;
export type VoiceAgentTone = (typeof voiceAgentTones)[number];
export const voiceAgentToneLabels: Record<VoiceAgentTone, string> = { warm: 'Warm & unhurried', direct: 'Direct & efficient', playful: 'Playful & casual' };
export const voiceAgentToneInstructions: Record<VoiceAgentTone, string> = {
  warm: 'Tone: warm, concise, unhurried. This is a spoken conversation, so keep replies short — a sentence or two, not a monologue.',
  direct: 'Tone: direct and efficient. Skip pleasantries and small talk, get straight to the point, and keep replies as short as the request allows.',
  playful: 'Tone: playful and casual, with some warmth and personality — but still brief. Read the room: ease off the playfulness if the user sounds stressed or serious.',
};

export const voiceAgentDefaultName = 'Vey';
export const voiceAgentSessionRequestSchema = z.object({
  name: z.string().trim().min(1).max(30).optional(),
  tone: z.enum(voiceAgentTones).optional(),
  voice: z.enum(voiceAgentVoices).optional(),
  preview: z.boolean().optional(),
});
export type VoiceAgentSessionRequest = z.infer<typeof voiceAgentSessionRequestSchema>;

const uuid = z.string().uuid();

export const voiceToolArgsSchemas = {
  list_intentions: z.object({ filter: z.enum(voiceToolIntentionListFilters).default('active') }).strict(),
  get_intention: z.object({ id: uuid }).strict(),
  list_relationships: z.object({}).strict(),
  get_preferences: z.object({}).strict(),
  list_connections: z.object({}).strict(),
  check_calendar_availability: z.object({ startDate: z.string().min(1), endDate: z.string().min(1) }).strict(),

  create_intention: z.object({ rawCapture: z.string().trim().min(1).max(8000) }).strict(),
  update_intention: z.object({
    id: uuid,
    title: z.string().trim().min(1).max(160).optional(),
    kind: z.enum(['idea', 'action', 'commitment', 'question', 'goal', 'meeting', 'note', 'unclassified']).optional(),
    intent: z.string().max(4000).optional(),
    purpose: z.string().max(4000).optional(),
    desiredOutcome: z.string().max(4000).optional(),
    roughPlan: z.string().max(8000).optional(),
    horizon: z.enum(voiceToolHorizons).optional(),
    effortEstimate: z.number().int().min(0).max(10080).optional(),
    status: z.enum(voiceToolIntentionStatuses).optional(),
  }).strict(),
  archive_intention: z.object({ id: uuid }).strict(),
  restore_intention: z.object({ id: uuid }).strict(),
  trash_intention: z.object({ id: uuid }).strict(),
  restore_from_trash: z.object({ id: uuid }).strict(),

  schedule_time_block: z.object({
    intentionId: uuid,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
    time: z.string().regex(/^\d{2}:\d{2}$/, 'time must be HH:MM'),
    durationMinutes: z.number().int().min(1).max(600).default(30),
  }).strict(),
  remove_time_block: z.object({ intentionId: uuid, blockId: z.string().min(1) }).strict(),

  create_relationship: z.object({ fromId: uuid, toId: uuid, relation: z.enum(voiceToolRelations) }).strict(),
  delete_relationship: z.object({ relationshipId: uuid }).strict(),

  update_preferences: z.object({
    reduceMotion: z.boolean().optional(),
    suggestionsEnabled: z.boolean().optional(),
    nudgeLimit: z.number().int().min(0).max(20).optional(),
    aiInterpretationEnabled: z.boolean().optional(),
    quietStart: z.string().nullable().optional(),
    quietEnd: z.string().nullable().optional(),
    timezone: z.string().nullable().optional(),
  }).strict(),
  set_suggestion_feedback: z.object({
    clientId: z.string().min(1),
    state: z.enum(voiceToolSuggestionStates),
    snoozedUntil: z.string().nullable().optional(),
  }).strict(),
  navigate_view: z.object({
    view: z.enum(voiceToolViews),
    accountTab: z.string().optional(),
    intentionId: uuid.optional(),
  }).strict(),
  add_calendar_event: z.object({ intentionId: uuid, blockId: z.string().min(1), confirm: z.boolean() }).strict(),

  delete_all_intentions: z.object({ confirm: z.boolean() }).strict(),
  disconnect_integration: z.object({ provider: z.string().min(1), confirm: z.boolean() }).strict(),
  request_account_deletion: z.object({ confirm: z.boolean() }).strict(),
} satisfies Record<VoiceToolName, z.ZodTypeAny>;

export type VoiceToolArgs<Name extends VoiceToolName> = z.infer<typeof voiceToolArgsSchemas[Name]>;

/** Tools whose action must not run unless the caller passed `confirm: true` — enforced
 * mechanically by the web executor, not only by the model following instructions. */
export const voiceToolRequiresConfirm: Record<VoiceToolName, boolean> = {
  list_intentions: false, get_intention: false, list_relationships: false, get_preferences: false,
  list_connections: false, check_calendar_availability: false,
  create_intention: false, update_intention: false, archive_intention: false, restore_intention: false,
  trash_intention: false, restore_from_trash: false,
  schedule_time_block: false, remove_time_block: false, create_relationship: false, delete_relationship: false,
  update_preferences: false, set_suggestion_feedback: false, navigate_view: false,
  add_calendar_event: true, delete_all_intentions: true, disconnect_integration: true, request_account_deletion: true,
};

type JsonSchema = Record<string, unknown>;
export type VoiceToolDefinition = { type: 'function'; name: VoiceToolName; description: string; parameters: JsonSchema };

export const voiceToolDefinitions: VoiceToolDefinition[] = [
  {
    type: 'function', name: 'list_intentions',
    description: "List the user's intentions (captured thoughts). Use this to find an intention's id before calling another tool, or to answer questions about what's in their space.",
    parameters: { type: 'object', properties: { filter: { type: 'string', enum: voiceToolIntentionListFilters, description: "Defaults to 'active' (excludes archived and trashed)." } }, required: [] },
  },
  {
    type: 'function', name: 'get_intention',
    description: 'Get full detail for one intention by id, including its time blocks.',
    parameters: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] },
  },
  {
    type: 'function', name: 'list_relationships',
    description: 'List the links the user has drawn between their intentions.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function', name: 'get_preferences',
    description: "Read the user's account preferences (motion, suggestions, AI interpretation, quiet hours, timezone).",
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function', name: 'list_connections',
    description: 'List which external providers (Google Calendar, Jira, Notion, etc.) are connected.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function', name: 'check_calendar_availability',
    description: "Check the user's Google Calendar free/busy windows for a date range, if connected.",
    parameters: { type: 'object', properties: { startDate: { type: 'string', description: 'ISO date' }, endDate: { type: 'string', description: 'ISO date' } }, required: ['startDate', 'endDate'] },
  },
  {
    type: 'function', name: 'create_intention',
    description: 'Capture a new intention (thought/idea/task) exactly as the user described it. Keep the raw capture close to their own words.',
    parameters: { type: 'object', properties: { rawCapture: { type: 'string' } }, required: ['rawCapture'] },
  },
  {
    type: 'function', name: 'update_intention',
    description: "Edit an existing intention's fields (title, kind, intent, purpose, desired outcome, rough plan, horizon, effort estimate, or status). Only include fields that are changing.",
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        title: { type: 'string' }, kind: { type: 'string', enum: ['idea', 'action', 'commitment', 'question', 'goal', 'meeting', 'note', 'unclassified'] },
        intent: { type: 'string' }, purpose: { type: 'string' }, desiredOutcome: { type: 'string' }, roughPlan: { type: 'string' },
        horizon: { type: 'string', enum: voiceToolHorizons }, effortEstimate: { type: 'integer', minimum: 0, maximum: 10080 },
        status: { type: 'string', enum: voiceToolIntentionStatuses, description: "Use 'completed' to mark done, 'ready' to reopen. Use archive_intention to archive instead." },
      },
      required: ['id'],
    },
  },
  {
    type: 'function', name: 'archive_intention',
    description: 'Archive one intention. Reversible with restore_intention. Does not require confirmation.',
    parameters: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] },
  },
  {
    type: 'function', name: 'restore_intention',
    description: 'Restore a previously archived intention.',
    parameters: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] },
  },
  {
    type: 'function', name: 'trash_intention',
    description: 'Move one intention to Trash. This removes it from the calendar and retracts any connected-calendar event immediately. Reversible with restore_from_trash within the trash retention window, after which it is permanently deleted. Does not require confirmation.',
    parameters: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] },
  },
  {
    type: 'function', name: 'restore_from_trash',
    description: 'Restore a previously trashed intention out of Trash. Does not restore any calendar event that was retracted when it was trashed.',
    parameters: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] },
  },
  {
    type: 'function', name: 'schedule_time_block',
    description: 'Plan a session of time for an intention.',
    parameters: {
      type: 'object',
      properties: { intentionId: { type: 'string', format: 'uuid' }, date: { type: 'string', description: 'YYYY-MM-DD' }, time: { type: 'string', description: 'HH:MM, 24-hour' }, durationMinutes: { type: 'integer', minimum: 1, maximum: 600 } },
      required: ['intentionId', 'date', 'time'],
    },
  },
  {
    type: 'function', name: 'remove_time_block',
    description: 'Remove a planned time block from an intention.',
    parameters: { type: 'object', properties: { intentionId: { type: 'string', format: 'uuid' }, blockId: { type: 'string' } }, required: ['intentionId', 'blockId'] },
  },
  {
    type: 'function', name: 'create_relationship',
    description: 'Link two intentions together.',
    parameters: { type: 'object', properties: { fromId: { type: 'string', format: 'uuid' }, toId: { type: 'string', format: 'uuid' }, relation: { type: 'string', enum: voiceToolRelations } }, required: ['fromId', 'toId', 'relation'] },
  },
  {
    type: 'function', name: 'delete_relationship',
    description: 'Remove a link between two intentions.',
    parameters: { type: 'object', properties: { relationshipId: { type: 'string', format: 'uuid' } }, required: ['relationshipId'] },
  },
  {
    type: 'function', name: 'update_preferences',
    description: 'Update account preferences. Only include fields that are changing.',
    parameters: {
      type: 'object',
      properties: {
        reduceMotion: { type: 'boolean' }, suggestionsEnabled: { type: 'boolean' }, nudgeLimit: { type: 'integer', minimum: 0, maximum: 20 },
        aiInterpretationEnabled: { type: 'boolean' }, quietStart: { type: ['string', 'null'] }, quietEnd: { type: ['string', 'null'] }, timezone: { type: ['string', 'null'] },
      },
      required: [],
    },
  },
  {
    type: 'function', name: 'set_suggestion_feedback',
    description: 'Record the user’s response to a suggestion (accept, dismiss, or snooze).',
    parameters: { type: 'object', properties: { clientId: { type: 'string' }, state: { type: 'string', enum: voiceToolSuggestionStates }, snoozedUntil: { type: ['string', 'null'] } }, required: ['clientId', 'state'] },
  },
  {
    type: 'function', name: 'navigate_view',
    description: "Switch which part of the app the user is looking at (their 'tabs'): space (capture), explore (browse thoughts), align (purpose/goals), time (calendar/schedule), suggestions, connections (integrations), or account (settings). Use this whenever it would help to actually show the user something rather than just describing it.",
    parameters: { type: 'object', properties: { view: { type: 'string', enum: voiceToolViews }, accountTab: { type: 'string' }, intentionId: { type: 'string', format: 'uuid', description: 'Open this specific intention’s detail view, if applicable.' } }, required: ['view'] },
  },
  {
    type: 'function', name: 'add_calendar_event',
    description: 'Add a planned time block to the user’s connected Google Calendar. Call once with confirm:false to describe what will happen; only call with confirm:true after the user clearly says yes.',
    parameters: { type: 'object', properties: { intentionId: { type: 'string', format: 'uuid' }, blockId: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['intentionId', 'blockId', 'confirm'] },
  },
  {
    type: 'function', name: 'delete_all_intentions',
    description: 'Permanently delete every intention and planned time in the account. Irreversible. Call once with confirm:false to warn the user and ask; only call with confirm:true after they clearly say yes.',
    parameters: { type: 'object', properties: { confirm: { type: 'boolean' } }, required: ['confirm'] },
  },
  {
    type: 'function', name: 'disconnect_integration',
    description: 'Disconnect an external provider (e.g. google, jira, notion). Call once with confirm:false to warn the user and ask; only call with confirm:true after they clearly say yes.',
    parameters: { type: 'object', properties: { provider: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['provider', 'confirm'] },
  },
  {
    type: 'function', name: 'request_account_deletion',
    description: 'The user wants to delete their account. This tool never deletes anything itself — it navigates to the account settings page where the user must manually confirm deletion, because that action signs them out and cannot be undone. Explain this to the user.',
    parameters: { type: 'object', properties: { confirm: { type: 'boolean' } }, required: ['confirm'] },
  },
];
