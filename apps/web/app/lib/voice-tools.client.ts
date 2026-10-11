import { voiceToolArgsSchemas, voiceToolNames, voiceToolRequiresConfirm, type VoiceToolName } from '@veylo/domain';

export type VoiceIntentionSummary = { id: string; title: string; kind: string; status: string; horizon?: string | null; updatedAt: string };
export type VoiceIntentionDetail = VoiceIntentionSummary & {
  rawCapture: string; intent?: string | null; purpose?: string | null; desiredOutcome?: string | null; roughPlan?: string | null; effortEstimate?: number | null;
  blocks: Array<{ id: string; date: string; time: string; duration: number; externalEventId?: string }>;
};
export type VoiceRelationshipSummary = { id: string; fromId: string; fromTitle: string; toId: string; toTitle: string; relation: string };
export type VoiceActionResult = { ok: boolean; error?: string; needsConfirmation?: boolean; message?: string } & Record<string, unknown>;

/** Every method here calls the exact same handler the manual UI uses (updateItem,
 * changeView, syncClient, ...) — the voice path never bypasses local-first sync. */
export type VoiceActions = {
  listIntentions(filter: 'active' | 'archived' | 'all'): VoiceIntentionSummary[];
  getIntention(id: string): VoiceIntentionDetail | null;
  listRelationships(): VoiceRelationshipSummary[];
  getPreferences(): Record<string, unknown>;
  listConnections(): Array<{ provider: string; connected: boolean }>;
  checkCalendarAvailability(startDate: string, endDate: string): Promise<VoiceActionResult>;

  createIntention(rawCapture: string): Promise<VoiceActionResult>;
  updateIntention(id: string, patch: Record<string, unknown>): VoiceActionResult;
  archiveIntention(id: string): VoiceActionResult;
  restoreIntention(id: string): VoiceActionResult;

  scheduleTimeBlock(intentionId: string, date: string, time: string, durationMinutes: number): VoiceActionResult;
  removeTimeBlock(intentionId: string, blockId: string): VoiceActionResult;

  createRelationship(fromId: string, toId: string, relation: string): Promise<VoiceActionResult>;
  deleteRelationship(relationshipId: string): Promise<VoiceActionResult>;

  updatePreferences(patch: Record<string, unknown>): VoiceActionResult;
  setSuggestionFeedback(clientId: string, state: string, snoozedUntil: string | null): Promise<VoiceActionResult>;

  navigateView(view: string, opts: { accountTab?: string; intentionId?: string }): VoiceActionResult;

  addCalendarEvent(intentionId: string, blockId: string, confirm: boolean): Promise<VoiceActionResult>;
  deleteAllIntentions(confirm: boolean): VoiceActionResult;
  disconnectIntegration(provider: string, confirm: boolean): Promise<VoiceActionResult>;
  requestAccountDeletion(confirm: boolean): VoiceActionResult;
};

function isVoiceToolName(name: string): name is VoiceToolName {
  return (voiceToolNames as readonly string[]).includes(name);
}

export function createVoiceToolExecutor(actions: VoiceActions) {
  async function run(name: string, rawArgs: unknown): Promise<unknown> {
    if (!isVoiceToolName(name)) return { error: `Unknown tool: ${name}` };
    const parsed = voiceToolArgsSchemas[name].safeParse(rawArgs ?? {});
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Those arguments were not valid.' };
    const args = parsed.data as Record<string, unknown>;

    // Mechanical gate: a model mistake cannot execute a destructive tool without confirm:true,
    // regardless of what the system prompt says.
    if (voiceToolRequiresConfirm[name] && args.confirm !== true) {
      return { needsConfirmation: true, error: 'Ask the user to confirm out loud, then call this tool again with confirm set to true.' };
    }

    try {
      switch (name) {
        case 'list_intentions': return { intentions: actions.listIntentions(args.filter as 'active' | 'archived' | 'all') };
        case 'get_intention': return actions.getIntention(args.id as string) ?? { error: 'No intention with that id.' };
        case 'list_relationships': return { relationships: actions.listRelationships() };
        case 'get_preferences': return actions.getPreferences();
        case 'list_connections': return { connections: actions.listConnections() };
        case 'check_calendar_availability': return await actions.checkCalendarAvailability(args.startDate as string, args.endDate as string);

        case 'create_intention': return await actions.createIntention(args.rawCapture as string);
        case 'update_intention': { const { id, ...patch } = args; return actions.updateIntention(id as string, patch); }
        case 'archive_intention': return actions.archiveIntention(args.id as string);
        case 'restore_intention': return actions.restoreIntention(args.id as string);

        case 'schedule_time_block': return actions.scheduleTimeBlock(args.intentionId as string, args.date as string, args.time as string, (args.durationMinutes as number | undefined) ?? 30);
        case 'remove_time_block': return actions.removeTimeBlock(args.intentionId as string, args.blockId as string);

        case 'create_relationship': return await actions.createRelationship(args.fromId as string, args.toId as string, args.relation as string);
        case 'delete_relationship': return await actions.deleteRelationship(args.relationshipId as string);

        case 'update_preferences': return actions.updatePreferences(args);
        case 'set_suggestion_feedback': return await actions.setSuggestionFeedback(args.clientId as string, args.state as string, (args.snoozedUntil as string | null | undefined) ?? null);

        case 'navigate_view': return actions.navigateView(args.view as string, { accountTab: args.accountTab as string | undefined, intentionId: args.intentionId as string | undefined });

        case 'add_calendar_event': return await actions.addCalendarEvent(args.intentionId as string, args.blockId as string, args.confirm as boolean);
        case 'delete_all_intentions': return actions.deleteAllIntentions(args.confirm as boolean);
        case 'disconnect_integration': return await actions.disconnectIntegration(args.provider as string, args.confirm as boolean);
        case 'request_account_deletion': return actions.requestAccountDeletion(args.confirm as boolean);
        default: return { error: `Tool not handled: ${name}` };
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Something went wrong.' };
    }
  }
  return { run };
}
