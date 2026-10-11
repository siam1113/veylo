import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, AppState, FlatList, Keyboard, Linking, Modal, Platform, Pressable, SafeAreaView, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { appendVoiceTranscript, calendarAvailabilityMatchesRange, chunkJsonPayload, findAvailableSlot, rankIntentionSuggestions, rawCaptureMaxLength } from '@veylo/domain';
import { auth, apiRequest } from '../lib/backend';
import { applyLocalRelationshipOperations, clearLocal, clearPendingLocalPreferences, deleteLocal, deleteLocalRelationshipOperations, deleteLocalTimeBlockDeletions, getLocalFlag, getLocalPreferences, getLocalValue, getPendingLocalPreferences, initializeStore, listLocal, listLocalRelationships, listLocalRelationshipOperations, listLocalSuggestionFeedback, listLocalTimeBlockDeletions, putLocalSuggestionFeedback, queueLocalRelationshipOperation, queueLocalTimeBlockDeletion, saveLocal, saveLocalPreferences, saveLocalRelationships, saveLocalSuggestionFeedback, setLocalFlag, setLocalValue, type LocalIntention, type LocalPreferences, type LocalRelationship, type LocalRelationshipOperation, type LocalSuggestionFeedback, type LocalTimeBlock } from '../lib/store';

const palette = { bg: '#f7f5f0', paper: '#fffefa', ink: '#292a25', muted: '#77796e', green: '#68765f', line: '#e7e3d9', red: '#9b5247' };
const kinds = ['unclassified', 'idea', 'action', 'commitment', 'question', 'goal', 'meeting', 'note'];
const statuses = ['captured', 'exploring', 'ready', 'planned', 'active', 'completed', 'archived'];
type IntentionRelationship = LocalRelationship;
type Perspective = 'space' | 'explore' | 'align' | 'time' | 'suggestions' | 'connections';
type PerspectiveRow =
  | { type: 'intention'; key: string; item: LocalIntention }
  | { type: 'relationship'; key: string; relationship: LocalRelationship }
  | { type: 'time'; key: string; item: LocalIntention; block: LocalTimeBlock };
type JiraIssue = { id: string; key: string; summary: string; status: string; project: string; dueDate: string | null; url: string };
type NotionPage = { id: string; kind: 'page' | 'database'; title: string; url: string; lastEditedAt: string | null };

function SignIn() {
  const [email, setEmail] = useState(''); const [otp, setOtp] = useState(''); const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  async function send() {
    if (!auth) { setMessage('Set the Supabase app configuration to continue.'); return; }
    setBusy(true); setMessage('');
    try {
      const { error } = await auth.auth.signInWithOtp({ email: email.trim() });
      if (error) setMessage(error.message);
      else { setSent(true); setMessage('Check your email for a one-time code.'); }
    } catch { setMessage('Could not send a sign-in code. Check your connection and try again.'); }
    finally { setBusy(false); }
  }
  async function verify() {
    if (!auth) return;
    setBusy(true); setMessage('');
    try {
      const { error } = await auth.auth.verifyOtp({ email: email.trim(), token: otp.trim(), type: 'email' });
      if (error) setMessage(error.message);
    } catch { setMessage('Could not verify that code. Check your connection and try again.'); }
    finally { setBusy(false); }
  }
  return <SafeAreaView style={styles.center}><View style={styles.authCard}><Text style={styles.brand}>✳ veylo</Text><Text style={styles.eyebrow}>A PRIVATE SPACE FOR WHAT MATTERS</Text><Text style={styles.hero}>A little room to think.</Text><Text style={styles.muted}>Sign in to keep your intentions synced across devices.</Text><TextInput accessibilityLabel="Email address" style={styles.input} keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} placeholder="Email address" />{sent && <TextInput accessibilityLabel="Email verification code" style={styles.input} keyboardType="number-pad" value={otp} onChangeText={setOtp} placeholder="Email code" />}{sent ? <Button label="Verify code" onPress={verify} disabled={busy || !otp} /> : <Button label={busy ? 'Sending sign-in code' : 'Email me a sign-in code'} onPress={send} disabled={busy || !email} />}<Text accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.muted}>{message}</Text></View></SafeAreaView>;
}

function Button({ label, onPress, disabled, secondary }: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, secondary && styles.secondaryButton, disabled && { opacity: .6 }]}><Text style={[styles.buttonText, secondary && styles.secondaryButtonText]}>{label}</Text></Pressable>;
}

