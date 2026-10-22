import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { voiceAgentDefaultName, type VoiceAgentTone, type VoiceAgentVoice } from '@clearhead/domain';
import { Modal } from './Modal';
import { UiIcon } from './UiIcon';
import { useReducedMotionPref } from '../lib/motion-prefs.client';
import { createVoiceSession, type VoiceRealtimeEvent, type VoiceSession, type VoiceSessionStatus } from '../lib/voice-session.client';
import { createVoiceToolExecutor, type VoiceActions } from '../lib/voice-tools.client';

type AgentState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';
type ToolStatus = 'pending' | 'confirm' | 'done' | 'error';
type TimelineEntry =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'assistant'; text: string }
  | { id: string; kind: 'tool'; toolName: string; label: string; status: ToolStatus; refId?: string; refTitle?: string };

const pendingToolLabel: Record<string, string> = {
  list_intentions: 'Looking through your thoughts…', get_intention: 'Opening that thought…',
  list_relationships: 'Checking your connections…', get_preferences: 'Checking your preferences…',
  list_connections: 'Checking your connections…', check_calendar_availability: 'Checking your calendar…',
  create_intention: 'Capturing that…', update_intention: 'Updating that thought…',
  archive_intention: 'Archiving…', restore_intention: 'Restoring…',
  schedule_time_block: 'Setting aside time…', remove_time_block: 'Removing that time…',
  create_relationship: 'Connecting those thoughts…', delete_relationship: 'Removing that connection…',
  update_preferences: 'Updating your preferences…', set_suggestion_feedback: 'Noting that…',
  navigate_view: 'Taking you there…', add_calendar_event: 'Adding to Google Calendar…',
  delete_all_intentions: 'Preparing to delete everything…', disconnect_integration: 'Disconnecting…',
  request_account_deletion: 'Opening account settings…',
};
const doneToolLabel: Record<string, string> = {
  list_intentions: 'Looked through your thoughts.', get_intention: 'Found that thought.',
  list_relationships: 'Checked your connections.', get_preferences: 'Checked your preferences.',
  list_connections: 'Checked your connections.',
};