type BrainstormMessage = { id: string; clientRequestId: string; parentMessageId: string | null; role: 'user' | 'assistant'; status: 'pending' | 'complete' | 'failed'; content: string; createdAt: string };
type IntentionHistoryEntry = { id: string; version: number; action: string; changedFields: string[]; createdAt: string };
function BrainstormConversation({ ownerId, intentionId, enabled, archived }: { ownerId: string | null; intentionId: string | null; enabled: boolean; archived: boolean }) {
  const [messages, setMessages] = useState<BrainstormMessage[]>([]);
  const [draft, setDraft] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [refreshKey, setRefreshKey] = useState(0);
  const retryRequest = useRef<{ id: string; message: string } | null>(null);
  const awaitingReply = messages.some((message) => message.status === 'pending');
  useEffect(() => {
    if (!intentionId) { setMessages([]); return; }
    let active = true; let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = async () => {
      try {
        const result = await apiRequest<{ messages: BrainstormMessage[] }>(`/intentions/${encodeURIComponent(intentionId)}/brainstorm`, {}, ownerId);
        if (!active) return;
        setMessages(result.messages); setError('');
        if (result.messages.some((message) => message.status === 'pending')) timer = setTimeout(() => void refresh(), 1400);
      } catch {
        if (active) { setError('Conversation could not load. Check your connection and retry.'); timer = setTimeout(() => void refresh(), 3000); }
      }
    };
    void refresh();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [ownerId, intentionId, refreshKey]);
  async function send() {
    const message = draft.trim();
    if (!intentionId || !enabled || archived || busy || awaitingReply || !message) return;
    const request = retryRequest.current?.message === message ? retryRequest.current : { id: Crypto.randomUUID(), message };
    retryRequest.current = request; setBusy(true); setError('');
    try {
      await apiRequest(`/intentions/${encodeURIComponent(intentionId)}/brainstorm`, {
        method: 'POST', body: JSON.stringify({ clientRequestId: request.id, message: request.message }),
      }, ownerId);
      retryRequest.current = null; setDraft(''); setRefreshKey((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Message could not be sent. Retry when connected.');
      setRefreshKey((value) => value + 1);
    } finally { setBusy(false); }
  }
  function retry(message: BrainstormMessage) {
    const original = messages.find((item) => item.clientRequestId === message.clientRequestId && item.role === 'user');
    if (!original) return;
    retryRequest.current = { id: message.clientRequestId, message: original.content };
    setDraft(original.content); setError('');
  }
  return <View style={styles.brainstormCard}>
    <Text accessibilityRole="header" style={styles.sectionTitle}>Think it through</Text>
    <Text style={styles.muted}>An optional conversation about this thought.</Text>
    {intentionId ? messages.map((message) => <View key={message.id} style={[styles.brainstormMessage, message.role === 'user' && styles.brainstormUserMessage]}>
      <Text style={styles.brainstormRole}>{message.role === 'user' ? 'You' : 'Veylo'}</Text>
      {message.status === 'pending' ? <Text style={styles.cardBody}>Thinking this through…</Text> : message.status === 'failed' ? <><Text style={styles.cardBody}>That reply didn’t come through.</Text><Pressable accessibilityRole="button" disabled={!enabled || archived || !intentionId} onPress={() => retry(message)}><Text style={styles.connectionButtonText}>Retry reply</Text></Pressable></> : <Text style={styles.cardBody}>{message.content}</Text>}
    </View>) : null}
    {!enabled ? <Text style={styles.muted}>Turn on AI-assisted features in Settings to start. When enabled, Veylo sends this thought and the conversation to OpenAI to draft replies.</Text>
      : !intentionId ? <Text style={styles.muted}>Sync this thought before starting a conversation.</Text>
        : archived ? <Text style={styles.muted}>Restore this thought to continue the conversation.</Text>
          : <>
            <Text style={styles.brainstormPrivacy}>Your thought and conversation are sent to OpenAI for replies. Veylo does not save a reply into the thought without your edit.</Text>
            <TextInput accessibilityLabel="Ask Veylo about this thought" multiline maxLength={2000} editable={!busy && !awaitingReply} value={draft} onChangeText={setDraft} placeholder={awaitingReply ? 'Waiting for Veylo to reply…' : 'What would be helpful to think through?'} style={styles.brainstormInput} />
            <Button label={awaitingReply ? 'Thinking…' : busy ? 'Sending…' : 'Ask Veylo'} disabled={busy || awaitingReply || !draft.trim()} onPress={() => void send()} />
          </>}
    {error ? <Text accessibilityRole="alert" style={styles.brainstormError}>{error}</Text> : null}
  </View>;
}

function textOrNull(value: string) { const text = value.trim(); return text || null; }
function sameIntentionSnapshot(left: LocalIntention, right: LocalIntention): boolean {
  return left.rawCapture === right.rawCapture && left.title === right.title && left.kind === right.kind
    && left.status === right.status && left.intent === right.intent && left.purpose === right.purpose
    && left.desiredOutcome === right.desiredOutcome && left.roughPlan === right.roughPlan
    && left.horizon === right.horizon && left.effortEstimate === right.effortEstimate && left.energyContext === right.energyContext;
}
function dateKey(value: Date) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`; }
type CalendarCheck = { start: string; end: string; checkedAt: string };
const CALENDAR_CHECK_MAX_AGE_MS = 5 * 60_000;
const calendarCheckIsFresh = (check: CalendarCheck | null, now = Date.now()) => {
  const checkedAt = Date.parse(check?.checkedAt ?? '');
  return Number.isFinite(checkedAt) && checkedAt <= now && now - checkedAt <= CALENDAR_CHECK_MAX_AGE_MS;
};
function shiftDate(value: Date, days: number) { const next = new Date(value); next.setDate(next.getDate() + days); return next; }

export default function Home() {
  const [session, setSession] = useState<boolean | null>(null); const [userId, setUserId] = useState<string | null>(null); const [items, setItems] = useState<LocalIntention[]>([]);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const activeUserIdRef = useRef<string | null>(null);
  const oauthCompletionStates = useRef(new Set<string>());
  const pendingOAuthUrl = useRef<string | null>(null);
  const refreshConnectionsRef = useRef<() => Promise<void>>(async () => undefined);
  const pullQueueRef = useRef<Promise<void>>(Promise.resolve());
  const captureWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const [perspective, setPerspective] = useState<Perspective>('space'); const [searchText, setSearchText] = useState('');
  const [timePeriod, setTimePeriod] = useState<'day' | 'week' | 'month' | 'year'>('week'); const [timeDate, setTimeDate] = useState(() => new Date());
  const [showArchived, setShowArchived] = useState(false);
  const [capture, setCapture] = useState(''); const [busy, setBusy] = useState(false); const [syncLabel, setSyncLabel] = useState('Saved on this device');
  const captureDraftRef = useRef(''); const captureLimitWarningShown = useRef(false);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [calendarConnected, setCalendarConnected] = useState(false); const [calendarBusy, setCalendarBusy] = useState(false); const [calendarMessage, setCalendarMessage] = useState('');
  const [busyWindows, setBusyWindows] = useState<Array<{ start: string; end: string }>>([]); const [busyWindowRange, setBusyWindowRange] = useState<CalendarCheck | null>(null);
  useEffect(() => {
    if (!busyWindowRange) return;
    const expiresAt = Date.parse(busyWindowRange.checkedAt) + CALENDAR_CHECK_MAX_AGE_MS;
    const timer = setTimeout(() => { setBusyWindows([]); setBusyWindowRange(null); setCalendarMessage('Calendar availability check expired. Refresh it before using a suggested slot.'); }, Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [busyWindowRange]);
  const [jiraConnected, setJiraConnected] = useState(false); const [jiraBusy, setJiraBusy] = useState(false); const [jiraMessage, setJiraMessage] = useState(''); const [jiraIssues, setJiraIssues] = useState<JiraIssue[]>([]);
  const [notionConnected, setNotionConnected] = useState(false); const [notionWorkspace, setNotionWorkspace] = useState(''); const [notionBusy, setNotionBusy] = useState(false); const [notionMessage, setNotionMessage] = useState(''); const [notionPages, setNotionPages] = useState<NotionPage[]>([]); const [notionCursor, setNotionCursor] = useState<string | null>(null); const [notionHasMore, setNotionHasMore] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false); const [selected, setSelected] = useState<LocalIntention | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [systemReduceMotion, setSystemReduceMotion] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false); const [notificationMessage, setNotificationMessage] = useState('');
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false); const [quietHoursMessage, setQuietHoursMessage] = useState('');
  const [relationships, setRelationships] = useState<IntentionRelationship[]>([]); const [relationshipType, setRelationshipType] = useState<IntentionRelationship['relation']>('related');
  const relationshipSyncInProgress = useRef(false); const relationshipSyncAgain = useRef(false);
  const localPreferencesRef = useRef<LocalPreferences | null>(null);
  const preferenceRevision = useRef(0);
  const preferenceSyncQueue = useRef<Promise<void>>(Promise.resolve());
  const preferenceWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const accountDeletionRequested = useRef(false);
  const [suggestionFeedback, setSuggestionFeedback] = useState<LocalSuggestionFeedback[]>([]); const [suggestionsEnabled, setSuggestionsEnabled] = useState(true); const [suggestionLimit, setSuggestionLimit] = useState(2);
  const [editTitle, setEditTitle] = useState(''); const [editKind, setEditKind] = useState('unclassified'); const [editIntent, setEditIntent] = useState(''); const [editPurpose, setEditPurpose] = useState(''); const [editOutcome, setEditOutcome] = useState(''); const [editPlan, setEditPlan] = useState('');
  const [editHorizon, setEditHorizon] = useState(''); const [editEffort, setEditEffort] = useState(''); const [editEnergyContext, setEditEnergyContext] = useState('');
  const [history, setHistory] = useState<IntentionHistoryEntry[]>([]); const [historyOpen, setHistoryOpen] = useState(false); const [historyBusy, setHistoryBusy] = useState(false); const [historyMessage, setHistoryMessage] = useState('');
  const [scheduleDate, setScheduleDate] = useState(''); const [scheduleTime, setScheduleTime] = useState('10:00'); const [scheduleMinutes, setScheduleMinutes] = useState('30');
  const [timeBlockDeletionRevision, setTimeBlockDeletionRevision] = useState(0);
  const reload = useCallback(async () => {
    if (!userId) { setItems([]); return; }
    const latest = await listLocal(userId); setItems(latest);
    setSelected((current) => current ? latest.find((item) => item.id === current.id) ?? current : null);
  }, [userId]);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setSystemReduceMotion);
    const motionListener = AccessibilityInfo.addEventListener('reduceMotionChanged', setSystemReduceMotion);
    const started = ExpoSpeechRecognitionModule.addListener('start', () => setVoiceRecording(true));
    const ended = ExpoSpeechRecognitionModule.addListener('end', () => setVoiceRecording(false));
    const result = ExpoSpeechRecognitionModule.addListener('result', (event) => {
      if (!event.isFinal) return;
      const transcript = event.results[event.results.length - 1]?.transcript?.trim();
      if (transcript) {
        const combined = appendVoiceTranscript(captureDraftRef.current, transcript);
        if (combined.truncated && !captureLimitWarningShown.current) {
          captureLimitWarningShown.current = true;
          Alert.alert('Capture limit reached', `Veylo keeps up to ${rawCaptureMaxLength.toLocaleString()} characters in one thought. Save this thought, then start another to keep the rest.`);
        }
        captureDraftRef.current = combined.rawCapture;
        setCapture(captureDraftRef.current);
      }
    });
    const error = ExpoSpeechRecognitionModule.addListener('error', (event) => {
      setVoiceRecording(false);
      if (event.error !== 'aborted') Alert.alert('Voice capture stopped', event.message || 'Try again, or type your thought.');
    });
    return () => { motionListener.remove(); started.remove(); ended.remove(); result.remove(); error.remove(); };
  }, []);

  useEffect(() => {
    const handleConnectionUrl = (url: string | null) => {
      if (!url) return;
      try {
        const parsedUrl = new URL(url);
        const query = parsedUrl.searchParams;
        const oauth = new URLSearchParams(parsedUrl.hash.replace(/^#/, ''));
        const provider = oauth.get('oauth_provider');
        const code = oauth.get('oauth_code');
        const state = oauth.get('oauth_state');
        if (provider && code && state && ['google', 'jira', 'notion'].includes(provider)) {
          if (!userId) {
            pendingOAuthUrl.current = url;
            setCalendarMessage('Sign in to the same Veylo account that started this provider connection.');
            return;
          }
          if (oauthCompletionStates.current.has(state)) return;
          pendingOAuthUrl.current = url;
          oauthCompletionStates.current.add(state);
          void (async () => {
            try {
              await apiRequest(`/integrations/${provider}/complete`, {
                method: 'POST', body: JSON.stringify({ code, state }),
              }, userId);
              if (pendingOAuthUrl.current === url) pendingOAuthUrl.current = null;
              if (provider === 'google') { setCalendarConnected(true); setCalendarMessage('Google Calendar connected.'); }
              else if (provider === 'jira') { setJiraConnected(true); setJiraMessage('Jira Cloud connected. Refresh assigned issues when you’re ready.'); }
              else { setNotionConnected(true); setNotionMessage('Notion connected. Refresh selected pages when you’re ready.'); }
              await refreshConnectionsRef.current().catch(() => undefined);
            } catch (error) {
              const message = error instanceof Error ? error.message : 'The provider connection could not complete. Reconnect and try again.';
              if (provider === 'google') setCalendarMessage(message);
              else if (provider === 'jira') setJiraMessage(message);
              else setNotionMessage(message);
            } finally {
              if (pendingOAuthUrl.current === url) pendingOAuthUrl.current = null;
            }
          })();
          return;
        }
        if (query.get('connection') === 'jira_connected') setJiraMessage('Jira Cloud connected. Refresh assigned issues when you’re ready.');
        else if (query.get('connection') === 'notion_connected') setNotionMessage('Notion connected. Refresh selected pages when you’re ready.');
        else if (query.has('connection_error')) {
          const message = query.get('connection_error') || 'The provider could not connect.';
          const provider = query.get('connection_provider');
          if (provider === 'google') setCalendarMessage(message);
          else if (provider === 'notion') setNotionMessage(message);
          else setJiraMessage(message);
        }
      } catch { /* Ignore unrelated or malformed app links. */ }
    };
    const listener = Linking.addEventListener('url', ({ url }) => handleConnectionUrl(url));
    void Linking.getInitialURL().then((url) => handleConnectionUrl(url ?? pendingOAuthUrl.current));
    return () => listener.remove();
  }, [userId]);

  async function requestVoicePermissionAndStart() {
    try {
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) throw new Error('Speech recognition is not available on this device.');
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) throw new Error('Microphone and speech recognition permission are required. You can type your thought instead.');
      const language = Intl.DateTimeFormat().resolvedOptions().locale.split('-u-')[0] || 'en-US';
      captureLimitWarningShown.current = false;
      ExpoSpeechRecognitionModule.start({ lang: language, interimResults: false, continuous: false, maxAlternatives: 1 });
    } catch (error) { Alert.alert('Voice capture unavailable', error instanceof Error ? error.message : 'Try typing your thought instead.'); }
  }

  function toggleVoiceCapture() {
    if (voiceRecording) { ExpoSpeechRecognitionModule.stop(); return; }
    Alert.alert(
      'Voice transcription',
      'Your device speech service transcribes what you say. Veylo saves the transcript, not an audio recording. Your device provider may process audio to provide transcription.',
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Continue', onPress: () => void requestVoicePermissionAndStart() }],
    );
  }

  useEffect(() => {
    if (!auth) { setSession(false); setUserId(null); return; }
    let authEventReceived = false;
    let disposed = false;
    void auth.auth.getSession().then(({ data }) => {
      if (disposed || authEventReceived) return;
      const nextUserId = data.session?.user.id ?? null;
      activeUserIdRef.current = nextUserId;
      setSession(Boolean(data.session)); setUserId(nextUserId);
    });
    const { data } = auth.auth.onAuthStateChange((_event, next) => {
      authEventReceived = true;
      const nextUserId = next?.user.id ?? null;
      if (activeUserIdRef.current !== nextUserId) {
        if (nextUserId) accountDeletionRequested.current = false;
        setItems([]); setRelationships([]); setSuggestionFeedback([]); setSelected(null); captureDraftRef.current = ''; setCapture('');
        localPreferencesRef.current = null;
        preferenceRevision.current += 1;
        setPerspective('space'); setSearchText(''); setShowArchived(false);
        setCalendarConnected(false); setCalendarBusy(false); setCalendarMessage(''); setBusyWindows([]); setBusyWindowRange(null); setAiEnabled(false);
        setReduceMotion(false); setSuggestionsEnabled(true); setSuggestionLimit(2);
        setQuietHoursEnabled(false); setQuietHoursMessage('');
        setJiraConnected(false); setJiraBusy(false); setJiraMessage(''); setJiraIssues([]);
        setNotionConnected(false); setNotionWorkspace(''); setNotionBusy(false); setNotionMessage(''); setNotionPages([]); setNotionCursor(null); setNotionHasMore(false);
        setNotificationsEnabled(false); setNotificationMessage(''); setSyncLabel('Saved on this device');
      }
      activeUserIdRef.current = nextUserId;
      setSession(Boolean(next)); setUserId(nextUserId);
    });
    return () => { disposed = true; data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void initializeStore(userId).then(async () => {
      const onboardingComplete = await getLocalFlag(userId, 'onboarding-complete');
      if (cancelled || activeUserIdRef.current !== userId) return;
      if (!onboardingComplete) setOnboardingOpen(true);
      const cachedRelationships = await applyLocalRelationshipOperations(userId, await listLocalRelationships(userId));
      if (cancelled || activeUserIdRef.current !== userId) return;
      setRelationships(cachedRelationships);
      const cachedFeedback = await listLocalSuggestionFeedback(userId);
      if (cancelled || activeUserIdRef.current !== userId) return;
      setSuggestionFeedback(cachedFeedback);
      const cachedItems = await listLocal(userId);
      if (cancelled || activeUserIdRef.current !== userId) return;
      setItems(cachedItems);
      if ((await listLocalTimeBlockDeletions(userId)).length) setTimeBlockDeletionRevision((value) => value + 1);
      const cachedPreferences = await getPendingLocalPreferences(userId) ?? await getLocalPreferences(userId);
      if (cachedPreferences && !cancelled && activeUserIdRef.current === userId) {
        localPreferencesRef.current = cachedPreferences;
        setAiEnabled(cachedPreferences.aiInterpretationEnabled);
        setReduceMotion(cachedPreferences.reduceMotion);
        setSuggestionsEnabled(cachedPreferences.suggestionsEnabled);
        setSuggestionLimit(cachedPreferences.suggestionLimit);
        setQuietHoursEnabled(Boolean(cachedPreferences.quietStart && cachedPreferences.quietEnd));
      }
    }).catch((error) => {
      if (!cancelled && activeUserIdRef.current === userId) {
        setSyncLabel(error instanceof Error ? error.message : 'Could not load saved intentions on this device');
      }
    });
    return () => { cancelled = true; };
  }, [reload, userId]);

  async function finishOnboarding(openConnections = false) {
    if (userId) await setLocalFlag(userId, 'onboarding-complete', true).catch(() => undefined);
    setOnboardingOpen(false);
    if (openConnections) setPerspective('connections');
  }

  const pullRemote = useCallback(() => {
    if (session !== true || !userId) return;
    const syncingUserId = userId;
    const operation = pullQueueRef.current.then(async () => {
      if (activeUserIdRef.current !== syncingUserId || accountDeletionRequested.current) return;
      const cursor = await getLocalValue(syncingUserId, 'sync-cursor');
      const path = `/sync${cursor ? `?since=${encodeURIComponent(cursor)}` : ''}`;
      const remote = await apiRequest<{ serverTime: string; intentions: Array<Record<string, any>>; timeBlocks: Array<Record<string, any>> }>(path, {}, syncingUserId);
      if (activeUserIdRef.current !== syncingUserId || accountDeletionRequested.current) return;
      const local = await listLocal(syncingUserId);
      if (activeUserIdRef.current !== syncingUserId || accountDeletionRequested.current) return;
      const byClientId = new Map(local.map((item) => [item.id, item]));
      for (const row of remote.intentions) {
        if (activeUserIdRef.current !== syncingUserId || accountDeletionRequested.current) return;
        const existing = byClientId.get(row.clientId);
        if (row.deletedAt) { if (existing) await deleteLocal(syncingUserId, row.clientId); continue; }
        if (existing?.syncState === 'pending') continue;
        await saveLocal(syncingUserId, {
          id: row.clientId, remoteId: row.id, rawCapture: row.rawCapture, title: row.title, kind: row.kind,
          intent: row.intent ?? null, purpose: row.purpose ?? null, desiredOutcome: row.desiredOutcome ?? null,
          roughPlan: row.roughPlan ?? null, horizon: row.horizon ?? null, effortEstimate: row.effortEstimate ?? null, energyContext: row.energyContext ?? null, version: row.version,
          status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt, syncState: 'synced', blocks: existing?.blocks ?? [], aiInterpretation: row.aiInterpretation ?? null,
        });
      }
      const current = await listLocal(syncingUserId); const byId = new Map(current.map((item) => [item.id, item]));
      for (const row of remote.timeBlocks) {
        if (activeUserIdRef.current !== syncingUserId || accountDeletionRequested.current) return;
        const parent = byId.get(row.intentionClientId); if (!parent) continue;
        const blocks = parent.blocks.filter((block) => block.id !== row.clientId);
        if (!row.deletedAt) blocks.push({ id: row.clientId, remoteId: row.id, startsAt: row.startsAt, endsAt: row.endsAt, timezone: row.timezone, externalEventId: row.externalEventId, externalUrl: row.externalUrl, syncState: 'synced' });
        await saveLocal(syncingUserId, { ...parent, blocks, syncState: parent.syncState });
      }
      if (activeUserIdRef.current !== syncingUserId || accountDeletionRequested.current) return;
      await setLocalValue(syncingUserId, 'sync-cursor', remote.serverTime);
      await reload(); setSyncLabel('Synced to your space');
    });
    pullQueueRef.current = operation.catch(() => undefined);
    return operation;
  }, [reload, session, userId]);

  async function synchronizeRelationships(owner: string, remote?: IntentionRelationship[]) {
    if (accountDeletionRequested.current || activeUserIdRef.current !== owner) return;
    if (relationshipSyncInProgress.current) { relationshipSyncAgain.current = true; return; }
    relationshipSyncInProgress.current = true;
    try {
      const operations = await listLocalRelationshipOperations(owner);
      if (accountDeletionRequested.current || activeUserIdRef.current !== owner) return;
      let base = remote ?? (await apiRequest<{ relationships: IntentionRelationship[] }>('/relationships', {}, owner)).relationships;
      if (accountDeletionRequested.current || activeUserIdRef.current !== owner) return;
      let rejectedCreate = false;
      let relationshipsPending = operations.length > 0;
      if (operations.length) {
        const localItems = await listLocal(owner);
        const completed = new Set<string>();
        for (const operation of operations) {
          if (accountDeletionRequested.current || activeUserIdRef.current !== owner) return;
          const { relationship } = operation;
          if (operation.action === 'create' && (!localItems.some((item) => item.id === relationship.fromClientId && item.remoteId) || !localItems.some((item) => item.id === relationship.toClientId && item.remoteId))) break;
          try {
            if (operation.action === 'create') await apiRequest('/relationships', { method: 'POST', body: JSON.stringify({ fromClientId: relationship.fromClientId, toClientId: relationship.toClientId, relation: relationship.relation }) }, owner);
            else await apiRequest('/relationships', { method: 'DELETE', body: JSON.stringify({ fromClientId: relationship.fromClientId, toClientId: relationship.toClientId, relation: relationship.relation }) }, owner);
            if (accountDeletionRequested.current || activeUserIdRef.current !== owner) return;
            completed.add(operation.opId);
          } catch (error) {
            if (operation.action === 'create' && (error as { statusCode?: number }).statusCode === 404) {
              completed.add(operation.opId);
              rejectedCreate = true;
              if (activeUserIdRef.current === owner) setSyncLabel('A saved link could not sync because an intention is no longer available.');
              continue;
            }
            throw error;
          }
        }
        await deleteLocalRelationshipOperations(owner, [...completed]);
        relationshipsPending = (await listLocalRelationshipOperations(owner)).length > 0;
        base = (await apiRequest<{ relationships: IntentionRelationship[] }>('/relationships', {}, owner)).relationships;
      }
      const merged = await applyLocalRelationshipOperations(owner, base);
      if (accountDeletionRequested.current || activeUserIdRef.current !== owner) return;
      await saveLocalRelationships(owner, merged);
      if (activeUserIdRef.current === owner) {
        setRelationships(merged);
        if (operations.length && !relationshipsPending && !rejectedCreate) setSyncLabel('Synced to your space');
      }
    } catch {
      if (activeUserIdRef.current === owner) setSyncLabel('Saved offline · relationship changes will sync when connected');
    } finally {
      relationshipSyncInProgress.current = false;
      if (relationshipSyncAgain.current && !accountDeletionRequested.current && activeUserIdRef.current === owner) {
        relationshipSyncAgain.current = false;
        void synchronizeRelationships(owner);
      }
    }
  }

  async function syncQueuedPreferences(owner: string): Promise<void> {
    const operation = preferenceSyncQueue.current.then(async () => {
      while (activeUserIdRef.current === owner && !accountDeletionRequested.current) {
        const pending = await getPendingLocalPreferences(owner);
        if (!pending) return;
        const saved = await apiRequest<LocalPreferences & { notificationsEnabled: boolean }>('/preferences', {
          method: 'PUT', body: JSON.stringify(pending),
        }, owner);
        if (activeUserIdRef.current !== owner || accountDeletionRequested.current) return;
        const cleared = await clearPendingLocalPreferences(owner, pending);
        if (cleared) {
          const cache: LocalPreferences = {
            aiInterpretationEnabled: saved.aiInterpretationEnabled, reduceMotion: saved.reduceMotion,
            suggestionsEnabled: saved.suggestionsEnabled, suggestionLimit: saved.suggestionLimit,
            quietStart: saved.quietStart, quietEnd: saved.quietEnd, timezone: saved.timezone,
          };
          await saveLocalPreferences(owner, cache, false);
        }
      }
    });
    preferenceSyncQueue.current = operation.catch(() => undefined);
    return operation;
  }

  async function savePreferenceChange(owner: string, preferences: LocalPreferences): Promise<void> {
    if (accountDeletionRequested.current) return;
    const write = preferenceWriteQueue.current.then(() => saveLocalPreferences(owner, preferences, true));
    preferenceWriteQueue.current = write.catch(() => undefined);
    try { await write; }
    catch (error) {
      if (activeUserIdRef.current === owner && localPreferencesRef.current === preferences) localPreferencesRef.current = null;
      throw error;
    }
    try {
      await syncQueuedPreferences(owner);
      if (activeUserIdRef.current === owner && !(await getPendingLocalPreferences(owner))) setSyncLabel('Preferences synced');
    } catch {
      if (activeUserIdRef.current === owner) setSyncLabel('Saved offline · preferences will sync when connected');
    }
  }

  const refreshConnections = useCallback(async () => {
    if (accountDeletionRequested.current || session !== true || !userId) return;
    const syncingUserId = userId;
    const preferenceRevisionAtStart = preferenceRevision.current;
    const results = await Promise.allSettled([
      apiRequest<{ integrations: Array<{ provider: string; connected: boolean; workspaceName?: string | null }> }>('/integrations', {}, syncingUserId),
      (async () => {
        await syncQueuedPreferences(syncingUserId);
        const remote = await apiRequest<LocalPreferences & { notificationsEnabled: boolean }>('/preferences', {}, syncingUserId);
        if (activeUserIdRef.current === syncingUserId && !accountDeletionRequested.current) {
          const cache: LocalPreferences = {
            aiInterpretationEnabled: remote.aiInterpretationEnabled, reduceMotion: remote.reduceMotion,
            suggestionsEnabled: remote.suggestionsEnabled, suggestionLimit: remote.suggestionLimit,
            quietStart: remote.quietStart, quietEnd: remote.quietEnd, timezone: remote.timezone,
          };
          await saveLocalPreferences(syncingUserId, cache, false);
          const pending = await getPendingLocalPreferences(syncingUserId);
          const effective = pending ?? cache;
          if (preferenceRevisionAtStart === preferenceRevision.current) localPreferencesRef.current = effective;
          return { ...remote, ...(preferenceRevisionAtStart === preferenceRevision.current ? effective : localPreferencesRef.current ?? effective) };
        }
        return remote;
      })(),
      apiRequest<{ relationships: IntentionRelationship[] }>('/relationships', {}, syncingUserId),
      apiRequest<{ feedback: Array<{ clientId: string; state: LocalSuggestionFeedback['state']; snoozedUntil: string | null }> }>('/suggestion-feedback', {}, syncingUserId),
    ]);
    if (activeUserIdRef.current !== syncingUserId || accountDeletionRequested.current) return;
    const [integrationState, preferences, relationState, feedbackState] = results;
    let failed = false;
    if (integrationState.status === 'fulfilled') {
      setCalendarConnected(integrationState.value.integrations.some((item) => item.provider === 'google_calendar' && item.connected));
      setJiraConnected(integrationState.value.integrations.some((item) => item.provider === 'jira_cloud' && item.connected));
      const notion = integrationState.value.integrations.find((item) => item.provider === 'notion');
      setNotionConnected(Boolean(notion?.connected)); setNotionWorkspace(notion?.workspaceName ?? '');
    }
    else failed = true;
    if (preferences.status === 'fulfilled') {
      setAiEnabled(preferences.value.aiInterpretationEnabled);
      setSuggestionsEnabled(preferences.value.suggestionsEnabled);
      setSuggestionLimit(preferences.value.suggestionLimit);
      setNotificationsEnabled(preferences.value.notificationsEnabled);
      setQuietHoursEnabled(Boolean(preferences.value.quietStart && preferences.value.quietEnd));
      setReduceMotion(preferences.value.reduceMotion);
    }
    else {
      const local = await getPendingLocalPreferences(syncingUserId) ?? await getLocalPreferences(syncingUserId);
      if (local) {
        localPreferencesRef.current = local;
        setAiEnabled(local.aiInterpretationEnabled); setReduceMotion(local.reduceMotion);
        setSuggestionsEnabled(local.suggestionsEnabled); setSuggestionLimit(local.suggestionLimit);
        setQuietHoursEnabled(Boolean(local.quietStart && local.quietEnd));
      }
      failed = true;
    }
    if (relationState.status === 'fulfilled') {
      if (userId) await synchronizeRelationships(userId, relationState.value.relationships);
    }
    else failed = true;
    if (feedbackState.status === 'fulfilled' && userId) {
      try {
        const pending = (await listLocalSuggestionFeedback(userId)).filter((item) => item.syncState === 'pending');
        if (activeUserIdRef.current !== syncingUserId || accountDeletionRequested.current) return;
        const merged = new Map<string, LocalSuggestionFeedback>(feedbackState.value.feedback.map((item) => [item.clientId, { ...item, syncState: 'synced' as const }]));
        for (const item of pending) merged.set(item.clientId, item);
        const next = [...merged.values()];
        setSuggestionFeedback(next);
        await saveLocalSuggestionFeedback(userId, next);
      } catch { failed = true; }
    } else if (feedbackState.status === 'rejected') failed = true;
    try { await pullRemote(); } catch { failed = true; }
    if (failed) setSyncLabel('Offline · showing saved intentions');
  }, [pullRemote, session, userId]);
  refreshConnectionsRef.current = refreshConnections;

  useEffect(() => {
    void refreshConnections();
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') void refreshConnections(); });
    return () => sub.remove();
  }, [refreshConnections]);

  useEffect(() => {
    if (session !== true || !userId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const retryPendingWork = async () => {
      if (cancelled || accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
      try {
        const [localItems, localFeedback, relationshipOperations, pendingPreferences, blockDeletions] = await Promise.all([
          listLocal(userId), listLocalSuggestionFeedback(userId), listLocalRelationshipOperations(userId), getPendingLocalPreferences(userId), listLocalTimeBlockDeletions(userId),
        ]);
        const hasPending = localItems.some((item) => item.syncState === 'pending' || item.blocks.some((block) => block.syncState === 'pending'))
          || localFeedback.some((item) => item.syncState === 'pending') || relationshipOperations.length > 0 || Boolean(pendingPreferences) || blockDeletions.length > 0;
        if (cancelled || accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
        if (hasPending && AppState.currentState === 'active' && activeUserIdRef.current === userId) {
          setItems(localItems);
          setSuggestionFeedback(localFeedback);
          if (blockDeletions.length) setTimeBlockDeletionRevision((value) => value + 1);
          void refreshConnections();
        }
      } catch { /* Retain queued data and retry while the app is active. */ }
      if (!cancelled && !accountDeletionRequested.current && activeUserIdRef.current === userId) timer = setTimeout(() => void retryPendingWork(), 30_000);
    };
    timer = setTimeout(() => void retryPendingWork(), 30_000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [refreshConnections, session, userId]);

  useEffect(() => {
    if (session !== true || !userId || accountDeletionRequested.current) return;
    const pending = suggestionFeedback.filter((item) => item.syncState === 'pending');
    if (!pending.length) return;
    let cancelled = false;
    void (async () => {
      try {
        const batch = pending.slice(0, 500);
        const result = await apiRequest<{ feedback: Array<{ clientId: string; state: LocalSuggestionFeedback['state']; snoozedUntil: string | null }> }>('/suggestion-feedback', {
          method: 'PUT', body: JSON.stringify({ feedback: batch.map(({ clientId, state, snoozedUntil }) => ({ clientId, state, snoozedUntil })) }),
        }, userId);
        if (cancelled || accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
        const saved = new Map(result.feedback.map((item) => [item.clientId, item]));
        const batchIds = new Set(batch.map((item) => item.clientId));
        const next = suggestionFeedback.flatMap((item) => saved.has(item.clientId)
          ? [{ ...item, state: saved.get(item.clientId)!.state, snoozedUntil: saved.get(item.clientId)!.snoozedUntil, syncState: 'synced' as const }]
          : batchIds.has(item.clientId) ? [] : [item]);
        if (accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
        await saveLocalSuggestionFeedback(userId, next);
        setSuggestionFeedback(next);
      } catch { if (!cancelled) setSyncLabel('Saved offline · suggestion feedback will sync when connected'); }
    })();
    return () => { cancelled = true; };
  }, [suggestionFeedback, session, userId]);

  useEffect(() => {
    if (session !== true || !userId || accountDeletionRequested.current) return;
    const pending = items.filter((item) => item.syncState === 'pending');
    let cancelled = false;
    void (async () => {
      try {
        const queuedDeletions = await listLocalTimeBlockDeletions(userId);
        if (cancelled || accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
        if (!pending.length && !items.some((item) => item.blocks.some((block) => block.syncState === 'pending')) && !queuedDeletions.length) return;
        if (pending.length) {
          const intentionPayload = pending.map((item) => ({
              clientId: item.id, rawCapture: item.rawCapture, title: item.title, kind: item.kind,
              intent: item.intent, purpose: item.purpose, desiredOutcome: item.desiredOutcome, roughPlan: item.roughPlan,
              horizon: item.horizon, effortEstimate: item.effortEstimate, energyContext: item.energyContext, status: item.status, expectedVersion: item.version,
            }));
          const savedRows: Array<{ clientId: string; remoteId: string; version: number }> = [];
          const conflictRows: Array<{ clientId: string; current: Record<string, any> }> = [];
          for (const batch of chunkJsonPayload(intentionPayload, (intentions) => ({ intentions }))) {
            const result = await apiRequest<{ saved: typeof savedRows; conflicts: typeof conflictRows }>('/sync/push', {
              method: 'POST', body: JSON.stringify({ intentions: batch }),
            }, userId);
            savedRows.push(...result.saved);
            conflictRows.push(...result.conflicts);
          }
          const result = { saved: savedRows, conflicts: conflictRows };
          if (cancelled || accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
          const currentItems = new Map((await listLocal(userId)).map((item) => [item.id, item]));
          for (const saved of result.saved) {
            const sent = pending.find((candidate) => candidate.id === saved.clientId);
            const current = currentItems.get(saved.clientId);
            if (!sent || !current) continue;
            if (accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
            const updated = {
              ...current, remoteId: saved.remoteId, version: saved.version,
              syncState: sameIntentionSnapshot(current, sent) ? 'synced' as const : 'pending' as const,
            };
            await saveLocal(userId, updated); currentItems.set(updated.id, updated);
          }
          for (const conflict of result.conflicts) {
            if (accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
            const item = pending.find((candidate) => candidate.id === conflict.clientId); if (!item) continue;
            const row = conflict.current;
            if (row.deletedAt) {
              await deleteLocal(userId, item.id);
              Alert.alert('Thought deleted', 'This thought was deleted on another device, so its offline copy was removed.');
              continue;
            }
            const copy: LocalIntention = { ...item, id: Crypto.randomUUID(), remoteId: null, version: null, title: `${item.title} (offline copy)`, status: 'captured', blocks: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), syncState: 'pending' };
            await saveLocal(userId, { ...item, remoteId: row.id, rawCapture: row.rawCapture, title: row.title, kind: row.kind, intent: row.intent ?? null, purpose: row.purpose ?? null, desiredOutcome: row.desiredOutcome ?? null, roughPlan: row.roughPlan ?? null, horizon: row.horizon ?? null, effortEstimate: row.effortEstimate ?? null, energyContext: row.energyContext ?? null, version: row.version, status: row.status, updatedAt: row.updatedAt, syncState: 'synced' });
            await saveLocal(userId, copy);
            Alert.alert('Offline edit saved separately', 'A newer version was already synced. Your edit is preserved as an offline copy.');
          }
        }
        const local = await listLocal(userId);
        if (cancelled || accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
        const removedBlockIds = new Set(queuedDeletions.map((deletion) => deletion.clientId));
        const blocks = local.flatMap((item) => item.blocks.filter((block) => block.syncState === 'pending' && !removedBlockIds.has(block.id)).map((block) => ({
          clientId: block.id, intentionClientId: item.id, startsAt: block.startsAt, endsAt: block.endsAt, timezone: block.timezone,
          externalEventId: block.externalEventId, externalUrl: block.externalUrl, syncState: 'pending',
        })));
        const localById = new Map(local.map((item) => [item.id, item]));
        const readyDeletions = queuedDeletions.filter((deletion) => Boolean(localById.get(deletion.intentionClientId)?.remoteId));
        blocks.push(...readyDeletions.map((deletion) => ({ ...deletion, externalEventId: null, externalUrl: null, deleted: true as const, syncState: 'pending' as const })));
        if (blocks.length) {
          const savedBlocks: Array<{ clientId: string; remoteId: string }> = [];
          for (const batch of chunkJsonPayload(blocks, (blocksInBatch) => ({ blocks: blocksInBatch }))) {
            const result = await apiRequest<{ saved: Array<{ clientId: string; remoteId: string }> }>('/sync/blocks', {
              method: 'POST', body: JSON.stringify({ blocks: batch }),
            }, userId);
            if (cancelled || accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
            savedBlocks.push(...result.saved);
          }
          const remoteIds = new Map(savedBlocks.map((row) => [row.clientId, row.remoteId]));
          await deleteLocalTimeBlockDeletions(userId, readyDeletions.filter((deletion) => remoteIds.has(deletion.clientId)).map((deletion) => deletion.clientId));
          const latestLocal = await listLocal(userId);
          for (const item of latestLocal) {
            const updated = item.blocks.map((block) => remoteIds.has(block.id) && !removedBlockIds.has(block.id) ? { ...block, remoteId: remoteIds.get(block.id)!, syncState: 'synced' as const } : block);
            if (updated.some((block, index) => block !== item.blocks[index])) await saveLocal(userId, { ...item, blocks: updated });
          }
        }
        if (!cancelled) { setSyncLabel('Synced to your space'); await reload(); void synchronizeRelationships(userId); }
      } catch { if (!cancelled) setSyncLabel('Saved offline · will sync when connected'); }
    })();
    return () => { cancelled = true; };
  }, [items, reload, session, timeBlockDeletionRevision, userId]);

  async function connectCalendar() {
    try { const result = await apiRequest<{ authorizationUrl: string }>('/integrations/google/connect', { method: 'POST', body: JSON.stringify({ target: 'mobile' }) }, userId); await Linking.openURL(result.authorizationUrl); }
    catch (error) { setCalendarMessage(error instanceof Error ? error.message : 'Could not connect Google Calendar.'); }
  }
  async function disconnectCalendar() {
    try { const result = await apiRequest<{ revocationWarning?: string }>('/integrations/google', { method: 'DELETE' }, userId); setCalendarConnected(false); setBusyWindows([]); setBusyWindowRange(null); setCalendarMessage(result?.revocationWarning ?? 'Google Calendar disconnected and its access token was revoked.'); }
    catch (error) { setCalendarMessage(error instanceof Error ? error.message : 'Could not disconnect Google Calendar.'); }
  }
  async function refreshCalendarAvailability(range?: { start: Date; end: Date }) {
    if (!userId || !calendarConnected || calendarBusy) return;
    setCalendarBusy(true);
    try {
      const start = range?.start ?? (() => { const date = new Date(); date.setDate(date.getDate() - date.getDay()); date.setHours(0, 0, 0, 0); return date; })();
      const end = range?.end ?? shiftDate(start, 7);
      const result = await apiRequest<{ busy: Array<{ start: string; end: string }> }>('/integrations/google/availability', {
        method: 'POST', body: JSON.stringify({ startsAt: start.toISOString(), endsAt: end.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }),
      }, userId);
      if (activeUserIdRef.current !== userId || accountDeletionRequested.current) return;
      setBusyWindows(result.busy); setBusyWindowRange({ start: dateKey(start), end: dateKey(end), checkedAt: new Date().toISOString() });
      setCalendarMessage(`${result.busy.length} busy windows in the checked period. Event titles are not read.`);
    } catch (error) { setCalendarMessage(error instanceof Error ? error.message : 'Availability could not load.'); }
    finally { setCalendarBusy(false); }
  }
  async function connectJira() {
    try {
      const result = await apiRequest<{ authorizationUrl: string }>('/integrations/jira/connect', { method: 'POST', body: JSON.stringify({ target: 'mobile' }) }, userId);
      await Linking.openURL(result.authorizationUrl);
      setJiraMessage('Finish authorization in your browser. Veylo will check the connection when you return.');
    } catch (error) { setJiraMessage(error instanceof Error ? error.message : 'Jira Cloud could not connect.'); }
  }
  async function disconnectJira() {
    try { await apiRequest('/integrations/jira', { method: 'DELETE' }, userId); setJiraConnected(false); setJiraIssues([]); setJiraMessage('Disconnected. Revoke Veylo’s grant in Atlassian settings if you want to remove access there too.'); }
    catch (error) { setJiraMessage(error instanceof Error ? error.message : 'Could not disconnect Jira.'); }
  }
  async function refreshJiraIssues() {
    setJiraBusy(true); setJiraMessage('');
    try {
      const result = await apiRequest<{ issues: JiraIssue[] }>('/integrations/jira/issues', {}, userId);
      setJiraIssues(result.issues);
      setJiraMessage(result.issues.length ? '' : 'No assigned issues were found on this Jira site.');
    } catch (error) { setJiraMessage(error instanceof Error ? error.message : 'Jira issues could not load.'); }
    finally { setJiraBusy(false); }
  }
  async function connectNotion() {
    try {
      const result = await apiRequest<{ authorizationUrl: string }>('/integrations/notion/connect', { method: 'POST', body: JSON.stringify({ target: 'mobile' }) }, userId);
      await Linking.openURL(result.authorizationUrl);
      setNotionMessage('Choose the pages to share in Notion. Veylo will check the connection when you return.');
    } catch (error) { setNotionMessage(error instanceof Error ? error.message : 'Notion could not connect.'); }
  }
  async function disconnectNotion() {
    try { const result = await apiRequest<{ revocationWarning?: string }>('/integrations/notion', { method: 'DELETE' }, userId); setNotionConnected(false); setNotionPages([]); setNotionCursor(null); setNotionHasMore(false); setNotionWorkspace(''); setNotionMessage(result?.revocationWarning ?? 'Notion disconnected and its access token was revoked.'); }
    catch (error) { setNotionMessage(error instanceof Error ? error.message : 'Could not disconnect Notion.'); }
  }
  async function refreshNotionPages() {
    setNotionBusy(true); setNotionMessage('');
    try {
      const result = await apiRequest<{ pages: NotionPage[]; nextCursor: string | null; hasMore: boolean }>('/integrations/notion/pages', {}, userId);
      setNotionPages(result.pages); setNotionCursor(result.nextCursor); setNotionHasMore(result.hasMore);
      setNotionMessage(result.pages.length ? '' : 'No pages or databases are shared with Veylo yet. Select them in Notion’s connection settings.');
    } catch (error) { setNotionMessage(error instanceof Error ? error.message : 'Notion pages could not load.'); }
    finally { setNotionBusy(false); }
  }
  async function loadMoreNotionPages() {
    const cursor = notionCursor;
    if (!cursor || !notionHasMore || notionBusy) return;
    setNotionBusy(true); setNotionMessage('');
    try {
      const result = await apiRequest<{ pages: NotionPage[]; nextCursor: string | null; hasMore: boolean }>(`/integrations/notion/pages?cursor=${encodeURIComponent(cursor)}`, {}, userId);
      setNotionPages((current) => {
        const merged = new Map(current.map((page): [string, NotionPage] => [page.id, page]));
        for (const page of result.pages) merged.set(page.id, page);
        return Array.from(merged.values());
      });
      setNotionCursor(result.nextCursor); setNotionHasMore(result.hasMore);
    } catch (error) { setNotionMessage(error instanceof Error ? error.message : 'More Notion pages could not load.'); }
    finally { setNotionBusy(false); }
  }
  function preferenceSnapshot(patch: Partial<LocalPreferences>): LocalPreferences {
    const current = localPreferencesRef.current ?? {
      aiInterpretationEnabled: aiEnabled, reduceMotion, suggestionsEnabled, suggestionLimit,
      quietStart: quietHoursEnabled ? '22:00' : null,
      quietEnd: quietHoursEnabled ? '08:00' : null,
      timezone: quietHoursEnabled ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' : null,
    };
    const next = { ...current, ...patch };
    localPreferencesRef.current = next;
    preferenceRevision.current += 1;
    return next;
  }
  async function persistPreferencePatch(patch: Partial<LocalPreferences>): Promise<void> {
    if (!userId || accountDeletionRequested.current) return;
    const owner = userId;
    const previous = localPreferencesRef.current;
    const preferences = preferenceSnapshot(patch);
    try { await savePreferenceChange(owner, preferences); }
    catch (error) {
      if (localPreferencesRef.current === preferences) localPreferencesRef.current = previous;
      throw error;
    }
  }
  async function setAI(enabled: boolean) {
    const previous = aiEnabled;
    setAiEnabled(enabled);
    try { await persistPreferencePatch({ aiInterpretationEnabled: enabled }); }
    catch (error) { setAiEnabled(previous); Alert.alert('Could not save this preference', error instanceof Error ? error.message : 'Check device storage and try again.'); }
  }
  async function setReducedMotion(enabled: boolean) {
    const previous = reduceMotion;
    setReduceMotion(enabled);
    try { await persistPreferencePatch({ reduceMotion: enabled }); }
    catch (error) { setReduceMotion(previous); Alert.alert('Could not save this preference', error instanceof Error ? error.message : 'Check device storage and try again.'); }
  }
  async function setSuggestionPreferences(next: { enabled?: boolean; limit?: number }) {
    const previousEnabled = suggestionsEnabled;
    const previousLimit = suggestionLimit;
    if (next.enabled !== undefined) setSuggestionsEnabled(next.enabled);
    if (next.limit !== undefined) setSuggestionLimit(next.limit);
    try {
      await persistPreferencePatch({
        ...(next.enabled !== undefined ? { suggestionsEnabled: next.enabled } : {}),
        ...(next.limit !== undefined ? { suggestionLimit: next.limit } : {}),
      });
    } catch (error) {
      setSuggestionsEnabled(previousEnabled);
      setSuggestionLimit(previousLimit);
      Alert.alert('Could not save suggestion preferences', error instanceof Error ? error.message : 'Try again when connected.');
    }
  }
  async function setNotifications(enabled: boolean) {
    const wasEnabled = notificationsEnabled;
    setNotificationMessage('');
    try {
      if (!enabled) {
        await apiRequest('/notifications/device', { method: 'DELETE' }, userId);
        setNotificationsEnabled(false);
        setNotificationMessage('Snooze reminders are off.');
        return;
      }
      if (Platform.OS !== 'ios' && Platform.OS !== 'android') throw new Error('Push reminders are available in the iOS and Android apps.');
      if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('reminders', {
        name: 'Thought reminders', importance: Notifications.AndroidImportance.DEFAULT,
      });
      const permission = await Notifications.requestPermissionsAsync();
      if (!permission.granted) throw new Error('Allow notifications in your device settings to turn on snooze reminders.');
      const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
      if (!projectId) throw new Error('Set the EAS project ID before registering this device for push reminders.');
      const token = await Notifications.getExpoPushTokenAsync({ projectId });
      await apiRequest('/notifications/device', { method: 'POST', body: JSON.stringify({ expoPushToken: token.data, platform: Platform.OS }) }, userId);
      setNotificationsEnabled(true);
      setNotificationMessage('You’ll get a quiet reminder when you snooze a thought.');
    } catch (error) {
      if (wasEnabled) await apiRequest('/notifications/device', { method: 'DELETE' }, userId).catch(() => undefined);
      setNotificationsEnabled(false);
      setNotificationMessage(error instanceof Error ? error.message : 'Could not update notification preferences.');
    }
  }
  async function setQuietHours(enabled: boolean) {
    const previous = quietHoursEnabled;
    setQuietHoursEnabled(enabled); setQuietHoursMessage('');
    try {
      await persistPreferencePatch({
        quietStart: enabled ? '22:00' : null,
        quietEnd: enabled ? '08:00' : null,
        timezone: enabled ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' : null,
      });
      setQuietHoursMessage(enabled ? 'Snooze reminders pause from 10pm to 8am local time.' : 'Quiet hours are off.');
    } catch (error) {
      setQuietHoursEnabled(previous);
      setQuietHoursMessage(error instanceof Error ? error.message : 'Could not save quiet hours.');
    }
  }
  async function createRelationship(target: LocalIntention) {
    if (!selected || selected.id === target.id || !userId || accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
    const duplicate = relationships.some((item) => item.fromClientId === selected.id && item.toClientId === target.id && item.relation === relationshipType);
    if (duplicate) { Alert.alert('Already connected', 'Those intentions already have this relationship.'); return; }
    const relationship: LocalRelationship = { id: `local:${Crypto.randomUUID()}`, fromClientId: selected.id, fromTitle: selected.title, toClientId: target.id, toTitle: target.title, relation: relationshipType };
    try {
      const operation: LocalRelationshipOperation = { opId: Crypto.randomUUID(), action: 'create', relationship };
      await queueLocalRelationshipOperation(userId, operation);
      if (accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
      const cached = await listLocalRelationships(userId);
      const next = await applyLocalRelationshipOperations(userId, cached);
      if (accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
      setRelationships(next); await saveLocalRelationships(userId, next);
      void synchronizeRelationships(userId);
    } catch (error) { Alert.alert('Could not save relationship', error instanceof Error ? error.message : 'Check device storage and try again.'); }
  }
  async function deleteRelationship(id: string) {
    if (!userId || accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
    const relationship = relationships.find((item) => item.id === id);
    if (!relationship) return;
    try {
      const operation: LocalRelationshipOperation = { opId: Crypto.randomUUID(), action: 'delete', relationship };
      await queueLocalRelationshipOperation(userId, operation);
      if (accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
      const cached = await listLocalRelationships(userId);
      const next = await applyLocalRelationshipOperations(userId, cached);
      if (accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
      setRelationships(next); await saveLocalRelationships(userId, next);
      void synchronizeRelationships(userId);
    }
    catch (error) { Alert.alert('Could not save relationship change', error instanceof Error ? error.message : 'Check device storage and try again.'); }
  }
  async function recordSuggestionFeedback(item: LocalIntention, state: LocalSuggestionFeedback['state']) {
    if (!userId || accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
    const snoozedUntil = state === 'snoozed' ? (() => { const date = new Date(); date.setDate(date.getDate() + 3); return date.toISOString(); })() : null;
    const feedback = { clientId: item.id, state, snoozedUntil, syncState: 'pending' as const };
    try {
      const next = await putLocalSuggestionFeedback(userId, feedback);
      if (!accountDeletionRequested.current && activeUserIdRef.current === userId) setSuggestionFeedback(next);
    }
    catch (error) { Alert.alert('Could not save suggestion feedback', error instanceof Error ? error.message : 'Try again when device storage is available.'); }
  }
  async function deleteAccount() {
    if (!userId) return;
    const owner = userId;
    let externalRevocationWarnings: string[] = [];
    accountDeletionRequested.current = true;
    try {
      await preferenceWriteQueue.current;
      await preferenceSyncQueue.current;
      await captureWriteQueue.current;
      if (activeUserIdRef.current !== owner) return;
      const deletion = await apiRequest<{ externalRevocationWarnings?: string[] }>('/account', { method: 'DELETE' }, owner);
      externalRevocationWarnings = Array.isArray(deletion?.externalRevocationWarnings)
        ? deletion.externalRevocationWarnings.filter((warning): warning is string => typeof warning === 'string') : [];
    }
    catch (error) {
      accountDeletionRequested.current = false;
      Alert.alert('Could not delete account', error instanceof Error ? error.message : 'Try again when connected.');
      void refreshConnections();
      return;
    }
    // Stop any in-flight incremental pull before clearing this account's local database.
    activeUserIdRef.current = null;
    await pullQueueRef.current;
    let localDataCleared = true;
    try { await clearLocal(owner); } catch { localDataCleared = false; }
    try {
      const result = await auth?.auth.signOut({ scope: 'local' });
      if (result?.error) localDataCleared = false;
    } catch { localDataCleared = false; }
    setUserId(null); setSession(false); setItems([]); setRelationships([]); setSuggestionFeedback([]); setSelected(null);
    if (!localDataCleared) externalRevocationWarnings.push('This device could not clear all local account data. Remove Veylo’s local app data from your device settings.');
    if (externalRevocationWarnings.length) Alert.alert('Account deleted', externalRevocationWarnings.join('\n\n'));
  }
  async function exportAccount() {
    try {
      const owner = userId;
      if (!owner || activeUserIdRef.current !== owner) return;
      const [intentions, relationships, relationshipOperations, suggestionFeedback, preferences, pendingPreferences, timeBlockDeletions] = await Promise.all([
        listLocal(owner), listLocalRelationships(owner).catch(() => []), listLocalRelationshipOperations(owner).catch(() => []),
        listLocalSuggestionFeedback(owner).catch(() => []), getLocalPreferences(owner).catch(() => null),
        getPendingLocalPreferences(owner).catch(() => null), listLocalTimeBlockDeletions(owner).catch(() => []),
      ]);
      if (activeUserIdRef.current !== owner) return;
      const deviceCache = { exportedAt: new Date().toISOString(), intentions, relationships, relationshipOperations, suggestionFeedback, preferences, pendingPreferences, timeBlockDeletions };
      let accountData: Record<string, unknown> | null = null;
      try { accountData = await apiRequest<Record<string, unknown>>('/account/export', {}, owner); } catch { /* A clearly labeled device-only export is still useful offline. */ }
      if (activeUserIdRef.current !== owner) return;
      const data = accountData
        ? { ...accountData, exportScope: 'account-and-device', deviceCache }
        : { exportedAt: new Date().toISOString(), exportScope: 'device-only', exportNote: 'The account export could not be reached; this file contains only this device’s saved data.', deviceCache };
      if (!accountData) Alert.alert('Device-only export', 'The account server could not be reached, so this export includes only data saved on this device. Reconnect and export again for your full account history.');
      await Share.share({ title: 'Veylo data export', message: JSON.stringify(data, null, 2) });
    } catch (error) {
      Alert.alert('Could not export your data', error instanceof Error ? error.message : 'Try again when connected.');
    }
  }

  async function save() {
    if (!userId || accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
    const rawCapture = capture; if (!rawCapture.trim()) return;
    Keyboard.dismiss(); setBusy(true); captureDraftRef.current = ''; setCapture('');
    const now = new Date().toISOString(); const id = Crypto.randomUUID();
    const item: LocalIntention = { id, remoteId: null, rawCapture, title: rawCapture.trim().replace(/[.!?]+$/, '').slice(0, 64) || 'A new thought', kind: 'unclassified', intent: null, purpose: null, desiredOutcome: null, roughPlan: null, horizon: null, effortEstimate: null, energyContext: null, version: null, blocks: [], status: 'captured', createdAt: now, updatedAt: now, syncState: 'pending' };
    try {
      if (accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
      await saveLocal(userId, item);
      if (accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
      await reload();
      if (accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
      try {
        const pendingCapture = captureWriteQueue.current.then(async () => {
          if (accountDeletionRequested.current || activeUserIdRef.current !== userId) return false;
          const result = await apiRequest<{ intention: Record<string, any> }>('/captures', { method: 'POST', body: JSON.stringify({ rawCapture, clientId: id }) }, userId);
          const row = result.intention;
          await saveLocal(userId, { ...item, remoteId: row.id, title: row.title, kind: row.kind, version: row.version, aiInterpretation: row.aiInterpretation ?? null, createdAt: row.createdAt, updatedAt: row.updatedAt, syncState: 'synced' });
          if (!accountDeletionRequested.current && activeUserIdRef.current === userId) {
            setSyncLabel('Synced to your space'); await reload();
          }
          return true;
        });
        captureWriteQueue.current = pendingCapture.then(() => undefined, () => undefined);
        await pendingCapture;
      } catch { setSyncLabel('Saved offline · will sync when connected'); }
    } catch (error) { captureDraftRef.current = rawCapture; setCapture(rawCapture); setSyncLabel(error instanceof Error ? error.message : 'Could not save on this device'); }
    finally { setBusy(false); }
  }

  function openDetails(item: LocalIntention) {
    setHistory([]); setHistoryOpen(false); setHistoryMessage('');
    setSelected(item); setEditTitle(item.title); setEditKind(item.kind); setEditIntent(item.intent ?? ''); setEditPurpose(item.purpose ?? ''); setEditOutcome(item.desiredOutcome ?? ''); setEditPlan(item.roughPlan ?? '');
    setEditHorizon(item.horizon ?? ''); setEditEffort(item.effortEstimate == null ? '' : String(item.effortEstimate)); setEditEnergyContext(item.energyContext ?? '');
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); setScheduleDate(dateKey(tomorrow));
  }
  async function toggleHistory() {
    if (historyOpen) { setHistoryOpen(false); return; }
    setHistoryOpen(true);
    if (!userId || !selected?.remoteId) { setHistoryMessage('Sync this thought to view its saved history.'); return; }
    setHistoryBusy(true); setHistoryMessage('');
    try {
      const result = await apiRequest<{ history: IntentionHistoryEntry[] }>(`/intentions/${encodeURIComponent(selected.remoteId)}/history`, {}, userId);
      setHistory(result.history);
    } catch (error) { setHistoryMessage(error instanceof Error ? error.message : 'Could not load history.'); }
    finally { setHistoryBusy(false); }
  }
  async function saveDetails() {
    if (!userId || !selected || accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
    const title = editTitle.trim() || selected.title;
    const effortEstimate = editEffort.trim() ? Number(editEffort) : null;
    if (effortEstimate !== null && (!Number.isInteger(effortEstimate) || effortEstimate < 0 || effortEstimate > 10080)) {
      Alert.alert('Check the effort estimate', 'Enter a whole number from 0 to 10,080 minutes, or leave it blank.'); return;
    }
    const aiInterpretation = selected.aiInterpretation?.canUndo && (title !== selected.title || editKind !== selected.kind || (editHorizon || null) !== selected.horizon)
      ? { ...selected.aiInterpretation, canUndo: false } : selected.aiInterpretation;
    const updated: LocalIntention = { ...selected, title, kind: editKind, aiInterpretation, intent: textOrNull(editIntent), purpose: textOrNull(editPurpose), desiredOutcome: textOrNull(editOutcome), roughPlan: textOrNull(editPlan), horizon: editHorizon || null, effortEstimate, energyContext: textOrNull(editEnergyContext), updatedAt: new Date().toISOString(), syncState: 'pending' };
    await saveLocal(userId, updated); setSelected(updated); await reload(); setCalendarMessage('Saved on this device · syncing');
  }
  async function undoAIInterpretation() {
    if (!userId || !selected?.remoteId || selected.version === null || !selected.aiInterpretation?.canUndo || accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
    try {
      const result = await apiRequest<{ intention: Record<string, any> }>(`/intentions/${encodeURIComponent(selected.remoteId)}/interpretation/undo`, { method: 'POST', body: JSON.stringify({ expectedVersion: selected.version }) }, userId);
      if (accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
      const updated: LocalIntention = { ...selected, title: result.intention.title, kind: result.intention.kind, horizon: result.intention.horizon ?? null, version: result.intention.version, updatedAt: result.intention.updatedAt, aiInterpretation: result.intention.aiInterpretation, syncState: 'synced' };
      await saveLocal(userId, updated); setSelected(updated); await reload(); Alert.alert('AI suggestion undone', 'The earlier title, type, and timing are restored. Your original thought is unchanged.');
    } catch (error) { Alert.alert('Could not undo this suggestion', error instanceof Error ? error.message : 'Reconnect and try again.'); }
  }
  async function setStatus(status: string) {
    if (!userId || !selected || accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
    const updated = { ...selected, status, updatedAt: new Date().toISOString(), syncState: 'pending' as const };
    await saveLocal(userId, updated); setSelected(updated); await reload();
    if (status === 'archived') setSelected(null);
    else if (selected.status === 'archived') setShowArchived(false);
  }
  async function saveSchedule() {
    if (!userId || !selected || accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
    const minutes = Number(scheduleMinutes);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate) || !/^\d{2}:\d{2}$/.test(scheduleTime) || !Number.isFinite(minutes) || minutes < 5 || minutes > 1440) { Alert.alert('Check the time', 'Use a date, a 24-hour time, and a duration from 5 to 1440 minutes.'); return; }
    const start = new Date(`${scheduleDate}T${scheduleTime}:00`); const end = new Date(start.getTime() + minutes * 60000); const blockId = Crypto.randomUUID();
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) { Alert.alert('Check the time', 'Enter a valid local date and 24-hour time.'); return; }
    const localBlock: LocalTimeBlock = { id: blockId, remoteId: null, startsAt: start.toISOString(), endsAt: end.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', externalEventId: null, externalUrl: null, syncState: 'pending' };
    const changedStatus = selected.status !== 'planned';
    const updated: LocalIntention = { ...selected, blocks: [...selected.blocks, localBlock], status: 'planned', updatedAt: new Date().toISOString(), syncState: changedStatus ? 'pending' : selected.syncState };
    await saveLocal(userId, updated); setSelected(updated); await reload(); setCalendarMessage('Time saved · syncing');
    if (updated.remoteId) {
      try {
        const result = await apiRequest<{ timeBlock: Record<string, any> }>(`/intentions/${updated.remoteId}/time-blocks`, { method: 'POST', body: JSON.stringify({ clientId: blockId, startsAt: start.toISOString(), endsAt: end.toISOString(), timezone: localBlock.timezone }) }, userId);
        if (accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
        const synced = { ...updated, blocks: updated.blocks.map((block) => block.id === blockId ? { ...block, remoteId: result.timeBlock.id, syncState: 'synced' as const } : block) };
        await saveLocal(userId, synced); setSelected(synced); await reload(); setCalendarMessage('Time set aside.');
      } catch { /* The local time block remains queued for sync. */ }
    }
  }
  function suggestTimeFor(item: LocalIntention) {
    const checked = calendarConnected && (timePeriod === 'day' || timePeriod === 'week') && calendarCheckIsFresh(busyWindowRange)
      && calendarAvailabilityMatchesRange(busyWindowRange, { start: dateKey(periodStart), end: dateKey(periodEnd) });
    if (!checked) {
      openDetails(item);
      Alert.alert('Choose a time', 'Calendar availability is not current for this view. You can choose a time manually, or check availability first.');
      return;
    }
    const duration = item.effortEstimate && item.effortEstimate > 0 ? Math.max(5, item.effortEstimate) : 30;
    const days = timePeriod === 'day' ? [periodStart] : Array.from({ length: 7 }, (_, index) => shiftDate(periodStart, index));
    const slot = findAvailableSlot({
      days, durationMinutes: duration,
      busyWindows: periodBusyWindows,
      plannedBlocks: timeRows.map(({ block }) => ({ start: block.startsAt, end: block.endsAt })),
    });
    if (!slot) { Alert.alert('No opening found', 'There is no matching opening between 9am and 5pm in this view. You can still choose a time manually.'); return; }
    openDetails(item);
    setScheduleDate(dateKey(slot.startsAt));
    setScheduleTime(`${String(slot.startsAt.getHours()).padStart(2, '0')}:${String(slot.startsAt.getMinutes()).padStart(2, '0')}`);
    setScheduleMinutes(String(duration));
  }
  function planSuggestedTime(item: LocalIntention) {
    const checked = calendarConnected && (timePeriod === 'day' || timePeriod === 'week') && calendarCheckIsFresh(busyWindowRange)
      && calendarAvailabilityMatchesRange(busyWindowRange, { start: dateKey(periodStart), end: dateKey(periodEnd) });
    if (checked) { suggestTimeFor(item); return; }
    openDetails(item);
    Alert.alert('Choose a time', calendarConnected
      ? 'Calendar availability has not been checked for this view. You can choose a time now, or check availability in Time first.'
      : 'You can choose a time now. Connect Google Calendar to get a suggestion based on free time.');
  }
  async function addToCalendar(block: LocalTimeBlock) {
    if (!userId || !selected || accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
    if (!calendarConnected) { await connectCalendar(); return; }
    try {
      let parent = selected;
      if (!parent.remoteId) {
        const result = await apiRequest<{ saved: Array<{ clientId: string; remoteId: string; version: number }>; conflicts: Array<{ clientId: string }> }>('/sync/push', { method: 'POST', body: JSON.stringify({ intentions: [{
          clientId: parent.id, rawCapture: parent.rawCapture, title: parent.title, kind: parent.kind, intent: parent.intent,
          purpose: parent.purpose, desiredOutcome: parent.desiredOutcome, roughPlan: parent.roughPlan, horizon: parent.horizon,
          effortEstimate: parent.effortEstimate, energyContext: parent.energyContext, status: parent.status, expectedVersion: parent.version,
        }] }) }, userId);
        if (accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
        const savedParent = result.saved.find((row) => row.clientId === parent.id);
        if (!savedParent) throw new Error('This intention could not sync. Try again when connected.');
        parent = { ...parent, remoteId: savedParent.remoteId, version: savedParent.version, syncState: 'synced' };
        await saveLocal(userId, parent); setSelected(parent); await reload();
      }
      let remoteId = block.remoteId;
      if (!remoteId) {
        const synced = await apiRequest<{ saved: Array<{ clientId: string; remoteId: string }> }>('/sync/blocks', { method: 'POST', body: JSON.stringify({ blocks: [{ clientId: block.id, intentionClientId: parent.id, startsAt: block.startsAt, endsAt: block.endsAt, timezone: block.timezone, syncState: 'pending' }] }) }, userId);
        if (accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
        remoteId = synced.saved.find((row) => row.clientId === block.id)?.remoteId ?? null;
      }
      if (!remoteId) throw new Error('This time block is still syncing. Try again shortly.');
      const timeBlockId = remoteId;
      Alert.alert('Add to Google Calendar?', `Add “${selected.title}” on ${new Date(block.startsAt).toLocaleString()}?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Add event', onPress: () => void (async () => {
          try {
            const event = await apiRequest<{ externalEventId: string; externalUrl: string | null }>(`/integrations/google/events`, { method: 'POST', body: JSON.stringify({ timeBlockId }) }, userId);
            if (accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
            const updated = { ...parent, blocks: parent.blocks.map((item) => item.id === block.id ? { ...item, remoteId: timeBlockId, externalEventId: event.externalEventId, externalUrl: event.externalUrl, syncState: 'synced' as const } : item) };
            await saveLocal(userId, updated); setSelected(updated); await reload();
          } catch (error) { Alert.alert('Calendar event was not added', error instanceof Error ? error.message : 'Try again when connected.'); }
        })() },
      ]);
    } catch (error) { Alert.alert('Calendar event was not added', error instanceof Error ? error.message : 'Try again when connected.'); }
  }
  async function removeTime(block: LocalTimeBlock) {
    if (!userId || !selected || accountDeletionRequested.current || activeUserIdRef.current !== userId) return;
    const remove = async () => {
      try {
        const blocks = selected.blocks.filter((item) => item.id !== block.id);
        const status = selected.status === 'planned' && blocks.length === 0 ? 'ready' : selected.status;
        const updated = { ...selected, blocks, status, updatedAt: status === selected.status ? selected.updatedAt : new Date().toISOString(), syncState: status === selected.status ? selected.syncState : 'pending' as const };
        await queueLocalTimeBlockDeletion(userId, updated, block);
        setTimeBlockDeletionRevision((value) => value + 1);
        setSelected(updated); await reload(); setSyncLabel('Time removed · syncing');
        if (block.externalEventId) Alert.alert('Time removed from Veylo', 'The separate Google Calendar event remains in Google Calendar.');
      } catch (error) { Alert.alert('Could not remove this time', error instanceof Error ? error.message : 'Try again when connected.'); }
    };
    if (block.externalEventId) Alert.alert('Remove planned time?', 'This removes the time from Veylo. Its Google Calendar event will remain.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => void remove() }]);
    else await remove();
  }

  if (session === null) return <SafeAreaView style={styles.center}><ActivityIndicator color={palette.green} /></SafeAreaView>;
  if (!session) return <SignIn />;
  const activeItems = items.filter((item) => showArchived ? item.status === 'archived' : item.status !== 'archived');
  const exploreItems = activeItems.filter((item) => !searchText.trim() || `${item.title} ${item.rawCapture} ${item.purpose ?? ''}`.toLowerCase().includes(searchText.trim().toLowerCase()));
  const timeRows = activeItems.flatMap((item) => item.blocks.map((block) => ({ type: 'time' as const, key: `${item.id}:${block.id}`, item, block })))
    .sort((a, b) => a.block.startsAt.localeCompare(b.block.startsAt));
  const periodStart = timePeriod === 'day'
    ? new Date(timeDate.getFullYear(), timeDate.getMonth(), timeDate.getDate())
    : timePeriod === 'week'
      ? new Date(timeDate.getFullYear(), timeDate.getMonth(), timeDate.getDate() - timeDate.getDay())
      : new Date(timeDate.getFullYear(), timeDate.getMonth(), 1);
  const periodEnd = timePeriod === 'day' ? shiftDate(periodStart, 1)
    : timePeriod === 'week' ? shiftDate(periodStart, 7)
      : timePeriod === 'month' ? new Date(timeDate.getFullYear(), timeDate.getMonth() + 1, 1)
        : new Date(timeDate.getFullYear() + 1, 0, 1);
  const periodRows = timeRows.filter(({ block }) => {
    const startsAt = new Date(block.startsAt);
    return startsAt >= periodStart && startsAt < periodEnd;
  });
  const availabilityIsCurrent = (timePeriod === 'day' || timePeriod === 'week')
    && calendarCheckIsFresh(busyWindowRange)
    && calendarAvailabilityMatchesRange(busyWindowRange, { start: dateKey(periodStart), end: dateKey(periodEnd) });
  const periodBusyWindows = availabilityIsCurrent ? busyWindows : [];
  const monthStart = new Date(timeDate.getFullYear(), timeDate.getMonth(), 1);
  const monthGridStart = new Date(timeDate.getFullYear(), timeDate.getMonth(), 1 - monthStart.getDay());
  const monthDays = Array.from({ length: 42 }, (_, index) => shiftDate(monthGridStart, index));
  const yearMonthCounts = Array.from({ length: 12 }, (_, month) => timeRows.filter(({ block }) => {
    const date = new Date(block.startsAt);
    return date.getFullYear() === timeDate.getFullYear() && date.getMonth() === month;
  }).length);
  const periodTitle = timePeriod === 'day' ? timeDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : timePeriod === 'week' ? `${periodStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${shiftDate(periodStart, 6).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
      : timePeriod === 'month' ? timeDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : String(timeDate.getFullYear());
  function moveTimePeriod(amount: number) {
    setTimeDate((current) => timePeriod === 'day' ? shiftDate(current, amount)
      : timePeriod === 'week' ? shiftDate(current, amount * 7)
        : timePeriod === 'month' ? new Date(current.getFullYear(), current.getMonth() + amount, 1)
          : new Date(current.getFullYear() + amount, 0, 1));
  }
  const rows: PerspectiveRow[] = perspective === 'space'
    ? activeItems.slice(0, 6).map((item) => ({ type: 'intention', key: item.id, item }))
    : perspective === 'explore'
      ? exploreItems.map((item) => ({ type: 'intention', key: item.id, item }))
      : perspective === 'align'
        ? relationships.map((relationship) => ({ type: 'relationship', key: relationship.id, relationship }))
        : perspective === 'time' ? periodRows : [];
  const suggestions = !showArchived && suggestionsEnabled
    ? rankIntentionSuggestions(activeItems, suggestionFeedback, { now: new Date(), limit: suggestionLimit })
    : [];
  const perspectiveCopy: Record<Perspective, { title: string; description: string }> = {
    space: { title: 'A little room to think.', description: 'Catch what’s on your mind. Shape it later.' },
    explore: { title: 'Explore your thoughts.', description: 'Search and revisit what you have saved.' },
    align: { title: 'See what connects.', description: 'Follow the links between your intentions.' },
    time: { title: 'Make a little room.', description: 'See the time you have set aside, and plan another session.' },
    suggestions: { title: 'A thought to return to.', description: 'A few possibilities based on what you’ve saved. Always your call.' },
    connections: { title: 'Your space, your rules.', description: 'Choose what Veylo can connect to and how it behaves.' },
  };
  const emptyMessage = perspective === 'space' ? 'Your space is open. Save a thought when you’re ready.'
    : perspective === 'explore' ? (showArchived ? 'Nothing archived. Thoughts you archive will stay here until you restore them.' : 'No thoughts match your search.')
      : perspective === 'align' ? 'No connections yet. Connect intentions from an intention’s detail view.'
        : perspective === 'time' ? 'No planned time in this view. Open an intention to set aside a session.'
          : perspective === 'suggestions' && suggestions.length === 0 ? 'No suggestions for now. Your space can be quiet.' : '';
  return <SafeAreaView style={styles.screen}>
    <View style={styles.header}><Text accessibilityRole="header" style={styles.brand}>✳ veylo</Text><Text accessibilityLiveRegion="polite" style={styles.sync}>{syncLabel}</Text><Pressable accessibilityRole="button" accessibilityLabel="Sign out of Veylo" onPress={() => void auth?.auth.signOut()}><Text style={styles.connectionButtonText}>Sign out</Text></Pressable></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chipRow, { paddingBottom: 16 }]} accessibilityRole="tablist" accessibilityLabel="Veylo perspectives">{(['space', 'explore', 'align', 'time', 'suggestions', 'connections'] as const).map((view) => <Pressable key={view} accessibilityRole="tab" accessibilityState={{ selected: perspective === view }} onPress={() => { setPerspective(view); if (view !== 'explore') setShowArchived(false); }} style={[styles.chip, perspective === view && styles.chipSelected]}><Text style={[styles.chipText, perspective === view && styles.chipTextSelected]}>{view === 'space' ? 'Space' : view[0]!.toUpperCase() + view.slice(1)}</Text></Pressable>)}</ScrollView>
    <FlatList accessibilityLabel={`${perspectiveCopy[perspective].title} list`} data={rows} keyExtractor={(row) => row.key} contentContainerStyle={{ paddingBottom: 40 }} ListHeaderComponent={<View>
      <View style={styles.intro}><Text style={styles.eyebrow}>{perspective.toUpperCase()} · {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}</Text><Text accessibilityRole="header" style={styles.hero}>{perspectiveCopy[perspective].title}</Text><Text style={styles.muted}>{perspectiveCopy[perspective].description}</Text></View>
      {perspective === 'time' ? <View>
        <View style={styles.timePeriodRow} accessibilityRole="tablist" accessibilityLabel="Time overview period">{(['day', 'week', 'month', 'year'] as const).map((period) => <Pressable key={period} accessibilityRole="tab" accessibilityState={{ selected: timePeriod === period }} onPress={() => setTimePeriod(period)} style={[styles.chip, timePeriod === period && styles.chipSelected]}><Text style={[styles.chipText, timePeriod === period && styles.chipTextSelected]}>{period[0]!.toUpperCase() + period.slice(1)}</Text></Pressable>)}</View>
        <View style={styles.timeNav}><Pressable accessibilityRole="button" accessibilityLabel={`Previous ${timePeriod}`} onPress={() => moveTimePeriod(-1)} style={styles.timeArrow}><Text style={styles.timeArrowText}>‹</Text></Pressable><Text accessibilityRole="header" style={styles.sectionTitle}>{periodTitle}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Next ${timePeriod}`} onPress={() => moveTimePeriod(1)} style={styles.timeArrow}><Text style={styles.timeArrowText}>›</Text></Pressable></View>
        {(timePeriod === 'day' || timePeriod === 'week') && calendarConnected ? <View style={styles.connectionCard}><View style={{ flex: 1 }}><Text style={styles.muted}>{availabilityIsCurrent ? `${periodBusyWindows.length} busy window${periodBusyWindows.length === 1 ? '' : 's'} in this ${timePeriod}. Event titles are not read.` : `Calendar availability has not been checked for this ${timePeriod}.`}</Text>{periodBusyWindows.slice(0, 4).map((window) => <Text key={window.start} style={styles.cardBody}>{new Date(window.start).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}–{new Date(window.end).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</Text>)}</View><Button label={calendarBusy ? 'Checking…' : 'Check availability'} onPress={() => void refreshCalendarAvailability({ start: periodStart, end: periodEnd })} disabled={calendarBusy} secondary /></View> : null}
        {availabilityIsCurrent && activeItems.some((item) => item.status !== 'completed' && item.status !== 'archived' && item.blocks.length === 0) ? <View style={styles.card}><Text style={styles.cardTitle}>A possible next session</Text><Text style={styles.muted}>Suggestions look between 9am and 5pm, using calendar free/busy and sessions already planned. Review the time before saving.</Text>{activeItems.filter((item) => item.status !== 'completed' && item.status !== 'archived' && item.blocks.length === 0).slice(0, 3).map((item) => <View key={`slot-${item.id}`} style={[styles.row, { alignItems: 'center' }]}><Text style={[styles.cardBody, { flex: 1, marginTop: 0 }]} numberOfLines={2}>{item.title}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Suggest a time for ${item.title}`} onPress={() => suggestTimeFor(item)}><Text style={styles.connectionButtonText}>Find a time</Text></Pressable></View>)}</View> : null}
        {timePeriod === 'week' ? <View style={styles.timeWeekRow}>{Array.from({ length: 7 }, (_, index) => shiftDate(periodStart, index)).map((date) => { const key = dateKey(date); const count = timeRows.filter(({ block }) => dateKey(new Date(block.startsAt)) === key).length; return <Pressable key={key} accessibilityRole="button" accessibilityLabel={`${date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}, ${count} planned`} onPress={() => { setTimeDate(date); setTimePeriod('day'); }} style={[styles.timeWeekDay, key === dateKey(new Date()) && styles.timeToday]}><Text style={styles.timeDayName}>{date.toLocaleDateString(undefined, { weekday: 'short' })}</Text><Text style={styles.timeDayNumber}>{date.getDate()}</Text><Text style={styles.timeDayCount}>{count || '·'}</Text></Pressable>; })}</View> : null}
        {timePeriod === 'month' ? <View style={styles.timeMonthOverview}><View style={styles.timeWeekRow}>{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <Text key={`${day}-${index}`} style={styles.timeWeekLabel}>{day}</Text>)}</View><View style={styles.timeMonthGrid}>{monthDays.map((date) => { const key = dateKey(date); const count = timeRows.filter(({ block }) => dateKey(new Date(block.startsAt)) === key).length; const inMonth = date.getMonth() === timeDate.getMonth(); return <Pressable key={key} accessibilityRole="button" accessibilityLabel={`${date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}, ${count} planned`} onPress={() => { setTimeDate(date); setTimePeriod('day'); }} style={[styles.timeMonthDay, !inMonth && styles.timeOutsideMonth, key === dateKey(new Date()) && styles.timeToday]}><Text style={styles.timeDayNumber}>{date.getDate()}</Text>{count ? <Text style={styles.timeDayCount}>{count}</Text> : null}</Pressable>; })}</View></View> : null}
        {timePeriod === 'year' ? <View style={styles.timeYearGrid}>{yearMonthCounts.map((count, month) => <Pressable key={month} accessibilityRole="button" accessibilityLabel={`${new Date(timeDate.getFullYear(), month, 1).toLocaleDateString(undefined, { month: 'long' })}, ${count} planned`} onPress={() => { setTimeDate(new Date(timeDate.getFullYear(), month, 1)); setTimePeriod('month'); }} style={styles.timeYearMonth}><Text style={styles.timeYearName}>{new Date(timeDate.getFullYear(), month, 1).toLocaleDateString(undefined, { month: 'short' })}</Text><Text style={styles.timeDayCount}>{count} planned</Text></Pressable>)}</View> : null}
        <View style={styles.sectionHead}><Text accessibilityRole="header" style={styles.sectionTitle}>Planned sessions</Text><Text style={styles.muted}>{periodRows.length ? `${periodRows.length} block${periodRows.length === 1 ? '' : 's'} in this view` : 'No blocks in this view yet.'} · Times shown in your local timezone.</Text></View>
      </View> : null}
      {perspective === 'space' ? <View style={styles.captureCard}><TextInput accessibilityLabel="Capture a thought" style={styles.captureInput} multiline maxLength={rawCaptureMaxLength} value={capture} onChangeText={(value) => { captureDraftRef.current = value; setCapture(value); }} placeholder="A thought, a question, a maybe…" placeholderTextColor="#9c9d91" /><Button label={voiceRecording ? 'Stop speaking' : 'Speak a thought'} onPress={toggleVoiceCapture} secondary /><Text accessibilityRole="text" style={styles.muted}>Your device transcribes speech; Veylo saves only the words. One thought can contain up to {rawCaptureMaxLength.toLocaleString()} characters.</Text>{capture.length > rawCaptureMaxLength - 500 ? <Text accessibilityRole="text" style={[styles.muted, { textAlign: 'right' }]}>{capture.length.toLocaleString()} / {rawCaptureMaxLength.toLocaleString()}</Text> : null}<Button label={busy ? 'Saving thought' : 'Keep this thought'} onPress={() => void save()} disabled={busy || !capture.trim()} /></View> : null}
      {perspective === 'explore' ? <View style={styles.connectionCard}><TextInput accessibilityLabel="Search your intentions" style={[styles.input, { flex: 1 }]} value={searchText} onChangeText={setSearchText} placeholder="Search your thoughts" /><Pressable accessibilityRole="button" onPress={() => setShowArchived((value) => !value)}><Text style={styles.connectionButtonText}>{showArchived ? 'Back to space' : 'Show archived'}</Text></Pressable></View> : null}
      {perspective === 'space' || perspective === 'explore' ? <View style={styles.sectionHead}><Text accessibilityRole="header" style={styles.sectionTitle}>{showArchived ? 'Archived thoughts' : perspective === 'space' ? 'Still with you' : 'Your thoughts'}</Text><Text style={styles.muted}>{showArchived ? 'Tap a thought to restore it or review it.' : 'Tap a thought to shape or plan it.'}</Text></View> : null}
      {perspective === 'align' ? <View style={styles.sectionHead}><Text accessibilityRole="header" style={styles.sectionTitle}>Connected intentions</Text><Text style={styles.muted}>Open a link to shape either intention. Add or remove links from its detail view.</Text></View> : null}
      {perspective === 'suggestions' ? (suggestions.length ? <View><View style={styles.sectionHead}><Text accessibilityRole="header" style={styles.sectionTitle}>A thought to return to</Text><Text style={styles.muted}>Suggestions use your timeframe, purpose, attention, and effort estimate.</Text></View>{suggestions.map(({ item, rationale }) => <View style={styles.card} key={`suggestion-${item.id}`}><Text accessibilityRole="header" style={styles.cardTitle}>{item.title}</Text><Text style={styles.cardBody}>{item.rawCapture}</Text><Text style={[styles.muted, { marginTop: 8 }]}>{rationale}</Text><View style={[styles.chipRow, { marginTop: 12 }]}><Pressable accessibilityRole="button" accessibilityLabel={`Keep ${item.title} in focus`} onPress={() => { void recordSuggestionFeedback(item, 'accepted'); openDetails(item); }}><Text style={styles.connectionButtonText}>Keep in focus</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Find a time for ${item.title}`} onPress={() => planSuggestedTime(item)}><Text style={styles.connectionButtonText}>Find a time</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Remind me about ${item.title} in three days`} onPress={() => void recordSuggestionFeedback(item, 'snoozed')}><Text style={styles.connectionButtonText}>Later</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Dismiss suggestion for ${item.title}`} onPress={() => void recordSuggestionFeedback(item, 'dismissed')}><Text style={[styles.connectionButtonText, { color: palette.red }]}>Dismiss</Text></Pressable></View></View>)}</View> : null) : null}
      {perspective === 'connections' ? <View>
        <View style={styles.connectionCard}><View style={{ flex: 1 }}><Text accessibilityRole="header" style={styles.sectionTitle}>Google Calendar</Text><Text style={styles.muted}>{calendarConnected ? 'Connected · availability stays private' : 'Connect to check availability and add approved plans'}</Text></View><Pressable accessibilityRole="button" onPress={() => void (calendarConnected ? disconnectCalendar() : connectCalendar())} style={styles.connectionButton}><Text style={styles.connectionButtonText}>{calendarConnected ? 'Disconnect' : 'Connect'}</Text></Pressable>{calendarMessage ? <Text style={[styles.muted, { width: '100%' }]}>{calendarMessage}</Text> : null}</View>
        {calendarConnected ? <Button label={calendarBusy ? 'Checking…' : 'Check this week’s availability'} onPress={() => void refreshCalendarAvailability()} disabled={calendarBusy} /> : null}
        <View style={styles.connectionCard}><View style={{ flex: 1 }}><Text accessibilityRole="header" style={styles.sectionTitle}>Jira Cloud</Text><Text style={styles.muted}>{jiraConnected ? 'Read-only assigned issues · Jira keeps ownership' : 'Connect to see your assigned issues'}</Text></View><Pressable accessibilityRole="button" onPress={() => void (jiraConnected ? disconnectJira() : connectJira())} style={styles.connectionButton}><Text style={styles.connectionButtonText}>{jiraConnected ? 'Disconnect' : 'Connect'}</Text></Pressable>{jiraMessage ? <Text accessibilityLiveRegion="polite" style={[styles.muted, { width: '100%' }]}>{jiraMessage}</Text> : null}</View>
        {jiraConnected ? <Button label={jiraBusy ? 'Refreshing…' : 'Refresh assigned issues'} onPress={() => void refreshJiraIssues()} disabled={jiraBusy} secondary /> : null}
        {jiraIssues.map((issue) => <Pressable key={issue.id} accessibilityRole={issue.url ? 'link' : 'text'} accessibilityLabel={issue.url ? `Open Jira issue ${issue.key}: ${issue.summary}` : `Jira issue ${issue.key}: ${issue.summary}; link unavailable`} onPress={() => { if (issue.url) void Linking.openURL(issue.url); }} style={styles.blockCard}><Text style={styles.eyebrow}>{issue.key} · {issue.project}</Text><Text style={styles.cardTitle}>{issue.summary}</Text><Text style={styles.cardBody}>{issue.status}{issue.dueDate ? ` · Due ${issue.dueDate}` : ''} {issue.url ? '· Open in Jira ↗' : '· Link unavailable'}</Text></Pressable>)}
        <View style={styles.connectionCard}><View style={{ flex: 1 }}><Text accessibilityRole="header" style={styles.sectionTitle}>Notion</Text><Text style={styles.muted}>{notionConnected ? `Selected page and database references · ${notionWorkspace || 'workspace linked'}` : 'Choose which pages and databases Veylo can reference'}</Text></View><Pressable accessibilityRole="button" onPress={() => void (notionConnected ? disconnectNotion() : connectNotion())} style={styles.connectionButton}><Text style={styles.connectionButtonText}>{notionConnected ? 'Disconnect' : 'Connect'}</Text></Pressable>{notionMessage ? <Text accessibilityLiveRegion="polite" style={[styles.muted, { width: '100%' }]}>{notionMessage}</Text> : null}</View>
        {notionConnected ? <Button label={notionBusy ? 'Refreshing…' : 'Refresh selected pages & databases'} onPress={() => void refreshNotionPages()} disabled={notionBusy} secondary /> : null}
        {notionHasMore ? <Button label={notionBusy ? 'Loading…' : 'Load more references'} onPress={() => void loadMoreNotionPages()} disabled={notionBusy} secondary /> : null}
        {notionPages.map((page) => <Pressable key={page.id} accessibilityRole="link" accessibilityLabel={`Open Notion ${page.kind} ${page.title}`} onPress={() => void Linking.openURL(page.url)} style={styles.blockCard}><Text style={styles.cardTitle}>{page.title}</Text><Text style={styles.cardBody}>{page.kind === 'database' ? 'Database' : 'Page'}{page.lastEditedAt ? ` · Edited ${new Date(page.lastEditedAt).toLocaleDateString()}` : ''} · Open in Notion ↗</Text></Pressable>)}
        <View style={styles.connectionCard}><View style={{ flex: 1 }}><Text style={styles.sectionTitle}>AI-assisted features</Text><Text style={styles.muted}>For interpretation, relevant text goes to Laya for preliminary category and timeframe signals, then to OpenAI for the final decision. Brainstorming sends the thought and conversation to OpenAI.</Text></View><Switch accessibilityLabel="AI-assisted features" value={aiEnabled} onValueChange={(value) => void setAI(value)} trackColor={{ true: palette.green }} /></View>
        <View style={styles.connectionCard}><View style={{ flex: 1 }}><Text style={styles.sectionTitle}>Reduced motion</Text><Text style={styles.muted}>Use still transitions when opening a thought.</Text></View><Switch accessibilityLabel="Reduced motion" value={reduceMotion} onValueChange={(value) => void setReducedMotion(value)} trackColor={{ true: palette.green }} /></View>
        <View style={styles.connectionCard}><View style={{ flex: 1 }}><Text style={styles.sectionTitle}>Suggestions</Text><Text style={styles.muted}>Show gentle ideas in your suggestion tray.</Text></View><Switch accessibilityLabel="Suggestions" value={suggestionsEnabled} onValueChange={(value) => void setSuggestionPreferences({ enabled: value })} trackColor={{ true: palette.green }} /><View accessibilityRole="radiogroup" accessibilityLabel="Maximum suggestions" style={styles.chipRow}>{[0, 1, 2].map((limit) => <Pressable accessibilityRole="radio" accessibilityState={{ selected: suggestionLimit === limit }} key={limit} onPress={() => void setSuggestionPreferences({ limit })} style={[styles.chip, suggestionLimit === limit && styles.chipSelected]}><Text style={[styles.chipText, suggestionLimit === limit && styles.chipTextSelected]}>{limit === 0 ? 'Off' : `${limit} max`}</Text></Pressable>)}</View></View>
        <View style={styles.connectionCard}><View style={{ flex: 1 }}><Text style={styles.sectionTitle}>Quiet hours</Text><Text style={styles.muted}>{quietHoursEnabled ? 'Snooze reminders pause from 10pm to 8am local time.' : 'Let reminders wait until morning, from 10pm to 8am local time.'}</Text>{quietHoursMessage ? <Text accessibilityLiveRegion="polite" style={styles.muted}>{quietHoursMessage}</Text> : null}</View><Switch accessibilityLabel="Quiet hours" value={quietHoursEnabled} onValueChange={(value) => void setQuietHours(value)} trackColor={{ true: palette.green }} /></View>
        <View style={styles.connectionCard}><View style={{ flex: 1 }}><Text style={styles.sectionTitle}>Snooze reminders</Text><Text style={styles.muted}>A single reminder when a thought you set aside is ready to revisit. No daily digest.</Text></View><Switch accessibilityLabel="Snooze reminders" value={notificationsEnabled} onValueChange={(value) => void setNotifications(value)} trackColor={{ true: palette.green }} />{notificationMessage ? <Text accessibilityLiveRegion="polite" style={[styles.muted, { width: '100%' }]}>{notificationMessage}</Text> : null}</View>
        <Text style={[styles.muted, { lineHeight: 20 }]}>Signed-in crash reports include only platform, error category, and a one-way fingerprint.</Text>
        <Button label="Export my Veylo data" onPress={() => void exportAccount()} secondary />
        <Pressable accessibilityRole="button" onPress={() => Alert.alert('Delete account and data?', 'This permanently deletes your Veylo account and all synced intentions. If you connected Jira, Atlassian may require you to remove Veylo from Connected Apps afterward.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete account', style: 'destructive', onPress: () => void deleteAccount() }])}><Text style={[styles.muted, { textAlign: 'center', marginVertical: 8 }]}>Delete account and data</Text></Pressable>
      </View> : null}
    </View>} ListEmptyComponent={emptyMessage ? <View style={styles.empty}><Text style={styles.muted}>{emptyMessage}</Text></View> : null} renderItem={({ item: row }) => {
      if (row.type === 'intention') {
        const { item } = row;
        return <Pressable accessibilityRole="button" accessibilityLabel={`Open thought: ${item.title}. ${item.kind}. ${item.status}. ${item.rawCapture}`} onPress={() => openDetails(item)} style={styles.card}><Text style={styles.kind}>✳ {item.kind.toUpperCase()} · {item.status.toUpperCase()}</Text><Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.cardBody}>{item.rawCapture}</Text><Text style={styles.cardFoot}>{item.syncState === 'synced' ? 'Synced' : 'Waiting to sync'} · {new Date(item.createdAt).toLocaleDateString()}{item.blocks.length ? ` · ${item.blocks.length} planned time${item.blocks.length === 1 ? '' : 's'}` : ''}</Text></Pressable>;
      }
      if (row.type === 'relationship') {
        const { relationship } = row;
        const from = items.find((item) => item.id === relationship.fromClientId);
        const to = items.find((item) => item.id === relationship.toClientId);
        return <View style={styles.card}><Text style={styles.kind}>CONNECTED THOUGHTS</Text><Text style={styles.cardTitle}>{relationship.fromTitle} {relationship.relation.replace('_', ' ')} {relationship.toTitle}</Text><View style={[styles.chipRow, { marginTop: 12 }]}>{from ? <Pressable accessibilityRole="button" onPress={() => openDetails(from)}><Text style={styles.connectionButtonText}>Open first thought</Text></Pressable> : null}{to ? <Pressable accessibilityRole="button" onPress={() => openDetails(to)}><Text style={styles.connectionButtonText}>Open connected thought</Text></Pressable> : null}<Pressable accessibilityRole="button" onPress={() => void deleteRelationship(relationship.id)}><Text style={[styles.connectionButtonText, { color: palette.red }]}>Remove link</Text></Pressable></View></View>;
      }
      return <Pressable accessibilityRole="button" accessibilityLabel={`Open planned session for ${row.item.title} at ${new Date(row.block.startsAt).toLocaleString()}`} onPress={() => openDetails(row.item)} style={styles.card}><Text style={styles.kind}>PLANNED SESSION</Text><Text style={styles.cardTitle}>{row.item.title}</Text><Text style={styles.cardBody}>{new Date(row.block.startsAt).toLocaleString()} · {Math.max(1, Math.round((Date.parse(row.block.endsAt) - Date.parse(row.block.startsAt)) / 60000))} minutes</Text><Text style={styles.cardFoot}>{row.block.externalEventId ? 'Added to Google Calendar' : 'Veylo only'} · Tap to edit</Text></Pressable>;
    }} />
    <Modal visible={onboardingOpen} transparent animationType={reduceMotion || systemReduceMotion ? 'none' : 'fade'} onRequestClose={() => void finishOnboarding()}>
      <SafeAreaView style={styles.onboardingScrim}><ScrollView contentContainerStyle={styles.onboardingWrap}>
        <View accessibilityViewIsModal style={styles.onboardingCard}>
          <Text style={styles.eyebrow}>WELCOME TO VEYLO</Text>
          <Text accessibilityRole="header" style={styles.hero}>Your thoughts stay yours.</Text>
          <Text style={styles.muted}>Capture saves on this device first, then syncs to your account when you’re online. Your original words stay with each thought.</Text>
          <View style={styles.privacyNote}><Text style={styles.privacyMark}>⌑</Text><Text style={[styles.muted, { flex: 1 }]}>AI suggestions and brainstorming are optional. When enabled, thought interpretation sends relevant text to Laya for preliminary category and timeframe signals, then to OpenAI for the final decision. Brainstorming sends the thought and conversation to OpenAI. Connections to Google Calendar, Jira, or Notion are optional. Calendar events are only created when you ask. If you’re signed in and online when a screen crashes, Veylo can send a report with the platform, error category, and one-way fingerprint; it excludes error text, stack details, and your saved thoughts. You can export or delete your data in Settings.</Text></View>
          <Button label="Start with a thought" onPress={() => void finishOnboarding()} />
          <Button label="Review privacy settings" onPress={() => void finishOnboarding(true)} secondary />
        </View>
      </ScrollView></SafeAreaView>
    </Modal>
    <Modal visible={Boolean(selected)} animationType={reduceMotion || systemReduceMotion ? 'none' : 'slide'} onRequestClose={() => setSelected(null)}>
      <SafeAreaView accessibilityViewIsModal style={styles.modalScreen}><ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
        <View style={styles.modalHeader}><Text accessibilityRole="header" style={styles.sectionTitle}>Shape this thought</Text><Pressable accessibilityRole="button" onPress={() => setSelected(null)}><Text style={styles.connectionButtonText}>Done</Text></Pressable></View>
        <Text style={styles.kind}>ORIGINAL THOUGHT</Text><Text style={styles.cardBody}>{selected?.rawCapture}</Text><Button label={historyOpen ? 'Hide change history' : 'View change history'} onPress={() => void toggleHistory()} secondary />{historyOpen ? <View style={styles.historyPanel}>{historyBusy ? <Text style={styles.muted}>Loading history…</Text> : historyMessage ? <Text style={styles.muted}>{historyMessage}</Text> : history.length ? history.map((entry) => <View key={entry.id} style={styles.historyEntry}><Text style={styles.cardTitle}>{entry.action.replace('_', ' ')}</Text><Text style={styles.muted}>Version {entry.version} · {new Date(entry.createdAt).toLocaleString()}</Text><Text style={styles.muted}>{entry.changedFields.join(', ') || 'No intention fields changed'}</Text></View>) : <Text style={styles.muted}>No saved history yet.</Text>}<Text style={styles.muted}>History records dates and changed field names, not earlier text or values.</Text></View> : null}
        {selected?.aiInterpretation ? <View style={styles.aiNote}><Text style={styles.muted}>AI suggested this title, type, and timing{selected.aiInterpretation.rationale ? `: ${selected.aiInterpretation.rationale}` : '.'}</Text>{selected.aiInterpretation.canUndo ? <Button label="Undo AI suggestion" onPress={() => void undoAIInterpretation()} secondary /> : selected.aiInterpretation.undoneAt ? <Text style={styles.cardFoot}>AI suggestion undone · original capture preserved</Text> : null}</View> : null}
        <BrainstormConversation ownerId={userId} intentionId={selected?.remoteId ?? null} enabled={aiEnabled} archived={selected?.status === 'archived'} />
        <Text accessibilityRole="text" style={styles.fieldLabel}>Title</Text><TextInput accessibilityLabel="Intention title" style={styles.input} value={editTitle} onChangeText={setEditTitle} maxLength={160} />
        <Text accessibilityRole="text" style={styles.fieldLabel}>Type</Text><View accessibilityRole="radiogroup" accessibilityLabel="Intention type" style={styles.chipRow}>{kinds.map((kind) => <Pressable accessibilityRole="radio" accessibilityState={{ selected: editKind === kind }} key={kind} onPress={() => setEditKind(kind)} style={[styles.chip, editKind === kind && styles.chipSelected]}><Text style={[styles.chipText, editKind === kind && styles.chipTextSelected]}>{kind}</Text></Pressable>)}</View>
        <Text style={styles.fieldLabel}>What do you want to do?</Text><TextInput accessibilityLabel="What do you want to do?" style={[styles.input, styles.multiline]} value={editIntent} onChangeText={setEditIntent} multiline />
        <Text style={styles.fieldLabel}>Why does it matter?</Text><TextInput accessibilityLabel="Why does it matter?" style={[styles.input, styles.multiline]} value={editPurpose} onChangeText={setEditPurpose} multiline />
        <Text style={styles.fieldLabel}>What would a good outcome look like?</Text><TextInput accessibilityLabel="What would a good outcome look like?" style={[styles.input, styles.multiline]} value={editOutcome} onChangeText={setEditOutcome} multiline />
        <Text style={styles.fieldLabel}>Rough plan</Text><TextInput accessibilityLabel="Rough plan" style={[styles.input, styles.multiline]} value={editPlan} onChangeText={setEditPlan} multiline />
        <Text style={styles.fieldLabel}>When might this fit?</Text><View accessibilityRole="radiogroup" accessibilityLabel="Intention time horizon" style={styles.chipRow}>{[{ value: '', label: 'Not decided' }, { value: 'today', label: 'Today' }, { value: 'week', label: 'This week' }, { value: 'month', label: 'This month' }, { value: 'someday', label: 'Someday' }, { value: 'custom', label: 'Another time' }].map((option) => <Pressable accessibilityRole="radio" accessibilityState={{ selected: editHorizon === option.value }} key={option.label} onPress={() => setEditHorizon(option.value)} style={[styles.chip, editHorizon === option.value && styles.chipSelected]}><Text style={[styles.chipText, editHorizon === option.value && styles.chipTextSelected]}>{option.label}</Text></Pressable>)}</View>
        <Text style={styles.fieldLabel}>Estimated effort (minutes)</Text><TextInput accessibilityLabel="Estimated effort in minutes" style={styles.input} keyboardType="number-pad" value={editEffort} onChangeText={setEditEffort} maxLength={5} placeholder="Optional" />
        <Text style={styles.fieldLabel}>Energy or focus context</Text><TextInput accessibilityLabel="Energy or focus context" style={styles.input} value={editEnergyContext} onChangeText={setEditEnergyContext} maxLength={120} placeholder="For example, focused or collaborative" />
        <Text style={styles.fieldLabel}>Connected thoughts</Text>
        {selected && relationships.filter((link) => link.fromClientId === selected.id || link.toClientId === selected.id).map((link) => <View key={link.id} style={styles.blockCard}><Text style={styles.cardBody}>{link.fromTitle} {link.relation.replace('_', ' ')} {link.toTitle}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Remove link between ${link.fromTitle} and ${link.toTitle}`} onPress={() => void deleteRelationship(link.id)}><Text style={[styles.muted, { paddingTop: 8 }]}>Remove link</Text></Pressable></View>)}
        <View accessibilityRole="radiogroup" accessibilityLabel="Relationship type" style={styles.chipRow}>{(['supports', 'related', 'depends_on'] as const).map((value) => <Pressable accessibilityRole="radio" accessibilityState={{ selected: relationshipType === value }} key={value} onPress={() => setRelationshipType(value)} style={[styles.chip, relationshipType === value && styles.chipSelected]}><Text style={[styles.chipText, relationshipType === value && styles.chipTextSelected]}>{value.replace('_', ' ')}</Text></Pressable>)}</View>
        {selected ? items.filter((item) => item.id !== selected.id && item.status !== 'archived').map((target) => <Pressable accessibilityRole="button" accessibilityLabel={`Connect to ${target.title}`} key={target.id} onPress={() => void createRelationship(target)} style={{ paddingVertical: 10 }}><Text style={styles.connectionButtonText}>＋ Connect · {target.title}</Text></Pressable>) : <Text style={styles.muted}>Choose another thought to connect it.</Text>}
        <Button label="Save changes" onPress={() => void saveDetails()} />
        <Text style={styles.sectionTitle}>Set aside time</Text><Text style={styles.muted}>Times use your device’s local timezone.</Text>
        <View style={styles.row}><TextInput accessibilityLabel="Planned date, year month day" style={[styles.input, styles.rowInput]} value={scheduleDate} onChangeText={setScheduleDate} placeholder="YYYY-MM-DD" /><TextInput accessibilityLabel="Planned start time" style={[styles.input, styles.rowInput]} value={scheduleTime} onChangeText={setScheduleTime} placeholder="HH:MM" /><TextInput accessibilityLabel="Planned duration in minutes" style={[styles.input, styles.durationInput]} keyboardType="number-pad" value={scheduleMinutes} onChangeText={setScheduleMinutes} placeholder="Min" /></View>
        <Button label="Save planned time" onPress={() => void saveSchedule()} />
        {selected?.blocks.map((block) => <View key={block.id} style={styles.blockCard}><Text accessibilityRole="text" style={styles.cardTitle}>{new Date(block.startsAt).toLocaleString()} · {Math.max(1, Math.round((Date.parse(block.endsAt) - Date.parse(block.startsAt)) / 60000))} min</Text>{block.externalEventId ? <Text style={styles.muted}>Added to Google Calendar</Text> : <Button label={calendarConnected ? 'Add to Google Calendar' : 'Connect Google Calendar'} secondary onPress={() => void addToCalendar(block)} />}<Pressable accessibilityRole="button" onPress={() => void removeTime(block)}><Text style={[styles.muted, { textAlign: 'center', paddingTop: 8 }]}>Remove planned time</Text></Pressable></View>)}
        <Text style={styles.fieldLabel}>Status</Text><View accessibilityRole="radiogroup" accessibilityLabel="Intention status" style={styles.chipRow}>{statuses.filter((status) => status !== 'archived').map((status) => <Pressable accessibilityRole="radio" accessibilityState={{ selected: selected?.status === status }} key={status} onPress={() => void setStatus(status)} style={[styles.chip, selected?.status === status && styles.chipSelected]}><Text style={[styles.chipText, selected?.status === status && styles.chipTextSelected]}>{status}</Text></Pressable>)}</View>
        {selected?.status === 'archived' ? <Button label="Restore to your space" onPress={() => void setStatus('ready')} secondary /> : <Pressable accessibilityRole="button" onPress={() => Alert.alert('Archive this thought?', 'It will stay in Archived until you restore it.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Archive', style: 'destructive', onPress: () => void setStatus('archived') }])}><Text style={[styles.muted, styles.archive]}>Archive this thought</Text></Pressable>}
      </ScrollView></SafeAreaView>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg, paddingHorizontal: 22 }, historyPanel: { gap: 10, padding: 14, borderWidth: 1, borderColor: palette.line, borderRadius: 12, backgroundColor: palette.paper }, historyEntry: { gap: 3, paddingBottom: 9, borderBottomWidth: 1, borderBottomColor: palette.line }, center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: palette.bg, padding: 24 },
  header: { paddingTop: 14, paddingBottom: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, brand: { color: palette.green, fontSize: 23, fontWeight: '700', letterSpacing: -1 }, sync: { color: palette.muted, fontSize: 11 },
  intro: { marginBottom: 24 }, eyebrow: { color: palette.green, fontSize: 10, fontWeight: '700', letterSpacing: 1.4, marginBottom: 12 }, hero: { color: palette.ink, fontSize: 30, fontWeight: '600', letterSpacing: -1.1, marginBottom: 6 }, muted: { color: palette.muted, fontSize: 14, lineHeight: 21 },
  captureCard: { backgroundColor: palette.paper, borderColor: palette.line, borderWidth: 1, borderRadius: 22, padding: 18, gap: 14, marginBottom: 18 }, captureInput: { minHeight: 88, color: palette.ink, fontSize: 17, lineHeight: 24, textAlignVertical: 'top' },
  button: { minHeight: 48, backgroundColor: palette.green, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginBottom: 14 }, buttonText: { color: '#fffefa', fontSize: 14, fontWeight: '700' }, secondaryButton: { backgroundColor: 'transparent', borderWidth: 1, borderColor: palette.line, marginTop: 12 }, secondaryButtonText: { color: palette.green },
  sectionHead: { marginTop: 12, marginBottom: 14 }, sectionTitle: { color: palette.ink, fontSize: 19, fontWeight: '600', marginBottom: 3 }, connectionCard: { padding: 16, borderRadius: 18, backgroundColor: palette.paper, borderColor: palette.line, borderWidth: 1, marginBottom: 12, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  timePeriodRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 7, marginBottom: 12 }, timeNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: palette.paper, borderColor: palette.line, borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 10 }, timeArrow: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }, timeArrowText: { fontSize: 28, lineHeight: 32, color: palette.green }, timeWeekRow: { flexDirection: 'row', justifyContent: 'space-between' }, timeWeekDay: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12 }, timeToday: { backgroundColor: '#e9eee5' }, timeDayName: { color: palette.muted, fontSize: 11 }, timeDayNumber: { color: palette.ink, fontSize: 14, fontWeight: '600' }, timeDayCount: { color: palette.green, fontSize: 10, marginTop: 2 }, timeWeekLabel: { width: '14.28%', textAlign: 'center', color: palette.muted, fontSize: 11, paddingVertical: 8 }, timeMonthOverview: { padding: 10, backgroundColor: palette.paper, borderColor: palette.line, borderWidth: 1, borderRadius: 16, marginBottom: 12 }, timeMonthGrid: { flexDirection: 'row', flexWrap: 'wrap' }, timeMonthDay: { width: '14.28%', height: 45, alignItems: 'center', justifyContent: 'center', borderRadius: 10 }, timeOutsideMonth: { opacity: 0.35 }, timeYearGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, marginBottom: 12 }, timeYearMonth: { width: '31%', minHeight: 68, justifyContent: 'center', alignItems: 'center', backgroundColor: palette.paper, borderColor: palette.line, borderWidth: 1, borderRadius: 14, padding: 8 }, timeYearName: { color: palette.ink, fontWeight: '600', fontSize: 14 },
  connectionButton: { borderWidth: 1, borderColor: palette.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 }, connectionButtonText: { color: palette.green, fontSize: 13, fontWeight: '700' }, card: { padding: 18, borderRadius: 18, backgroundColor: palette.paper, borderColor: palette.line, borderWidth: 1, marginBottom: 12 }, kind: { color: palette.green, fontSize: 10, letterSpacing: 1, fontWeight: '700' }, cardTitle: { color: palette.ink, fontSize: 17, fontWeight: '600', marginTop: 11 }, cardBody: { color: palette.muted, fontSize: 14, lineHeight: 20, marginTop: 7 }, cardFoot: { color: palette.muted, fontSize: 11, marginTop: 14 }, empty: { alignItems: 'center', padding: 34 },
  authCard: { width: '100%', maxWidth: 430, backgroundColor: palette.paper, borderRadius: 24, padding: 26, borderColor: palette.line, borderWidth: 1, gap: 14 }, onboardingScrim: { flex: 1, backgroundColor: 'rgba(41,42,37,0.42)', justifyContent: 'center', padding: 20 }, onboardingWrap: { flexGrow: 1, justifyContent: 'center' }, onboardingCard: { backgroundColor: palette.bg, borderRadius: 24, padding: 24, borderColor: palette.line, borderWidth: 1, gap: 12 }, privacyNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14, borderRadius: 14, backgroundColor: palette.paper, marginVertical: 8 }, privacyMark: { color: palette.green, fontSize: 18 }, aiNote: { padding: 14, borderRadius: 14, backgroundColor: palette.paper, borderColor: palette.line, borderWidth: 1, marginTop: 12 }, brainstormCard: { marginVertical: 16, padding: 15, borderRadius: 16, backgroundColor: palette.paper, borderColor: palette.line, borderWidth: 1, gap: 9 }, brainstormMessage: { padding: 11, borderRadius: 11, backgroundColor: palette.bg, borderColor: palette.line, borderWidth: 1, marginTop: 7 }, brainstormUserMessage: { backgroundColor: '#e7efe9' }, brainstormRole: { color: palette.green, fontSize: 11, fontWeight: '700' }, brainstormPrivacy: { color: palette.muted, fontSize: 11, lineHeight: 16 }, brainstormInput: { minHeight: 66, padding: 12, borderRadius: 10, borderColor: palette.line, borderWidth: 1, backgroundColor: '#fff', color: palette.ink, textAlignVertical: 'top' }, brainstormError: { color: palette.red, fontSize: 12 }, input: { minHeight: 48, paddingHorizontal: 14, borderRadius: 12, borderColor: palette.line, borderWidth: 1, backgroundColor: '#fff', color: palette.ink },
  modalScreen: { flex: 1, backgroundColor: palette.bg }, modalContent: { padding: 22, paddingBottom: 48 }, modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }, fieldLabel: { color: palette.ink, fontWeight: '600', marginTop: 16, marginBottom: 7 }, multiline: { minHeight: 74, textAlignVertical: 'top', paddingTop: 12 }, chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { borderWidth: 1, borderColor: palette.line, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 }, chipSelected: { backgroundColor: palette.green, borderColor: palette.green }, chipText: { color: palette.muted, fontSize: 12 }, chipTextSelected: { color: palette.paper }, row: { flexDirection: 'row', gap: 8, marginVertical: 12 }, rowInput: { flex: 1, minWidth: 0 }, durationInput: { width: 68 }, blockCard: { padding: 14, backgroundColor: palette.paper, borderRadius: 14, borderWidth: 1, borderColor: palette.line, marginTop: 10 }, archive: { textAlign: 'center', color: palette.red, paddingVertical: 20 },
});