export function VoiceAssistant({ actions, apiUrl, getAccessToken, userName, agentName, agentTone, agentVoice, disabled, insights }: {
  actions: VoiceActions; apiUrl: string; getAccessToken: () => Promise<string | null>; userName?: string;
  agentName?: string; agentTone?: VoiceAgentTone; agentVoice?: VoiceAgentVoice; disabled?: boolean; insights?: string[];
}) {
  const name = agentName?.trim() || voiceAgentDefaultName;
  const [open, setOpen] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [agentState, setAgentState] = useState<AgentState>('idle');
  const [caption, setCaption] = useState('');
  const [muted, setMuted] = useState(false);
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [insightEntries, setInsightEntries] = useState<Array<{ id: string; text: string }>>([]);
  const [unreadInsights, setUnreadInsights] = useState(0);
  const lastInsightsKey = useRef<string>('');
  const sessionRef = useRef<VoiceSession | null>(null);
  const executorRef = useRef(createVoiceToolExecutor(actions));
  executorRef.current = createVoiceToolExecutor(actions);
  const pendingCalls = useRef(new Map<string, { name: string }>());
  const assistantEntryOpen = useRef<string | null>(null);
  const entryCounter = useRef(0);
  const logRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useReducedMotionPref();

  function nextId(prefix: string) { entryCounter.current += 1; return `${prefix}-${entryCounter.current}`; }
  function pushEntry(entry: TimelineEntry) { setEntries((current) => [...current, entry]); }
  function patchEntry(id: string, patch: Partial<TimelineEntry>) {
    setEntries((current) => current.map((entry) => (entry.id === id ? { ...entry, ...patch } as TimelineEntry : entry)));
  }

  function appendAssistantDelta(delta: string) {
    if (assistantEntryOpen.current) {
      const id = assistantEntryOpen.current;
      setEntries((current) => current.map((entry) => (entry.id === id && entry.kind === 'assistant' ? { ...entry, text: entry.text + delta } : entry)));
      return;
    }
    const id = nextId('a'); assistantEntryOpen.current = id;
    pushEntry({ id, kind: 'assistant', text: delta });
  }

  function openReference(entry: TimelineEntry) {
    if (entry.kind !== 'tool' || !entry.refId) return;
    actions.navigateView('explore', { intentionId: entry.refId });
    closePanel();
  }

  function handleEvent(event: VoiceRealtimeEvent) {
    const type = event.type;
    if (type.includes('speech_started')) { setAgentState('listening'); setCaption('Listening…'); return; }
    if (type.includes('speech_stopped')) { setAgentState('thinking'); setCaption('Thinking…'); return; }
    if (type.includes('input_audio_transcription.completed')) {
      const text = typeof event.transcript === 'string' ? event.transcript.trim() : '';
      if (text) pushEntry({ id: nextId('u'), kind: 'user', text });
      return;
    }
    if (type.includes('audio_transcript.delta') && typeof event.delta === 'string') {
      setAgentState('speaking'); setCaption('Speaking…'); appendAssistantDelta(event.delta); return;
    }
    if (type.includes('audio_transcript.done')) { assistantEntryOpen.current = null; return; }
    if (type === 'response.output_item.added') {
      const item = event.item as { type?: string; call_id?: string; name?: string } | undefined;
      if (item?.type === 'function_call' && item.call_id && item.name) {
        pendingCalls.current.set(item.call_id, { name: item.name });
        pushEntry({ id: item.call_id, kind: 'tool', toolName: item.name, label: pendingToolLabel[item.name] ?? 'Working on it…', status: 'pending' });
      }
      return;
    }
    if (type === 'response.function_call_arguments.done') {
      const callId = event.call_id as string | undefined;
      if (!callId) return;
      const pending = pendingCalls.current.get(callId);
      pendingCalls.current.delete(callId);
      if (!pending) return;
      let args: unknown = {};
      try { args = JSON.parse((event.arguments as string | undefined) ?? '{}'); } catch { /* keep {} */ }
      void executorRef.current.run(pending.name, args).then((result) => {
        sessionRef.current?.sendToolResult(callId, result);
        const record = result as Record<string, unknown> | null;
        const needsConfirmation = Boolean(record?.needsConfirmation);
        const errorText = typeof record?.error === 'string' ? record.error : null;
        const message = typeof record?.message === 'string' ? record.message : null;
        patchEntry(callId, {
          status: needsConfirmation ? 'confirm' : errorText ? 'error' : 'done',
          label: needsConfirmation ? 'Waiting for your OK…' : message ?? (errorText ? errorText : doneToolLabel[pending.name] ?? 'Done.'),
          refId: typeof record?.id === 'string' ? record.id : undefined,
          refTitle: typeof record?.title === 'string' ? record.title : undefined,
        });
      });
      return;
    }
    if (type.includes('response.done') || type.includes('output_audio_buffer.stopped')) { setAgentState('listening'); setCaption('Listening…'); return; }
    if (type === 'error') { setAgentState('error'); setCaption((event.error as { message?: string } | undefined)?.message ?? 'Something went wrong.'); return; }
  }

  function handleStatus(nextStatus: VoiceSessionStatus, detail?: string) {
    if (nextStatus === 'connecting') { setAgentState('connecting'); setCaption('Connecting…'); }
    else if (nextStatus === 'connected' && detail === 'warning') { setCaption('Wrapping up soon…'); }
    else if (nextStatus === 'connected') { setAgentState('listening'); setCaption('Listening…'); }
    else if (nextStatus === 'error') { setAgentState('error'); setCaption(detail ?? 'Could not start voice mode.'); }
    else if (nextStatus === 'closed') { setAgentState('idle'); setCaption(''); }
  }

  function openPanel(initiatorText?: string) {
    setOpen(true); setShowTranscript(false); setEntries([]); setMuted(false); setUnreadInsights(0);
    pendingCalls.current.clear(); assistantEntryOpen.current = null;
    const greetingName = userName?.trim();
    const initialInstructions = initiatorText
      ? `The user just tapped on this suggestion you gave them: "${initiatorText}". Bring it up yourself right now, in one short, warm sentence, and offer to help with it.`
      : greetingName
        ? `Greet the user right now by saying "Hello ${greetingName}" and ask how you can help, in one short, warm sentence.`
        : 'Greet the user right now and ask how you can help, in one short, warm sentence.';
    const session = createVoiceSession({
      apiUrl, getAccessToken, onEvent: handleEvent, onStatus: handleStatus, initialInstructions,
      sessionRequestBody: { name, ...(agentTone ? { tone: agentTone } : {}), ...(agentVoice ? { voice: agentVoice } : {}) },
    });
    sessionRef.current = session;
    void session.connect();
  }
  function closePanel() {
    sessionRef.current?.disconnect();
    sessionRef.current = null;
    setOpen(false); setAgentState('idle');
  }
  useEffect(() => () => { sessionRef.current?.disconnect(); }, []);
  useEffect(() => {
    if (showTranscript && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [entries, insightEntries, showTranscript]);

  /** A fresh batch of AI coach insights arrives as plain strings and gets revealed one
   * bubble at a time, staggered, like the assistant is thinking them through — kept in
   * their own state so openPanel()'s `setEntries([])` reset (for the live conversation)
   * never wipes them before the user has seen them. */
  useEffect(() => {
    const list = insights ?? [];
    const key = list.join(' ');
    if (!list.length || key === lastInsightsKey.current) return;
    lastInsightsKey.current = key;
    setInsightEntries([]);
    setUnreadInsights(list.length);
    const timers = list.map((text, index) => window.setTimeout(() => {
      setInsightEntries((current) => [...current, { id: `insight-${index}-${Date.now()}`, text }]);
    }, index * 500));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [insights]);

  function dismissInsight(id: string) {
    setInsightEntries((current) => current.filter((entry) => entry.id !== id));
    setUnreadInsights((current) => Math.max(0, current - 1));
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    sessionRef.current?.setMuted(next);
  }

  if (disabled) return null;

  const activity = entries.filter((entry): entry is Extract<TimelineEntry, { kind: 'tool' }> => entry.kind === 'tool').slice(-5);

  return (
    <>
      {!open && (
        <div className="voice-fab-dock">
          {insightEntries.length > 0 && (
            <div className="voice-insight-shelf" role="list" aria-label={`${insightEntries.length} new suggestion${insightEntries.length === 1 ? '' : 's'}`}>
              <AnimatePresence initial={false}>
                {insightEntries.map((entry) => (
                  <motion.div
                    key={entry.id}
                    role="listitem"
                    className="voice-insight-card"
                    layout={!reducedMotion}
                    initial={reducedMotion ? false : { opacity: 0, y: 10, scale: 0.94 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.94, transition: { duration: 0.15 } }}
                    transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                  >
                    <button type="button" className="voice-insight-card-body" onClick={() => openPanel(entry.text)}>
                      <span className="voice-insight-card-icon" aria-hidden="true"><UiIcon name="suggestions" /></span>
                      <span className="voice-insight-card-text"><span className="sr-only">AI suggested: </span>{entry.text}</span>
                    </button>
                    <button type="button" className="voice-insight-card-dismiss" aria-label="Dismiss suggestion" onClick={(event) => { event.stopPropagation(); dismissInsight(entry.id); }}>
                      <UiIcon name="close" />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
          <button type="button" className="voice-fab" onClick={() => openPanel()} aria-label={unreadInsights ? `Talk to ${name} — ${unreadInsights} new insight${unreadInsights === 1 ? '' : 's'}` : `Talk to ${name}`}>
            <span className="brand-mark"><i /><i /><i /></span>
            {unreadInsights > 0 && <span className="voice-fab-badge" aria-hidden="true" />}
          </button>
        </div>
      )}
      <AnimatePresence>{open && (
        <Modal key="voice-panel" onClose={closePanel} className="voice-panel" label={`Talk to ${name}`}>
          <div className="voice-topbar">
            <div className="voice-topbar-title">
              <span className={`voice-dot voice-dot-${agentState}`} aria-hidden="true" />
              <span>{name}</span>
              <span className="voice-status" role="status">{caption}</span>
            </div>
            <button type="button" className={`voice-toggle-chat ${showTranscript ? 'active' : ''}`} aria-pressed={showTranscript} aria-label={showTranscript ? 'Hide conversation' : 'Show conversation'} onClick={() => setShowTranscript((value) => !value)}>
              <UiIcon name="chat" />
            </button>
          </div>

          {!showTranscript && (
            <div className="voice-stage">
              <div className={`voice-avatar voice-avatar-${agentState}`}><span className="brand-mark"><i /><i /><i /></span></div>
              <div className="voice-activity">
                {activity.length === 0 && <p className="voice-activity-empty">{agentState === 'connecting' ? 'Connecting…' : 'Go ahead — I\'m listening.'}</p>}
                {activity.map((entry) => (
                  <button key={entry.id} type="button" className={`voice-activity-row voice-activity-${entry.status} ${entry.refId ? 'linkable' : ''}`} onClick={() => openReference(entry)} disabled={!entry.refId}>
                    <span className={`voice-activity-icon voice-activity-icon-${entry.status}`} aria-hidden="true" />
                    <span>{entry.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {showTranscript && (
            <div className="voice-chat" role="log" aria-live="polite" ref={logRef}>
              {entries.length === 0 && insightEntries.length === 0 && <p className="voice-activity-empty">{agentState === 'connecting' ? 'Connecting…' : 'Go ahead — I\'m listening.'}</p>}
              {insightEntries.map((entry) => (
                <p key={entry.id} className="voice-bubble voice-bubble-assistant voice-bubble-insight">
                  <span className="voice-bubble-ai-badge" title="AI suggested"><UiIcon name="suggestions" />AI</span>
                  {entry.text}
                </p>
              ))}
              {entries.map((entry) => {
                if (entry.kind === 'tool') {
                  return (
                    <button key={entry.id} type="button" className={`voice-tool-card voice-tool-${entry.status} ${entry.refId ? 'linkable' : ''}`} onClick={() => openReference(entry)} disabled={!entry.refId}>
                      <span className={`voice-activity-icon voice-activity-icon-${entry.status}`} aria-hidden="true" />
                      <span className="voice-tool-label">{entry.label}</span>
                      {entry.refId && <span className="voice-tool-open">Open ↗</span>}
                    </button>
                  );
                }
                return <p key={entry.id} className={`voice-bubble voice-bubble-${entry.kind}`}>{entry.text}</p>;
              })}
            </div>
          )}

          <div className="voice-controls">
            <button type="button" className="voice-mute" aria-pressed={muted} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute' : 'Mute'} onClick={toggleMute}>
              <UiIcon name={muted ? 'mic-off' : 'mic'} />
            </button>
            <button type="button" className="voice-end" aria-label="End conversation" title="End conversation" onClick={closePanel}>
              <UiIcon name="close" />
            </button>
          </div>
        </Modal>
      )}</AnimatePresence>
    </>
  );
}
