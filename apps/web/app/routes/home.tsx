import { useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { useReducedMotionPref } from '../lib/motion-prefs.client';
import { listItemVariants, listItemTransition, listCardTransition, listHoverLift, listRowHoverLift, listTap } from '../lib/list-motion';
import { AccountSettingsPage, parseAccountTab, type AccountTab } from '../components/AccountSettingsPage';
import { Modal } from '../components/Modal';
import { TabHeader } from '../components/TabHeader';
import { SegmentedTabs } from '../components/SegmentedTabs';
import { AlignView, alignmentTypes } from '../components/AlignView';
import type { LocalAlignment } from '../lib/alignments.client';
import { AccountMenu } from '../components/AccountMenu';
import { Connections } from '../components/Connections';
import { oauthProviders, connectionProviderId, type ConnectionEntry, type ConnectionStatus, type ConnectionProvider, type OAuthProvider } from '../lib/sync.client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { appendOriginalPiece, initialOriginalVersions, appendVoiceTranscript, calendarAvailabilityMatchesRange, findAvailableSlot, rankIntentionSuggestions, rawCaptureMaxLength, voiceAgentDefaultName, voiceAgentTones, voiceAgentToneLabels, voiceAgentVoices, type VoiceAgentTone, type VoiceAgentVoice, type AlignmentKind } from '@clearhead/domain';
import { VoicePicker } from '../components/VoicePicker';
import { CapturePanel } from '../components/CapturePanel';
import { OriginalThought, OriginalPieces, OriginalGist } from '../components/OriginalThought';
import { ThoughtTimeline } from '../components/ThoughtTimeline';
import { ThoughtIcon } from '../components/ThoughtIcon';
import { ThoughtFields, thoughtFieldLabels } from '../components/ThoughtFields';
import { RichTextView } from '../components/RichTextView';
import { AiPolish } from '../components/AiPolish';
import { PreviewModal } from '../components/PreviewModal';
import { AddToCalendarModal } from '../components/AddToCalendarModal';
import { UiIcon, type UiIconName } from '../components/UiIcon';
import { ThoughtStatus } from '../components/ThoughtStatus';
import { ProviderBadge } from '../components/ProviderBadge';
import { AccountBadge } from '../components/AccountBadge';
import { providerDisplayName } from '../lib/provider-logos';
import { RollingLabel } from '../components/RollingLabel';
import { TimeCalendar, type TimePeriod } from '../components/TimeCalendar';
import { TimezonePicker } from '../components/TimezonePicker';
import { dayInterval } from '../components/time-timeline';
import { durationLabel } from '../components/time-insights';
import { OpenSpace, Rhythm } from '../components/TimePerspectives';
import { BrainDumpIcon } from '../components/BrainBackdrop';
import { SpaceTimeBreakdown } from '../components/SpaceTimeBreakdown';
import { SpaceUpcomingPanel, SpaceSuggestedPanel, type SpaceUpcomingEntry, type SpaceSuggestionEntry } from '../components/SpaceUpcomingSuggested';
import { SpaceInsights, type SpaceInsightTile } from '../components/SpaceInsights';
import { SpaceCues, type SpaceCue } from '../components/SpaceCues';
import { SpaceAlignedGoals, type SpaceAlignedGoal } from '../components/SpaceAlignedGoals';
import { fetchSpaceCoach, type SpaceCoachCard } from '../lib/space-coach.client';
import { buildKindMinutes } from '../lib/time-breakdown';
import { spaceQuotes } from '../lib/space-quotes';
import { API, authClient } from '../lib/backend.client';
import { createSyncClient, type SyncClient, type SyncIntention, type SyncBlock, type UserPreferences, type IntentionRelationship, type SuggestionFeedback } from '../lib/sync.client';
import { VoiceAssistant } from '../components/VoiceAssistant';
import type { VoiceActions } from '../lib/voice-tools.client';
import { CommandPalette, type PaletteDestination } from '../components/CommandPalette';
import { themes, defaultThemeId, isThemeId, type ThemeId } from '../lib/themes';

type View = 'space' | 'explore' | 'align' | 'time' | 'suggestions' | 'connections';
type Block = SyncBlock;
type Intention = SyncIntention;
type Preferences = { reduceMotion: boolean; suggestions: boolean; nudgeLimit: number; aiInterpretationEnabled: boolean; quietStart: string | null; quietEnd: string | null; timezone: string | null; pinnedTimezones: string[] };

type AppliedTheme = 'light' | 'dark';
type ThemeChoice = AppliedTheme | 'system';
const themeChoices: readonly ThemeChoice[] = ['light', 'dark', 'system'];
const themeChoiceLabels: Record<ThemeChoice, string> = { light: 'Light', dark: 'Dark', system: 'Match device' };
const themeColor: Record<AppliedTheme, string> = { light: '#e7f1fe', dark: '#011122' };
const isDarkFamily = (value: AppliedTheme) => value === 'dark';

type AgentSettings = { name: string; tone: VoiceAgentTone; voice: VoiceAgentVoice };
const defaultAgentSettings: AgentSettings = { name: voiceAgentDefaultName, tone: 'warm', voice: 'marin' };

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}
type SpeechRecognitionLike = { lang: string; interimResults: boolean; continuous: boolean; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: ((event: { error: string }) => void) | null; onstart: (() => void) | null; onend: (() => void) | null; start(): void; stop(): void; abort?(): void };
type VoiceStatus = { kind: 'listening' | 'notice' | 'error'; text: string } | null;

const emptyPrefs: Preferences = { reduceMotion: false, suggestions: true, nudgeLimit: 2, aiInterpretationEnabled: false, quietStart: null, quietEnd: null, timezone: null, pinnedTimezones: [] };
const kinds = ['idea', 'action', 'question', 'goal', 'commitment', 'meeting', 'note', 'unclassified'];
const kindNames: Record<string, string> = { idea: 'Idea', action: 'Action', question: 'Question', goal: 'Goal', commitment: 'Commitment', meeting: 'Conversation', note: 'Note', unclassified: 'Unsorted' };
const kindGlyphs: Record<string, string> = { idea: '✳', action: '↗', question: '?', goal: '◎', commitment: '◷', meeting: '◉', note: '∙', unclassified: '✳' };
const kindIcons: Record<string, UiIconName> = { idea: 'kind-idea', action: 'kind-action', question: 'kind-question', goal: 'kind-goal', commitment: 'kind-commitment', meeting: 'kind-meeting', note: 'kind-note', unclassified: 'kind-unclassified' };
const itemExternalProvider = (item: Intention) => item.blocks?.find((block) => block.externalProvider)?.externalProvider;
const id = () => crypto.randomUUID();
const localDate = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const isMacPlatform = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
const timeAgo = (iso: string) => {
  const minute = 60_000, hour = 3_600_000, day = 86_400_000;
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < minute) return 'just now';
  if (diff < hour) { const n = Math.round(diff / minute); return `${n} minute${n === 1 ? '' : 's'} ago`; }
  if (diff < day) { const n = Math.round(diff / hour); return `${n} hour${n === 1 ? '' : 's'} ago`; }
  if (diff < day * 30) { const n = Math.round(diff / day); return `${n} day${n === 1 ? '' : 's'} ago`; }
  return new Date(iso).toLocaleDateString();
};
// Days remaining before the auto-purge worker job permanently deletes a trashed thought.
const daysUntilPurge = (trashedAt: string | null | undefined): number | null => {
  if (!trashedAt) return null;
  const purgeAt = Date.parse(trashedAt) + TRASH_RETENTION_DAYS * 86_400_000;
  return Math.max(0, Math.ceil((purgeAt - Date.now()) / 86_400_000));
};
type CalendarCheck = { start: string; end: string; checkedAt: string };
const CALENDAR_CHECK_MAX_AGE_MS = 5 * 60_000;
// Mirrors the server's default TRASH_RETENTION_DAYS (apps/worker/src/worker.ts) - display only,
// the server's clock is authoritative for when a trashed thought actually gets purged.
const TRASH_RETENTION_DAYS = 30;
// How often to re-check /integrations while the Time tab's "sync all calendars" job is
// still running, and how long to wait before giving up (the job may have failed silently
// without ever updating lastSyncedAt) - mirrors Connections.tsx's own per-account polling.
const CALENDAR_SYNC_POLL_INTERVAL_MS = 4_000;
const CALENDAR_SYNC_TIMEOUT_MS = 90_000;
const calendarCheckIsFresh = (check: CalendarCheck | null, now = Date.now()) => {
  const checkedAt = Date.parse(check?.checkedAt ?? '');
  return Number.isFinite(checkedAt) && checkedAt <= now && now - checkedAt <= CALENDAR_CHECK_MAX_AGE_MS;
};
const dateShift = (date: Date, days: number) => { const result = new Date(date); result.setDate(result.getDate() + days); return result; };
const dateTitle = (date: Date) => date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
// "12 July 2026" / "10–10:30 AM": the schedule-time chip used to print the raw ISO date and
// 24h time straight from storage — readable for a machine, not for the person glancing at it.
const scheduleDateLabel = (date: string) => { const d = new Date(`${date}T00:00:00`); return `${d.getDate()} ${d.toLocaleDateString(undefined, { month: 'long' })} ${d.getFullYear()}`; };
const clockPart = (date: Date) => { const hour24 = date.getHours(); const minute = date.getMinutes(); const period = hour24 >= 12 ? 'PM' : 'AM'; const hour = hour24 % 12 || 12; return { period, label: minute ? `${hour}:${String(minute).padStart(2, '0')}` : `${hour}` }; };
const scheduleTimeRange = (date: string, time: string, duration: number) => {
  const start = new Date(`${date}T${time}`); const end = new Date(start.getTime() + duration * 60_000);
  const a = clockPart(start); const b = clockPart(end);
  return a.period === b.period ? `${a.label}–${b.label} ${b.period}` : `${a.label} ${a.period}–${b.label} ${b.period}`;
};
const blockDayLabel = (date: string) => {
  const todayStr = localDate(new Date()); const tomorrowStr = localDate(dateShift(new Date(), 1));
  return date === todayStr ? 'Today' : date === tomorrowStr ? 'Tomorrow' : dateTitle(new Date(`${date}T00:00:00`));
};
const scheduleWeekday = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long' });
const scheduleDateCaption = (date: string) => {
  const todayStr = localDate(new Date()); const tomorrowStr = localDate(dateShift(new Date(), 1));
  const relative = date === todayStr ? 'Today' : date === tomorrowStr ? 'Tomorrow' : null;
  return relative ? `${relative} · ${scheduleWeekday(date)}` : `${scheduleWeekday(date)} · ${scheduleDateLabel(date)}`;
};
// Short form for the detail-rail schedule card's date column, which only has room for one
// line: "Today"/"Tomorrow" when near, otherwise "Tue, Oct 23, 2025" rather than the longer
// weekday-and-month-spelled-out form scheduleDateCaption uses elsewhere.
const scheduleDateCaptionShort = (date: string) => {
  const todayStr = localDate(new Date()); const tomorrowStr = localDate(dateShift(new Date(), 1));
  if (date === todayStr) return 'Today';
  if (date === tomorrowStr) return 'Tomorrow';
  const d = new Date(`${date}T00:00:00`);
  return `${d.toLocaleDateString(undefined, { weekday: 'short' })}, ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${d.getFullYear()}`;
};
// Spelled-out form for the same card's duration column — durationLabel's "1h 30m" is tuned
// for tight spaces like duration chips, but this column has room for "1 hour 30 min".
const scheduleDurationCaption = (minutes: number) => {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60); const rest = minutes % 60;
  const hourWord = `${hours} hour${hours === 1 ? '' : 's'}`;
  return rest ? `${hourWord} ${rest} min` : hourWord;
};
const nextScheduledBlock = (item: { blocks?: Block[] }): Block | null => {
  const blocks = item.blocks ?? []; if (!blocks.length) return null;
  const byWhen = [...blocks].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const todayStr = localDate(new Date());
  return byWhen.find((block) => block.date >= todayStr) ?? byWhen[0]!;
};
const titleFrom = (raw: string) => {
  const stripped = raw.trim().replace(/^(i (want|need|should|might|could|would) to|i'd like to|we should|remember to|maybe i should)\s+/i, '').replace(/[.!?]+$/, '').replace(/\s+/g, ' ');
  const title = stripped ? stripped[0]!.toUpperCase() + stripped.slice(1) : 'A new thought';
  return title.length > 64 ? `${title.slice(0, 61).trimEnd()}…` : title;
};
function normalize(source: Partial<Intention> & { id: string }): Intention {
  const legacyHorizon: Record<string, string> = { 'This week': 'week', 'Next week': 'week', Someday: 'someday', 'This month': 'month' };
  const horizon = source.horizon ? legacyHorizon[source.horizon] ?? source.horizon : undefined;
  return {
    id: source.id, clientId: source.clientId ?? source.id, remoteId: source.remoteId,
    rawCapture: source.rawCapture ?? source.raw ?? source.title ?? 'A new thought', raw: source.raw ?? source.rawCapture,
    title: source.title ?? titleFrom(source.rawCapture ?? source.raw ?? ''), kind: kinds.includes(source.kind ?? '') ? source.kind! : 'unclassified',
    intent: source.intent ?? '', purpose: source.purpose ?? '', desiredOutcome: source.desiredOutcome ?? '', roughPlan: source.roughPlan ?? '',
    horizon: ['today', 'week', 'month', 'someday', 'custom'].includes(horizon ?? '') ? horizon : undefined,
    effortEstimate: source.effortEstimate ?? null,
    energyContext: source.energyContext ?? null, status: source.status ?? 'captured', createdAt: source.createdAt ?? new Date().toISOString(),
    updatedAt: source.updatedAt ?? source.createdAt ?? new Date().toISOString(), version: source.version ?? null,
    originalVersions: source.originalVersions?.length ? source.originalVersions : initialOriginalVersions(source.clientId ?? source.id, source.rawCapture ?? source.raw ?? source.title ?? 'A new thought', source.createdAt ?? new Date().toISOString(), source.remoteId ? source.createdAt ?? new Date().toISOString() : null),
    originalGists: source.originalGists ?? {},
    fieldEvaluation: source.fieldEvaluation ?? null,
    aiInterpretation: source.aiInterpretation ?? null,
    blocks: (source.blocks ?? []).map((block) => ({ ...block, id: block.id ?? id(), date: block.date ?? String(block.startsAt ?? '').slice(0, 10), time: block.time ?? new Date(block.startsAt ?? '').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }), duration: block.duration ?? Math.max(1, Math.round((Date.parse(block.endsAt ?? '') - Date.parse(block.startsAt ?? '')) / 60000)) })),
    syncState: source.syncState ?? 'pending', suggestionDismissed: source.suggestionDismissed, snoozedUntil: source.snoozedUntil,
  };
}

function SignIn({ client }: { client: SupabaseClient }) {
  const [email, setEmail] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const { error } = await client.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
      setMessage(error ? error.message : 'Check your email for a sign-in link.');
    } catch {
      setMessage('Could not send a sign-in link. Check your connection and try again.');
    } finally { setBusy(false); }
  }
  return <main className="auth-screen"><section className="auth-card"><Brand /><div className="date-label">A private space for what matters</div><h1>A little room to think.</h1><p>Sign in to keep your intentions safely synced across your devices.</p><form onSubmit={submit}><label htmlFor="email">Email address</label><input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /><button className="capture-button" disabled={busy}>{busy ? 'Sending…' : 'Email me a sign-in link'} <span>↗</span></button></form><p className="auth-message" role="status">{message}</p><small>Private by default. You can export or delete your data at any time.</small></section></main>;
}

function Brand() { return <div className="brand"><span className="brand-mark"><i /><i /><i /></span><span>clearhead</span></div>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="empty-state"><div className="empty-symbol">✳</div><h3>{title}</h3><p>{text}</p></div>; }

export default function Home() {
  const reduceViewMotion = useReducedMotionPref();
  const viewMotion = {
    initial: reduceViewMotion ? false : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -6 },
    transition: { duration: reduceViewMotion ? 0 : 0.16, ease: 'easeOut' as const },
  };
  const [theme, setTheme] = useState<AppliedTheme>('light');
  const [themeChoice, setThemeChoiceState] = useState<ThemeChoice>('system');
  const [themeName, setThemeNameState] = useState<ThemeId>(defaultThemeId);
  const [agentSettings, setAgentSettingsState] = useState<AgentSettings>(defaultAgentSettings);
  const [session, setSession] = useState<Session | null>(null); const [userId, setUserId] = useState<string | null>(null); const [ready, setReady] = useState(false);
  const [profileName, setProfileName] = useState('');
  const syncClient = useRef<SyncClient | null>(null); const loadedUserId = useRef<string | null>(null);
  const oauthCompletionStates = useRef(new Set<string>());
  const [connectionStatuses, setConnectionStatuses] = useState<ConnectionStatus[]>([]);
  const [connectionMessage, setConnectionMessage] = useState('');
  const [syncClientReady, setSyncClientReady] = useState(false);
  const [items, setItems] = useState<Intention[]>([]); const itemsRef = useRef(items); itemsRef.current = items;
  const [legacyImports, setLegacyImports] = useState<Intention[]>([]);
  const [alignments, setAlignments] = useState<LocalAlignment[]>([]);
  const [relationships, setRelationships] = useState<IntentionRelationship[]>([]);
  const [suggestionFeedback, setSuggestionFeedback] = useState<SuggestionFeedback[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const accountTab = parseAccountTab(searchParams.get('settings'));
  const [workspaceView, setView] = useState<View>(() => accountTab ? 'explore' : 'space');
  const view = accountTab ? 'account' : workspaceView; const [filter, setFilter] = useState('all'); const [search, setSearch] = useState(''); const [searchOpen, setSearchOpen] = useState(false); const [exploreLayout, setExploreLayout] = useState<'list' | 'gallery'>('list'); const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchShortcutLabel, setSearchShortcutLabel] = useState('Ctrl K');
  useEffect(() => { setSearchShortcutLabel(isMacPlatform() ? '⌘K' : 'Ctrl K'); }, []);
  const [capture, setCapture] = useState(''); const [captureSaving, setCaptureSaving] = useState(false); const [captureFocused, setCaptureFocused] = useState(false); const [captureInputMode, setCaptureInputMode] = useState<'keyboard' | 'microphone'>('keyboard'); const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>(null); const captureInputRef = useRef<HTMLTextAreaElement | null>(null); const capturePanelRef = useRef<HTMLDivElement | null>(null); const [toast, setToast] = useState(''); const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null); const [syncError, setSyncError] = useState(false); const [syncLabel, setSyncLabel] = useState('Saved on this device'); const [syncNowBusy, setSyncNowBusy] = useState(false);
  const voiceBaseCapture = useRef('');
  const [prefs, setPrefs] = useState<Preferences>(emptyPrefs); const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [webPushSubscribed, setWebPushSubscribed] = useState(false); const [webPushBusy, setWebPushBusy] = useState(false); const [webPushMessage, setWebPushMessage] = useState('');
  const [googleConnected, setGoogleConnected] = useState(false); const [busyWindows, setBusyWindows] = useState<Array<{ start: string; end: string }>>([]); const [busyWindowRange, setBusyWindowRange] = useState<CalendarCheck | null>(null); const [availabilityText, setAvailabilityText] = useState('');
  // Every connected Google/Outlook account, calendar push's actual targets - distinct from
  // googleConnected, which only gates the Google-specific free/busy availability feature.
  const calendarAccounts = connectionStatuses.filter((status) => (status.provider === 'google_calendar' || status.provider === 'outlook') && status.connected);
  // accountId -> the instant we asked it to sync. The Time tab's refresh keeps showing a
  // "still working" state until every queued account's lastSyncedAt (polled from
  // /integrations) catches up to that instant, or it times out - at which point the
  // background job has actually finished and refreshIntentions() can surface its cards.
  const [syncingCalendarAccounts, setSyncingCalendarAccounts] = useState<Record<string, string>>({});
  const calendarSyncing = Object.keys(syncingCalendarAccounts).length > 0;
  useEffect(() => {
    if (!calendarSyncing || !syncClient.current) return;
    const client = syncClient.current;
    const interval = setInterval(() => { void client.refreshConnections(); void client.refreshIntentions(); }, CALENDAR_SYNC_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [calendarSyncing]);
  useEffect(() => {
    if (!calendarSyncing) return;
    const now = Date.now();
    setSyncingCalendarAccounts((current) => {
      let changed = false;
      const next = { ...current };
      for (const [accountId, startedAt] of Object.entries(current)) {
        const account = connectionStatuses.find((status) => status.id === accountId);
        const caughtUp = Boolean(account?.lastSyncedAt) && Date.parse(account!.lastSyncedAt!) >= Date.parse(startedAt);
        const timedOut = now - Date.parse(startedAt) > CALENDAR_SYNC_TIMEOUT_MS;
        if (caughtUp || timedOut) { delete next[accountId]; changed = true; }
      }
      return changed ? next : current;
    });
  }, [connectionStatuses, calendarSyncing]);
  // Shared by the Time tab's "sync all" button and the Connections tab's per-account/
  // sync-all buttons, so a sync kicked off from either place is tracked in one place that
  // outlives both - unlike component-local state, this survives switching tabs away and
  // back while the background job is still running.
  function markCalendarSyncing(accountIds: string[]) {
    if (!accountIds.length) return;
    const startedAt = new Date().toISOString();
    setSyncingCalendarAccounts((current) => {
      const next = { ...current };
      for (const id of accountIds) next[id] = startedAt;
      return next;
    });
  }
  useEffect(() => {
    if (!busyWindowRange) return;
    const expiresAt = Date.parse(busyWindowRange.checkedAt) + CALENDAR_CHECK_MAX_AGE_MS;
    const timer = setTimeout(() => {
      setBusyWindows([]); setBusyWindowRange(null); setAvailabilityText('Calendar availability check expired. Refresh it before using a suggested slot.');
    }, Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [busyWindowRange]);
  const detailBaseline = useRef<Partial<Intention>>({});
  const [dumpTarget, setDumpTarget] = useState<{ itemId: string; versionId: string; newVersion: boolean } | null>(null);
  const captureBeforeDump = useRef('');
  const pieceDrafts = useRef<Record<string, string>>({});
  const [detailTab, setDetailTab] = useState<'polished' | 'original' | 'timeline'>('polished');
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null); const [detailDraft, setDetailDraft] = useState<Partial<Intention>>({}); const [scheduleOpen, setScheduleOpen] = useState(false); const [scheduleTarget, setScheduleTarget] = useState<string | null>(null); const [connectionsFor, setConnectionsFor] = useState<string | null>(null); const [alignmentsFor, setAlignmentsFor] = useState<string | null>(null); const [previewId, setPreviewId] = useState<string | null>(null); const [calendarConfirm, setCalendarConfirm] = useState<{ itemId: string; blockId: string } | null>(null); const [syncConflicts, setSyncConflicts] = useState<Array<{ id: string; title: string }>>([]);
  const [scheduleDate, setScheduleDate] = useState(localDate(dateShift(new Date(), 1))); const [scheduleTime, setScheduleTime] = useState('10:00'); const [scheduleDuration, setScheduleDuration] = useState(30);
  const [recognizing, setRecognizing] = useState<SpeechRecognitionLike | null>(null); const detail = items.find((item) => item.id === detailId) ?? null;
  useEffect(() => { if (detail) setSelectedVersionId(detail.originalVersions?.at(-1)?.id ?? ''); }, [detail?.id, detail?.originalVersions?.length]);
  const dumpItem = items.find((item) => item.id === dumpTarget?.itemId) ?? null;
  const activeItems = useMemo(() => items.filter((item) => item.status !== 'archived' && item.status !== 'trashed'), [items]);
  const today = new Date(); const todayString = localDate(today);

  const nav: Array<{ id: View; label: string; icon: ReactNode; iconName?: 'home' | 'explore' | 'align' | 'time' | 'suggestions' | 'connections' }> = [
    { id: 'space', label: 'Space', icon: <UiIcon name="home" />, iconName: 'home' }, { id: 'explore', label: 'Explore', icon: <UiIcon name="explore" />, iconName: 'explore' },
    { id: 'align', label: 'Align', icon: <UiIcon name="align" />, iconName: 'align' }, { id: 'time', label: 'Time', icon: <UiIcon name="time" />, iconName: 'time' },
    { id: 'suggestions', label: 'Suggestions', icon: <UiIcon name="suggestions" />, iconName: 'suggestions' }, { id: 'connections', label: 'Connections', icon: <UiIcon name="connections" />, iconName: 'connections' },
  ];
  const navBarButton = (entry: typeof nav[number]) => <button key={entry.id} className={`nav-item ${entry.id === 'suggestions' ? 'suggestion-link' : ''} ${view === entry.id ? 'active' : ''}`} onClick={() => changeView(entry.id)} title={entry.label}><span className="nav-icon">{entry.icon}</span><span>{entry.label}</span>{entry.id === 'explore' ? <span className="nav-count">{activeItems.length}</span> : entry.id === 'suggestions' && suggestions.length > 0 ? <span className="suggestion-dot" /> : null}</button>;
  const openCount = activeItems.filter((item) => item.status !== 'completed').length;
  const firstName = profileName.trim().split(/\s+/)[0] || '';
  const greeting = `Good ${today.getHours() < 12 ? 'morning' : today.getHours() < 18 ? 'afternoon' : 'evening'}${firstName ? `, ${firstName}` : ''}.`;
  const exploreItems = filter === 'archived' ? items.filter((item) => item.status === 'archived')
    : filter === 'trashed' ? items.filter((item) => item.status === 'trashed')
    : activeItems;
  const filtered = exploreItems.filter((item) => (filter === 'all' || filter === 'archived' || filter === 'trashed' || item.kind === filter) && (!search.trim() || `${item.title} ${item.rawCapture} ${item.purpose ?? ''}`.toLowerCase().includes(search.toLowerCase()))).sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
  const relationshipCount = (itemId: string) => relationships.filter((relationship) => relationship.fromClientId === itemId || relationship.toClientId === itemId).length;
  const connectedThoughts = (itemId: string) => relationships.filter((relationship) => relationship.fromClientId === itemId || relationship.toClientId === itemId).map((relationship) => {
    const otherId = relationship.fromClientId === itemId ? relationship.toClientId : relationship.fromClientId;
    const otherTitle = relationship.fromClientId === itemId ? relationship.toTitle : relationship.fromTitle;
    const otherItem = items.find((entry) => entry.id === otherId);
    return { id: otherId, title: otherItem?.title ?? otherTitle, kind: otherItem?.kind ?? 'unclassified' };
  });
  const connectionSummary = (connected: Array<{ kind: string }>) => {
    const tally: Partial<Record<string, number>> = {};
    for (const entry of connected) tally[entry.kind] = (tally[entry.kind] ?? 0) + 1;
    return kinds.filter((kind) => tally[kind]).map((kind) => `${tally[kind]} ${kindNames[kind]}${tally[kind] === 1 || kind === 'unclassified' ? '' : 's'}`).join(', ');
  };
  const alignmentKindOrder: AlignmentKind[] = ['goal', 'reason', 'direction', 'value'];
  const alignedTo = (itemId: string) => alignments.filter((entry) => !entry.archived && entry.intentionIds.includes(itemId));
  const alignmentSummary = (entries: LocalAlignment[]) => {
    const tally: Partial<Record<AlignmentKind, number>> = {};
    for (const entry of entries) tally[entry.kind] = (tally[entry.kind] ?? 0) + 1;
    return alignmentKindOrder.filter((kind) => tally[kind]).map((kind) => `${tally[kind]} ${tally[kind] === 1 ? alignmentTypes[kind].label : alignmentTypes[kind].plural}`).join(', ');
  };
  const weekStart = new Date(today); weekStart.setDate(today.getDate() - today.getDay()); weekStart.setHours(0, 0, 0, 0);
  const weekDays = Array.from({ length: 7 }, (_, index) => dateShift(weekStart, index));
  const scheduled = activeItems.flatMap((item) => (item.blocks ?? []).map((block) => ({ item, block }))).sort((a, b) => `${a.block.date} ${a.block.time}`.localeCompare(`${b.block.date} ${b.block.time}`));

  const suggestions = prefs.suggestions ? rankIntentionSuggestions(activeItems, suggestionFeedback, { now: today, limit: prefs.nudgeLimit }) : [];

  const tomorrowString = localDate(dateShift(today, 1));
  const spaceUpcoming: SpaceUpcomingEntry[] = scheduled.filter(({ block }) => block.date >= todayString).slice(0, 5)
    .map(({ item, block }) => ({ id: block.id, intentionId: item.id, title: item.title, kind: item.kind, duration: block.duration, time: block.time, label: block.date === todayString ? 'Today' : block.date === tomorrowString ? 'Tomorrow' : dateTitle(new Date(`${block.date}T00:00:00`)) }));
  const spaceSuggestions: SpaceSuggestionEntry[] = suggestions.slice(0, 3).map(({ item, rationale }) => ({ id: item.id, title: item.title, rationale }));
  const completedDates = new Set(items.filter((item) => item.status === 'completed').map((item) => localDate(new Date(item.updatedAt))));
  let streakCursor = completedDates.has(todayString) ? today : dateShift(today, -1);
  let streak = 0;
  while (completedDates.has(localDate(streakCursor))) { streak++; streakCursor = dateShift(streakCursor, -1); }
  const doneThisWeek = items.filter((item) => item.status === 'completed' && new Date(item.updatedAt) >= weekStart).length;
  const doneLastWeek = items.filter((item) => item.status === 'completed' && new Date(item.updatedAt) >= dateShift(weekStart, -7) && new Date(item.updatedAt) < weekStart).length;
  const openIntentions = activeItems.filter((item) => item.status !== 'completed');
  const alignedOpenCount = openIntentions.filter((item) => alignedTo(item.id).length > 0).length;
  const oldestOpenDays = openIntentions.length
    ? Math.floor((today.getTime() - Math.min(...openIntentions.map((item) => new Date(item.createdAt).getTime()))) / 86_400_000)
    : 0;
  const spaceInsights: SpaceInsightTile[] = [
    { value: streak, label: 'day streak', icon: 'layout-rhythm' },
    { value: doneThisWeek, label: doneLastWeek ? `done this week · ${doneLastWeek} last week` : 'done this week', icon: 'calendar' },
    ...(openCount > 0 ? [
      { value: `${alignedOpenCount}/${openCount}`, label: 'open tied to a goal', icon: 'goal' as const },
      { value: oldestOpenDays, label: 'days on your oldest open thought', icon: 'time' as const },
    ] : []),
  ];
  const unalignedOpenCount = openIntentions.length - alignedOpenCount;
  const unscheduledNearTerm = openIntentions.filter((item) => (item.horizon === 'today' || item.horizon === 'week') && !item.blocks?.length);
  const next7 = Array.from({ length: 7 }, (_, index) => localDate(dateShift(today, index)));
  const scheduledDates = new Set(scheduled.map(({ block }) => block.date));
  const freeDaysAhead = next7.filter((date) => !scheduledDates.has(date)).length;
  const [spaceCoachCards, setSpaceCoachCards] = useState<SpaceCoachCard[] | null>(null);
  useEffect(() => {
    if (view !== 'space' || !prefs.aiInterpretationEnabled) { setSpaceCoachCards(null); return; }
    let cancelled = false;
    const minutesByKind = buildKindMinutes(scheduled, today, -14, 0);
    void fetchSpaceCoach({ openCount, doneThisWeek, doneLastWeek, unalignedOpenCount, freeDaysAhead, minutesByKind }).then((cards) => { if (!cancelled) setSpaceCoachCards(cards); });
    return () => { cancelled = true; };
  }, [view, prefs.aiInterpretationEnabled, items, activeItems, todayString]);

  useEffect(() => {
    if (!accountTab) return;
    // Browser Back/Forward must leave the settings page unobstructed too.
    setDetailId(null); setDumpTarget(null); setScheduleOpen(false); setCaptureFocused(false);
    if (recognizing) { try { recognizing.stop(); } catch { recognizing.abort?.(); } setRecognizing(null); }
  }, [accountTab, recognizing]);

  useLayoutEffect(() => {
    if (ready && captureFocused && captureInputMode === 'keyboard') captureInputRef.current?.focus();
  }, [ready, captureFocused, captureInputMode, dumpTarget]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const resolve = (choice: ThemeChoice): AppliedTheme => (choice === 'system' ? (media.matches ? 'dark' : 'light') : choice);
    const applyResolved = (resolved: AppliedTheme) => {
      document.documentElement.dataset.theme = resolved;
      document.querySelector<HTMLMetaElement>('#clearhead-theme-color')?.setAttribute('content', themeColor[resolved]);
      setTheme(resolved);
    };
    const readChoice = (): ThemeChoice => {
      let saved: string | null = null;
      try { saved = localStorage.getItem('clearhead-theme-v1'); } catch { /* Fall back to system when storage is unavailable. */ }
      return themeChoices.includes(saved as ThemeChoice) ? (saved as ThemeChoice) : 'system';
    };
    const choice = readChoice();
    setThemeChoiceState(choice);
    applyResolved(resolve(choice));
    const followDeviceTheme = (event: MediaQueryListEvent) => {
      if (readChoice() !== 'system') return;
      applyResolved(event.matches ? 'dark' : 'light');
    };
    media.addEventListener('change', followDeviceTheme);
    return () => media.removeEventListener('change', followDeviceTheme);
  }, []);

  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem('clearhead-theme-name-v1'); } catch { /* Use the default when storage is unavailable. */ }
    const id = isThemeId(saved) ? saved : defaultThemeId;
    document.documentElement.dataset.themeName = id;
    setThemeNameState(id);
  }, []);

  function setThemeName(id: ThemeId) {
    document.documentElement.dataset.themeName = id;
    try { localStorage.setItem('clearhead-theme-name-v1', id); } catch { /* The choice still applies for this session. */ }
    setThemeNameState(id);
  }

  const [navPosition, setNavPositionState] = useState<'left' | 'right' | 'top' | 'bottom'>('left');
  const [navCollapsed, setNavCollapsedState] = useState(false);

  useEffect(() => {
    let savedPosition: string | null = null; let savedCollapsed: string | null = null;
    try { savedPosition = localStorage.getItem('clearhead-nav-position-v1'); savedCollapsed = localStorage.getItem('clearhead-nav-collapsed-v1'); } catch { /* Use defaults when storage is unavailable. */ }
    const position = (['left', 'top', 'right', 'bottom'] as const).includes(savedPosition as never) ? (savedPosition as 'left' | 'top' | 'right' | 'bottom') : 'left';
    document.documentElement.dataset.navPosition = position;
    setNavPositionState(position);
    const collapsed = savedCollapsed === 'true';
    document.documentElement.dataset.navCollapsed = String(collapsed);
    setNavCollapsedState(collapsed);
  }, []);

  function setNavPosition(next: 'left' | 'top' | 'right' | 'bottom') {
    document.documentElement.dataset.navPosition = next;
    try { localStorage.setItem('clearhead-nav-position-v1', next); } catch { /* Keep the choice for this session only. */ }
    setNavPositionState(next);
  }

  function toggleNavCollapsed() {
    const next = !navCollapsed;
    document.documentElement.dataset.navCollapsed = String(next);
    try { localStorage.setItem('clearhead-nav-collapsed-v1', String(next)); } catch { /* Keep the choice for this session only. */ }
    setNavCollapsedState(next);
  }

  function setThemePreference(choice: ThemeChoice) {
    const resolved = choice === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : choice;
    document.documentElement.dataset.theme = resolved;
    document.querySelector<HTMLMetaElement>('#clearhead-theme-color')?.setAttribute('content', themeColor[resolved]);
    try { localStorage.setItem('clearhead-theme-v1', choice); } catch { /* The choice still applies for this session. */ }
    setThemeChoiceState(choice);
    setTheme(resolved);
  }

  // The quick topbar toggle only flips light<->dark, pinning an explicit choice even if the
  // user was on Sepia/Midnight/System — the full picker lives in Settings > Personalization.
  function toggleTheme() {
    setThemePreference(isDarkFamily(theme) ? 'light' : 'dark');
  }

  function setAgentSettings(next: AgentSettings) {
    setAgentSettingsState(next);
    try { localStorage.setItem('clearhead-agent-settings-v1', JSON.stringify(next)); } catch { /* Keep the choice for this session only. */ }
  }
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem('clearhead-agent-settings-v1'); } catch { /* Use defaults when storage is unavailable. */ }
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as Partial<AgentSettings>;
      const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim().slice(0, 30) : defaultAgentSettings.name;
      const tone = voiceAgentTones.includes(parsed.tone as VoiceAgentTone) ? (parsed.tone as VoiceAgentTone) : defaultAgentSettings.tone;
      const voice = voiceAgentVoices.includes(parsed.voice as VoiceAgentVoice) ? (parsed.voice as VoiceAgentVoice) : defaultAgentSettings.voice;
      setAgentSettingsState({ name, tone, voice });
    } catch { /* Keep defaults when the saved value is malformed. */ }
  }, []);

  useEffect(() => {
    setDetailTab('polished');
    if (!detailId) { setDetailDraft({}); return; }
    const item = itemsRef.current.find((entry) => entry.id === detailId);
    if (item) {
      const draft = { title: item.title, kind: item.kind, intent: item.intent ?? '', purpose: item.purpose ?? '', desiredOutcome: item.desiredOutcome ?? '', roughPlan: item.roughPlan ?? '', horizon: item.horizon ?? null, effortEstimate: item.effortEstimate ?? null, energyContext: item.energyContext ?? '' };
      detailBaseline.current = draft; setDetailDraft(draft);
    }
    document.querySelector<HTMLButtonElement>('.thought-workspace-heading button')?.focus();
  }, [detailId]);

  useEffect(() => {
    if (!detail) return;
    const previous = detailBaseline.current;
    const latest: Partial<Intention> = { title: detail.title, kind: detail.kind, intent: detail.intent ?? '', purpose: detail.purpose ?? '', desiredOutcome: detail.desiredOutcome ?? '', roughPlan: detail.roughPlan ?? '', horizon: detail.horizon ?? null, effortEstimate: detail.effortEstimate ?? null, energyContext: detail.energyContext ?? '' };
    setDetailDraft((draft) => {
      const next = { ...draft };
      for (const key of Object.keys(latest)) if (draft[key] === previous[key]) next[key] = latest[key];
      return next;
    });
    detailBaseline.current = latest;
  }, [detail]);

  const showToast = useCallback((message: string) => { setToast(message); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 2800); }, []);
  const loadLocal = useCallback((account: string) => {
    try {
      const raw = localStorage.getItem(`clearhead-intentions-v1:${account}`);
      return (JSON.parse(raw || '[]') as Array<Partial<Intention> & { id: string }>).map(normalize);
    } catch { return []; }
  }, []);
  const loadLegacyImports = useCallback((account: string) => {
    try {
      if (localStorage.getItem(`clearhead-legacy-imported-v1:${account}`) === 'complete') return [];
      const raw = localStorage.getItem('clearhead-intentions-v1');
      if (!raw) return [];
      const parsed = JSON.parse(raw) as Array<Partial<Intention> & { id?: unknown }>;
      return Array.isArray(parsed)
        ? parsed.filter((item): item is Partial<Intention> & { id: string } => Boolean(item && typeof item.id === 'string')).map(normalize)
        : [];
    } catch { return []; }
  }, []);
  const persist = useCallback((next: Intention[], message?: string): boolean => {
    if (!userId) return false;
    const normalized = next.map((item) => normalize(item));
    const queuedWrite = syncClient.current?.queue(normalized);
    try {
      const value = JSON.stringify(normalized); localStorage.setItem(`clearhead-intentions-v1:${userId}`, value);
      if (localStorage.getItem(`clearhead-intentions-v1:${userId}`) !== value) throw new Error('Local storage did not confirm the save.');
    } catch {
      if (!queuedWrite) { setSyncError(true); showToast('ClearHead could not save on this device. Check browser storage and try again.'); return false; }
    }
    itemsRef.current = normalized; setItems(normalized); setSyncError(false);
    void queuedWrite?.catch((error) => { setSyncError(true); showToast(error instanceof Error ? `Could not save offline changes: ${error.message}` : 'Could not save offline changes. Check browser storage and try again.'); });
    if (message) showToast(message);
    return true;
  }, [showToast, userId]);

  const activeUserId = useRef<string | null>(null);
  useEffect(() => {
    if (!authClient) { setReady(true); return; }
    let authEventReceived = false;
    let disposed = false;
    void authClient.auth.getSession().then(({ data }) => {
      if (disposed || authEventReceived) return;
      const nextId = data.session?.user.id ?? null;
      activeUserId.current = nextId; setSession(data.session); setUserId(nextId); setReady(true);
    });
    const { data } = authClient.auth.onAuthStateChange((_event, next) => {
      authEventReceived = true;
      const nextId = next?.user.id ?? null;
      if (nextId && ((activeUserId.current && activeUserId.current !== nextId) || (loadedUserId.current && loadedUserId.current !== nextId))) { window.location.replace('/'); return; }
      if (activeUserId.current !== nextId) { setItems([]); setAlignments([]); setRelationships([]); setSuggestionFeedback([]); setBusyWindows([]); setBusyWindowRange(null); setAvailabilityText(''); }
      activeUserId.current = nextId; setSession(next); setUserId(nextId); setReady(true);
    });
    return () => { disposed = true; data.subscription.unsubscribe(); };
  }, []);

  const sessionFullName = typeof session?.user.user_metadata?.full_name === 'string' ? session.user.user_metadata.full_name : '';
  useEffect(() => { setProfileName(sessionFullName); }, [sessionFullName]);
  async function saveProfileName() {
    const next = profileName.trim();
    if (!authClient || next === sessionFullName) return;
    const { error } = await authClient.auth.updateUser({ data: { full_name: next } });
    showToast(error ? 'Could not update your name.' : 'Name updated.');
  }

  const signedIn = Boolean(session && userId);
  useEffect(() => {
    if (!signedIn || !userId) { setOnboardingOpen(false); return; }
    try {
      if (localStorage.getItem(`clearhead-onboarding-v1:${userId}`) !== 'complete') setOnboardingOpen(true);
    } catch { setOnboardingOpen(true); }
  }, [signedIn, userId]);
  function finishOnboarding(openPreferences = false) {
    if (userId) {
      try { localStorage.setItem(`clearhead-onboarding-v1:${userId}`, 'complete'); } catch { /* Continue even when browser storage is restricted. */ }
    }
    setOnboardingOpen(false);
    if (openPreferences) openAccount('preferences');
  }
  function importLegacyThoughts() {
    if (!userId || !legacyImports.length) return;
    const imported = legacyImports.map((item) => {
      const clientId = id();
      const blocks = (item.blocks ?? []).map((block) => ({
        ...block, id: id(), remoteId: undefined, externalProvider: undefined,
        externalEventId: undefined, externalLink: undefined, syncState: 'local' as const,
      }));
      return normalize({ ...item, id: clientId, clientId, remoteId: undefined, version: null, blocks, syncState: 'pending' });
    });
    if (!persist([...imported, ...itemsRef.current], 'Previous thoughts imported into this account.')) return;
    try {
      localStorage.setItem(`clearhead-legacy-imported-v1:${userId}`, 'complete');
      localStorage.removeItem('clearhead-intentions-v1');
    } catch { showToast('Thoughts were imported, but the previous browser copy could not be removed.'); }
    setLegacyImports([]);
    finishOnboarding();
  }
  useEffect(() => {
    if (!signedIn || !userId) { setLegacyImports([]); return; }
    let cancelled = false; const account = userId; loadedUserId.current = account;
    const initial = loadLocal(account); itemsRef.current = initial; setItems(initial); setSyncLabel('Saved on this device');
    setLegacyImports(loadLegacyImports(account));
    let preference: Preferences = emptyPrefs;
    try { preference = { ...emptyPrefs, ...JSON.parse(localStorage.getItem(`clearhead-preferences-v1:${account}`) || '{}') }; } catch { /* use defaults */ }
    setPrefs(preference);
    const client = createSyncClient({
      apiUrl: API, userId: account,
      getSession: async () => {
        const session = (await authClient?.auth.getSession())?.data.session;
        return session ? { userId: session.user.id, accessToken: session.access_token } : null;
      },
      signOut: async () => {
        const result = await authClient?.auth.signOut({ scope: 'local' });
        if (result?.error) { window.location.replace('/'); throw result.error; }
      },
      onRemote: (remote) => {
        if (cancelled) return;
        const next = remote.map((item) => normalize(item)); itemsRef.current = next; setItems(next);
        try { localStorage.setItem(`clearhead-intentions-v1:${account}`, JSON.stringify(next)); setSyncError(false); }
        catch { setSyncError(true); setSyncLabel('Saved here · local storage is full'); }
      },
      onIntegrations: (integrations) => {
        if (cancelled) return;
        setConnectionStatuses(integrations);
        const hasGoogle = integrations.some((connection) => connection.provider === 'google_calendar' && connection.connected);
        setGoogleConnected(hasGoogle);
        if (!hasGoogle) { setBusyWindows([]); setBusyWindowRange(null); setAvailabilityText(''); }

      },
      onAlignments: (remote) => { if (!cancelled) setAlignments(remote); },
      onRelationships: (remote) => {
        if (cancelled) return;
        setRelationships(remote);
        try { localStorage.setItem(`clearhead-relationships-v1:${account}`, JSON.stringify(remote)); } catch { /* Keep relationships available for this session. */ }
      },
      onSuggestionFeedback: (remote) => {
        if (cancelled) return;
        setSuggestionFeedback(remote);
        try { localStorage.setItem(`clearhead-suggestion-feedback-v1:${account}`, JSON.stringify(remote)); } catch { /* Feedback remains available for this session. */ }
      },
      onPreferences: (remote) => {
        if (cancelled) return;
        const next: Preferences = { aiInterpretationEnabled: remote.aiInterpretationEnabled, reduceMotion: remote.reduceMotion, suggestions: remote.suggestionsEnabled, nudgeLimit: remote.suggestionLimit, quietStart: remote.quietStart ?? null, quietEnd: remote.quietEnd ?? null, timezone: remote.timezone ?? null, pinnedTimezones: remote.pinnedTimezones ?? [] };
        setPrefs(next);
        try { localStorage.setItem(`clearhead-preferences-v1:${account}`, JSON.stringify(next)); } catch { /* The preference still applies for this session. */ }
      },
      onState: (label, error) => { if (!cancelled) { setSyncLabel(label); setSyncError(error); } }, onToast: (message) => { if (!cancelled) showToast(message); },
      onConflict: (fork) => { if (!cancelled) setSyncConflicts((current) => current.some((entry) => entry.id === fork.id) ? current : [...current, fork]); },
    });
    syncClient.current = client;
    setSyncClientReady(true);
    setWebPushSubscribed(false); setWebPushMessage('');
    void client.getWebPushConfig().then((status) => { if (!cancelled) setWebPushSubscribed(status.subscribed); })
      .catch(() => { if (!cancelled) setWebPushMessage('Browser reminders are unavailable until push is configured on the server.'); });
    void client.start(initial).catch(() => { if (!cancelled) { setSyncError(true); setSyncLabel('Saved on this device · sync is unavailable'); } });
    return () => { cancelled = true; client.dispose(); if (syncClient.current === client) { syncClient.current = null; setSyncClientReady(false); } };
  }, [loadLegacyImports, loadLocal, showToast, signedIn, userId]);

  useEffect(() => { document.documentElement.classList.toggle('reduce-motion', prefs.reduceMotion); }, [prefs.reduceMotion]);
  useEffect(() => {
    const url = new URL(window.location.href);
    const connection = url.searchParams.get('connection');
    if (url.searchParams.get('view') === 'connections' || url.searchParams.has('connection_error') || url.hash.includes('oauth_provider=')) { setView('connections'); setCaptureFocused(false); }
    if (connection === 'google_connected') showToast('Google Calendar connected.');
    if (connection === 'jira_connected') showToast('Jira Cloud connected.');
    if (connection === 'notion_connected') showToast('Notion connected. Refresh selected pages when you’re ready.');
    if (url.searchParams.has('connection_error')) setConnectionMessage(url.searchParams.get('connection_error') || 'The provider could not connect.');
    const oauth = new URLSearchParams(url.hash.replace(/^#/, ''));
    const provider = oauth.get('oauth_provider');
    const code = oauth.get('oauth_code');
    const state = oauth.get('oauth_state');
    if (provider && code && state && oauthProviders.includes(provider as OAuthProvider)) {
      if (!signedIn || !syncClient.current || !userId) {
        showToast('Sign in to the same ClearHead account that started this connection.');
        return;
      }
      if (!oauthCompletionStates.current.has(state)) {
        oauthCompletionStates.current.add(state);
        const client = syncClient.current;
        void client.completeOAuth(provider as OAuthProvider, code, state)
          .then(() => setConnectionMessage('Your account is connected. Refresh the connection to see what’s available.'))
          .catch((error) => setConnectionMessage(error instanceof Error ? error.message : 'The provider connection could not complete. Reconnect and try again.'))
          .finally(() => {
            for (const key of ['oauth_provider', 'oauth_code', 'oauth_state']) oauth.delete(key);
            url.hash = oauth.size ? oauth.toString() : '';
            window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
          });
      }
    }
    if (url.searchParams.has('connection') || url.searchParams.has('connection_error') || url.searchParams.has('connection_provider')) {
      url.searchParams.delete('connection'); url.searchParams.delete('connection_error'); url.searchParams.delete('connection_provider');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, [showToast, signedIn, userId, syncClientReady]);
  useEffect(() => {
    function keydown(event: KeyboardEvent) { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPaletteOpen((value) => !value); return; } if (event.defaultPrevented) return; if (event.key === 'Escape') { setDetailId(null); setScheduleOpen(false); } }
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, []);

  function openAccount(tab: AccountTab) {
    if (recognizing) { try { recognizing.stop(); } catch { recognizing.abort?.(); } setRecognizing(null); }
    setDetailId(null); setDumpTarget(null); setScheduleOpen(false); setCaptureFocused(false);
    setSearchParams((previous) => { const next = new URLSearchParams(previous); next.set('settings', tab); return next; });
  }

  function changeView(next: View) {
    setSearchParams((previous) => { const params = new URLSearchParams(previous); params.delete('settings'); return params; }); setDumpTarget(null); setDetailId(null); setView(next); setCaptureFocused(false); if (next === 'space') { setCaptureInputMode('keyboard'); setVoiceStatus(null); } setSearchOpen(false); }
  function openDumpNow() { changeView('space'); selectCaptureMode('microphone'); }
  function updateItem(itemId: string, change: (item: Intention) => Intention, message?: string) {
    const next = itemsRef.current.map((item) => {
      if (item.id !== itemId) return item;
      const changed = change(item);
      const aiInterpretation = item.aiInterpretation?.canUndo && (changed.title !== item.title || changed.kind !== item.kind || changed.horizon !== item.horizon)
        ? { ...item.aiInterpretation, canUndo: false } : changed.aiInterpretation;
      return { ...changed, aiInterpretation, updatedAt: new Date().toISOString(), syncState: 'pending' as const };
    });
    persist(next, message);
  }
  // "Delete Forever" from Trash: immediate and irreversible, unlike moving to trash (which
  // goes through the offline-sync queue and can be undone with Restore). A thought that was
  // never synced has no remoteId yet, so there is nothing on the server to purge - just drop
  // it locally.
  function deleteForever(itemId: string) {
    if (!window.confirm('Permanently delete this thought? This cannot be undone.')) return;
    const item = itemsRef.current.find((entry) => entry.id === itemId);
    if (!persist(itemsRef.current.filter((entry) => entry.id !== itemId), 'Thought permanently deleted.')) return;
    if (item?.remoteId) void syncClient.current?.purgeIntention(item.remoteId).catch((error) => showToast(error instanceof Error ? error.message : 'Could not finish deleting this thought.'));
  }
  async function createRelationship(fromClientId: string, toClientId: string, relation: IntentionRelationship['relation']) {
    try {
      const saved = await syncClient.current?.createRelationship(fromClientId, toClientId, relation);
      if (!saved) { showToast('These thoughts are already connected.'); return; }
      setRelationships((current) => [saved, ...current]); showToast('Thoughts connected.');
    } catch (error) { showToast(error instanceof Error ? error.message : 'Could not connect those thoughts.'); }
  }
  async function deleteRelationship(relationshipId: string) {
    try { await syncClient.current?.deleteRelationship(relationshipId); setRelationships((current) => current.filter((item) => item.id !== relationshipId)); showToast('Connection removed.'); }
    catch (error) { showToast(error instanceof Error ? error.message : 'Could not remove this connection.'); }
  }
  async function keepConnectionEntry(entry: ConnectionEntry) {
    const client = syncClient.current;
    if (!client) throw new Error('Your space is still opening. Try again in a moment.');
    const rawCapture = `${entry.captureText ?? entry.title}${entry.url ? `\n\nSource: ${entry.url}` : ''}`;
    if (rawCapture.length > rawCaptureMaxLength) throw new Error('This message is too long to keep. Copy the part you need into a new thought.');
    if (itemsRef.current.some((item) => item.rawCapture === rawCapture)) return;
    const now = new Date().toISOString();
    const item = normalize({ id: id(), rawCapture, raw: rawCapture, title: titleFrom(rawCapture), kind: entry.kind ?? inferKind(rawCapture), status: 'captured', createdAt: now, updatedAt: now, intent: '', purpose: '', desiredOutcome: '', roughPlan: '', blocks: [], syncState: 'pending' });
    const next = [item, ...itemsRef.current];
    await client.queue(next);
    itemsRef.current = next; setItems(next); setSyncError(false);
    try { localStorage.setItem(`clearhead-intentions-v1:${userId}`, JSON.stringify(next)); } catch { /* IndexedDB holds the durable copy. */ }
    showToast('Message kept as a thought.');
  }
  async function saveCapture() {
    const rawCapture = capture; if (!rawCapture.trim() || captureSaving) return;
    if (recognizing) { try { recognizing.stop(); } catch { recognizing.abort?.(); } setRecognizing(null); }
    const client = syncClient.current;
    if (!client) { showToast('Your space is still opening. Try saving again in a moment.'); return; }
    const now = new Date().toISOString();
    let next: Intention[];
    if (dumpTarget) {
      const existing = itemsRef.current.find((item) => item.id === dumpTarget.itemId);
      if (!existing || existing.status === 'archived' || existing.status === 'trashed') { showToast('This thought is no longer available for new pieces.'); return; }
      const originals = appendOriginalPiece(existing.originalVersions ?? [], { id: id(), versionId: dumpTarget.versionId, content: rawCapture, createdAt: now, startNewVersion: dumpTarget.newVersion }, null);
      next = itemsRef.current.map((item) => item.id === existing.id ? normalize({ ...item, originalVersions: originals, updatedAt: now, syncState: 'pending' }) : item);
    } else {
      const item: Intention = normalize({ id: id(), rawCapture, raw: rawCapture, title: titleFrom(rawCapture), kind: inferKind(rawCapture), status: 'captured', createdAt: now, updatedAt: now, intent: '', purpose: '', desiredOutcome: '', roughPlan: '', blocks: [], syncState: 'pending' });
      next = [item, ...itemsRef.current].map((entry) => normalize(entry));
    }
    setCaptureSaving(true);
    try {
      await client.queue(next);
      itemsRef.current = next; setItems(next); setSyncError(false);
      try { localStorage.setItem(`clearhead-intentions-v1:${userId}`, JSON.stringify(next)); } catch { /* IndexedDB is the durable local copy; localStorage is only a startup cache. */ }
      setVoiceStatus(null); setCaptureInputMode('keyboard');
      if (dumpTarget) {
        delete pieceDrafts.current[dumpTarget.itemId];
        setDumpTarget(null); setCapture(captureBeforeDump.current); setCaptureFocused(false); setDetailTab('original');
        showToast('New piece kept with this idea.');
        requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.original-actions button')?.focus());
      } else {
        if (capture === rawCapture) setCapture(''); setCaptureFocused(true); requestAnimationFrame(() => captureInputRef.current?.focus()); showToast('Kept. You can shape it whenever you’re ready.');
      }
    } catch (error) {
      setSyncError(true);
      showToast(error instanceof Error ? `Could not save on this device: ${error.message}` : 'Could not save on this device. Check browser storage and try again.');
    } finally { setCaptureSaving(false); }
  }
  async function createIntentionFromVoice(rawCapture: string): Promise<{ id: string; title: string } | null> {
    const trimmed = rawCapture.trim(); if (!trimmed) return null;
    const client = syncClient.current; if (!client) return null;
    const now = new Date().toISOString();
    const item: Intention = normalize({ id: id(), rawCapture: trimmed, raw: trimmed, title: titleFrom(trimmed), kind: inferKind(trimmed), status: 'captured', createdAt: now, updatedAt: now, intent: '', purpose: '', desiredOutcome: '', roughPlan: '', blocks: [], syncState: 'pending' });
    const next = [item, ...itemsRef.current].map((entry) => normalize(entry));
    await client.queue(next);
    itemsRef.current = next; setItems(next); setSyncError(false);
    try { localStorage.setItem(`clearhead-intentions-v1:${userId}`, JSON.stringify(next)); } catch { /* IndexedDB is the durable local copy. */ }
    showToast('Kept. You can shape it whenever you’re ready.');
    return { id: item.id, title: item.title };
  }
  function openDump(newVersion: boolean) {
    if (!detail || detail.status === 'archived' || detail.status === 'trashed') return;
    captureBeforeDump.current = capture;
    setCapture(pieceDrafts.current[detail.id] ?? ''); setVoiceStatus(null); setCaptureInputMode('keyboard');
    setDumpTarget({ itemId: detail.id, versionId: newVersion ? id() : detail.originalVersions!.at(-1)!.id, newVersion });
    setCaptureFocused(true);
  }
  function inferKind(raw: string) {
    if (/^\s*(what|why|how|when|where|who|could|would|is it|should i)\b/i.test(raw)) return 'question';
    if (/\b(talk to|meet|discuss)\b/i.test(raw)) return 'meeting';
    if (/\b(ask|call|email|send|book|schedule|remind|finish|make|write|buy|prepare|visit)\b/i.test(raw)) return 'action';
    if (/\b(idea|imagine|explore|maybe|someday|wonder|could we)\b/i.test(raw)) return 'idea';
    if (/\b(goal|want to become|over the next|by the end)\b/i.test(raw)) return 'goal';
    return 'unclassified';
  }
  function startSchedule(target?: string, date?: string, time = '10:00', duration = 30) { setScheduleTarget(target ?? null); setScheduleDate(date ?? localDate(dateShift(new Date(), 1))); setScheduleTime(time); setScheduleDuration(duration); setScheduleOpen(true); }
  function planSuggestedTime(item: Intention) {
    const range = { start: localDate(weekDays[0]!), end: localDate(dateShift(weekDays[6]!, 1)) };
    const calendarChecked = googleConnected && calendarCheckIsFresh(busyWindowRange) && calendarAvailabilityMatchesRange(busyWindowRange, range);
    const duration = item.effortEstimate && item.effortEstimate > 0 ? item.effortEstimate : 30;
    const plannedBlocks = scheduled.map(({ block }) => {
      const start = new Date(`${block.date}T${block.time}:00`);
      return { start: start.toISOString(), end: new Date(start.getTime() + block.duration * 60_000).toISOString() };
    });
    const slot = calendarChecked ? findAvailableSlot({ days: weekDays, durationMinutes: duration, busyWindows, plannedBlocks }) : null;
    if (slot) {
      const time = `${String(slot.startsAt.getHours()).padStart(2, '0')}:${String(slot.startsAt.getMinutes()).padStart(2, '0')}`;
      startSchedule(item.id, localDate(slot.startsAt), time, duration);
      showToast('Suggested time is ready. Review it before saving.');
      return;
    }
    startSchedule(item.id);
    showToast(calendarChecked
      ? 'No open slot matched. Choose a time manually.'
      : googleConnected
        ? 'Choose a time manually, or check availability in Time for a calendar-aware suggestion.'
        : 'Choose a time manually, or connect Google Calendar to check free time.');
  }
  function saveDetail(): boolean {
    if (!detail) return false;
    const estimate = detailDraft.effortEstimate;
    if (estimate != null && (!Number.isInteger(estimate) || estimate < 0 || estimate > 10080)) { showToast('Estimated effort must be between 0 and 10,080 whole minutes.'); return false; }
    const customFields = detailDraft.customFields?.filter((field) => field.label.trim() || field.value.trim())
      .map((field) => ({ ...field, label: field.label.trim() || 'Untitled field' }));
    const next = itemsRef.current.map((item) => {
      if (item.id !== detail.id) return item;
      const changed = { ...item, ...detailDraft, title: detailDraft.title?.trim() || item.title, ...(customFields ? { customFields } : {}) };
      const aiInterpretation = item.aiInterpretation?.canUndo && (changed.title !== item.title || changed.kind !== item.kind || changed.horizon !== item.horizon)
        ? { ...item.aiInterpretation, canUndo: false } : changed.aiInterpretation;
      return normalize({ ...changed, aiInterpretation, updatedAt: new Date().toISOString(), syncState: 'pending' });
    });
    return persist(next, 'Thought updated.');
  }
  async function undoAIInterpretation() {
    if (!detail?.remoteId || detail.version == null || !detail.aiInterpretation?.canUndo) return;
    try {
      const restored = await syncClient.current?.undoAIInterpretation(detail.remoteId, detail.version);
      if (!restored) return;
      persist(itemsRef.current.map((item) => item.id === detail.id ? normalize({ ...item, ...restored, blocks: item.blocks }) : item), 'AI suggestion undone. Your original thought is unchanged.');
    } catch (error) { showToast(error instanceof Error ? error.message : 'Could not undo this AI suggestion. Reconnect and try again.'); }
  }
  function scheduleBlock(intentionId: string, date: string, time: string, duration: number): boolean {
    const item = itemsRef.current.find((entry) => entry.id === intentionId); if (!item) return false;
    const start = new Date(`${date}T${time}:00`); if (Number.isNaN(start.getTime())) return false;
    const block: Block = { id: id(), date, time, duration, syncState: 'pending' };
    updateItem(intentionId, (current) => ({ ...current, blocks: [...(current.blocks ?? []), block], status: 'planned' }), 'Time set aside.');
    return true;
  }
  function saveSchedule(event: FormEvent) {
    event.preventDefault();
    let target = scheduleTarget;
    if (!target) { const candidate = activeItems.find((item) => item.status !== 'completed'); if (!candidate) { showToast('Save an intention before planning time.'); return; } target = candidate.id; }
    if (!scheduleBlock(target, scheduleDate, scheduleTime, scheduleDuration)) { showToast('Choose a valid date and time.'); return; }
    setScheduleOpen(false);
  }
  function removeBlock(itemId: string, blockId: string, skipConfirm = false) {
    const item = itemsRef.current.find((entry) => entry.id === itemId); const block = item?.blocks?.find((entry) => entry.id === blockId); if (!item || !block) return;
    if (!skipConfirm && block.externalEventId && !window.confirm('Remove this time from ClearHead? The Google Calendar event will remain in Google.')) return;
    updateItem(itemId, (current) => ({ ...current, blocks: (current.blocks ?? []).filter((entry) => entry.id !== blockId), status: current.status === 'planned' && (current.blocks?.length ?? 0) <= 1 ? 'ready' : current.status }), 'Time block removed.');
  }
  // flush() no-ops immediately if another flush is already running (it just flags
  // flushAgain and returns), so a single "flush then recheck" can race ahead of the
  // in-progress flush and the follow-up it queues. Give it a few real chances instead
  // of giving up after one.
  async function awaitBlockRemoteId(itemId: string, blockId: string): Promise<{ item: Intention; block: Block & { remoteId: string } } | null> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const item = itemsRef.current.find((entry) => entry.id === itemId);
      const block = item?.blocks?.find((entry) => entry.id === blockId);
      if (item && block?.remoteId) return { item, block: block as Block & { remoteId: string } };
      if (attempt === 3) break;
      try { await syncClient.current?.flush(); } catch { /* retry below */ }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return null;
  }
  async function addCalendarEvent(itemId: string, blockId: string, skipConfirm = false) {
    const item = itemsRef.current.find((entry) => entry.id === itemId); const block = item?.blocks?.find((entry) => entry.id === blockId); if (!item || !block) return;
    if (!calendarAccounts.length) { await connectCalendar(); return; }
    // Voice-driven adds already get a verbal confirmation before calling this with
    // skipConfirm=true and expect the push to complete synchronously, so they need the
    // remoteId ready right away - the wizard, by contrast, should open instantly and only
    // wait for the remoteId at final submit time (confirmAddCalendarEvent already does
    // this), since by then the block has had the whole wizard interaction to finish syncing.
    if (skipConfirm) {
      if (!block.remoteId && !(await awaitBlockRemoteId(itemId, blockId))) { showToast('This time is still syncing. Try again in a moment.'); return; }
      const primary = calendarAccounts.find((account) => account.provider === 'google_calendar') ?? calendarAccounts[0];
      await confirmAddCalendarEvent(itemId, blockId, undefined, undefined, [primary.id]);
      return;
    }
    setCalendarConfirm({ itemId, blockId });
  }
  async function confirmAddCalendarEvent(itemId: string, blockId: string, title?: string, description?: string, integrationIds?: string[]) {
    setCalendarConfirm(null);
    const targets = integrationIds ?? calendarAccounts.map((account) => account.id);
    if (!targets.length) { showToast('Connect a calendar first.'); return; }
    const resolved = await awaitBlockRemoteId(itemId, blockId);
    if (!resolved) { showToast('This time is still syncing. Try again in a moment.'); return; }
    const { item, block } = resolved;
    try {
      const result = await syncClient.current?.createCalendarPushes(block.remoteId, targets, title, description); if (!result) return;
      const synced = result.pushes.filter((push) => push.status === 'synced');
      const first = synced[0];
      updateItem(itemId, (current) => ({ ...current, blocks: (current.blocks ?? []).map((entry) => entry.id === blockId
        // The server only sets the primary slot on a block's first-ever push; mirror that
        // here so a second push (to a different calendar) doesn't visually override it.
        ? (entry.externalProvider || !first ? entry : { ...entry, externalProvider: first.provider ?? undefined, externalEventId: first.externalEventId ?? undefined, externalLink: first.externalUrl ?? undefined, syncState: 'synced' })
        : entry) }));
      const failed = result.pushes.length - synced.length;
      showToast(synced.length ? `Added to ${synced.length} calendar${synced.length === 1 ? '' : 's'}.${failed ? ` ${failed} failed.` : ''}` : 'Could not add this event.');
    } catch (error) { showToast(error instanceof Error ? error.message : 'Could not add this event.'); }
  }
  function connectCalendar() { changeView('connections'); }
  async function refreshAvailability(range?: { start: Date; end: Date }): Promise<Array<{ start: string; end: string }> | null> {
    try {
      const ownerId = userId;
      const start = range?.start ?? (() => { const date = new Date(); date.setDate(date.getDate() - date.getDay()); date.setHours(0, 0, 0, 0); return date; })();
      const end = range?.end ?? dateShift(start, 7);
      const result = await syncClient.current?.calendarAvailability(start.toISOString(), end.toISOString(), Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
      if (activeUserId.current !== ownerId) return null;
      const busy = result?.busy ?? []; setBusyWindows(busy); setBusyWindowRange({ start: localDate(start), end: localDate(end), checkedAt: new Date().toISOString() });
      setAvailabilityText(`${busy.length} busy ${busy.length === 1 ? 'window' : 'windows'} in the checked period. Event titles are not read.`); showToast('Free/busy availability refreshed.');
      return busy;
    } catch (error) { showToast(error instanceof Error ? error.message : 'Could not read calendar availability.'); return null; }
  }
  // Every connected Google/Outlook account (not just one, and not just "the primary"),
  // triggered from the Time tab's refresh button - distinct from refreshAvailability,
  // which only re-reads Google free/busy windows for the visible range.
  async function syncAllCalendars() {
    if (!calendarAccounts.length) return;
    const outcomes = await Promise.all(calendarAccounts.map((account) => syncClient.current?.syncCalendarNow(account.id).then((result) => result.queued).catch(() => false)));
    const queuedIds = calendarAccounts.filter((_, index) => outcomes[index]).map((account) => account.id);
    markCalendarSyncing(queuedIds);
    showToast(queuedIds.length ? `Sync started for ${queuedIds.length} of ${calendarAccounts.length} connected calendar${calendarAccounts.length === 1 ? '' : 's'}.` : 'Could not start calendar sync. Try again.');
  }
  // Both halves of the Time tab's refresh: an immediate live free/busy read (fast, for the
  // "N busy windows" summary) and a background calendar sync (slow - the job that actually
  // creates/updates the matching card for a given event, tracked via syncingCalendarAccounts
  // so the refresh button can keep showing progress until it really lands).
  function refreshCalendar(range: { start: Date; end: Date }) {
    void syncAllCalendars();
    void refreshAvailability(range);
  }
  function updatePreferences(next: Preferences) {
    setPrefs(next);
    if (!userId) return;
    try {
      localStorage.setItem(`clearhead-preferences-v1:${userId}`, JSON.stringify(next));
      const remotePreferences: UserPreferences = { aiInterpretationEnabled: next.aiInterpretationEnabled, reduceMotion: next.reduceMotion, suggestionsEnabled: next.suggestions, suggestionLimit: next.nudgeLimit, quietStart: next.quietStart, quietEnd: next.quietEnd, timezone: next.timezone, pinnedTimezones: next.pinnedTimezones };
      void syncClient.current?.setPreferences(remotePreferences).catch((error) => showToast(error instanceof Error ? error.message : 'Preference saved here; sync will retry.'));
    }
    catch { showToast('ClearHead could not save this preference on your device.'); }
  }

  async function toggleWebPush() {
    const client = syncClient.current;
    if (!client || webPushBusy) return;
    setWebPushBusy(true); setWebPushMessage('');
    try {
      if (webPushSubscribed) {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await client.disableWebPush(subscription.endpoint);
          await subscription.unsubscribe();
        }
        setWebPushSubscribed(false); setWebPushMessage('Browser reminders are off.');
        return;
      }
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        setWebPushMessage('This browser does not support push reminders. On iPhone or iPad, install ClearHead to your Home Screen first.');
        return;
      }
      const status = await client.getWebPushConfig();
      if (!status.publicKey) { setWebPushMessage('Browser reminders are not configured on this server yet.'); return; }
      if (Notification.permission === 'denied') { setWebPushMessage('Notifications are blocked in your browser settings.'); return; }
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (permission !== 'granted') { setWebPushMessage('Allow notifications in your browser to turn on reminders.'); return; }
      const registration = await navigator.serviceWorker.ready;
      const padding = '='.repeat((4 - status.publicKey.length % 4) % 4);
      const applicationServerKey = Uint8Array.from(atob(status.publicKey.replace(/-/g, '+').replace(/_/g, '/') + padding), (character) => character.charCodeAt(0));
      const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('The browser returned an incomplete push subscription.');
      await client.enableWebPush({ endpoint: json.endpoint, expirationTime: json.expirationTime ?? null, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
      setWebPushSubscribed(true); setWebPushMessage('Browser reminders are on. Snoozed thoughts will return as a gentle reminder.');
    } catch (error) {
      setWebPushMessage(error instanceof Error ? error.message : 'Could not update browser reminders.');
    } finally { setWebPushBusy(false); }
  }
  async function recordSuggestionFeedback(clientId: string, state: SuggestionFeedback['state'], snoozedUntil: string | null = null, message?: string) {
    try {
      const client = syncClient.current;
      if (!client) { showToast('Your space is still connecting. Try that again in a moment.'); return; }
      await client.setSuggestionFeedback(clientId, state, snoozedUntil);
      if (message) showToast(message);
    } catch (error) {
      showToast(error instanceof Error ? `Could not save this feedback on this device: ${error.message}` : 'Could not save this feedback on this device. Try again.');
    }
  }
  async function toggleAI(enabled: boolean) {
    updatePreferences({ ...prefs, aiInterpretationEnabled: enabled });
    showToast(enabled ? 'AI interpretation enabled.' : 'AI interpretation disabled.');
  }
  async function exportData() {
    try {
      const data = await syncClient.current?.exportData();
      const blob = new Blob([JSON.stringify(data ?? {}, null, 2)], { type: 'application/json' });
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'clearhead-export.json'; link.click(); URL.revokeObjectURL(link.href);
      const scope = (data as { exportScope?: string } | undefined)?.exportScope;
      showToast(scope === 'device-only' ? 'Device-only export ready · reconnect for your full account history.' : 'Your account export is ready.');
    }
    catch (error) { showToast(error instanceof Error ? error.message : 'Reconnect to export your account.'); }
  }
  async function syncNow() {
    const client = syncClient.current;
    if (!client) { showToast('Sync is still starting. Try again in a moment.'); return; }
    setSyncNowBusy(true);
    try { await client.flush(); }
    finally { setSyncNowBusy(false); }
  }
  async function deleteAccount() {
    if (!window.confirm('Permanently delete your ClearHead account and all synced data? This cannot be undone. If you connected Jira, Atlassian may require you to remove ClearHead from Connected Apps afterward.')) return;
    const client = syncClient.current;
    if (!client) { showToast('Account services are still loading. Try again in a moment.'); return; }
    try {
      const result = await client.deleteAccount();
      const warnings = [...result.externalRevocationWarnings];
      if (!result.localDataCleared) warnings.push('This browser could not clear all saved offline data. Clear this site’s storage in your browser settings.');
      if (warnings.length) window.alert(`Your ClearHead account was deleted.\n\n${warnings.join('\n\n')}`);
    } catch (error) { showToast(error instanceof Error ? error.message : 'Account deletion failed.'); }
  }
  function deleteEverything(skipConfirm = false) { if (!skipConfirm && !window.confirm('Delete all intentions and planned-time details from ClearHead across your devices? This cannot be undone. Any events already created in Google Calendar will remain there.')) return; if (!persist([], 'Your synced space is being cleared.')) return; void syncClient.current?.deleteEverything().catch((error) => showToast(error instanceof Error ? error.message : 'Could not clear your synced space.')); }
  function signOut() { if (window.confirm('Sign out of ClearHead on this device? Your saved intentions remain in your account.')) void syncClient.current?.signOut(); }
  function exportThenClose() { void exportData(); }
  function selectCaptureMode(mode: 'keyboard' | 'microphone') {
    setCaptureInputMode(mode);
    if (mode === 'microphone') { startVoice(); return; }
    setCaptureFocused(true);
    if (recognizing) {
      try { recognizing.stop(); } catch { recognizing.abort?.(); }
      setRecognizing(null);
      setVoiceStatus({ kind: 'notice', text: 'Recording stopped. Your words are ready to edit.' });
    }
  }
  function handleCaptureKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); event.stopPropagation(); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeCaptureFocus(); return; }
    if (event.key !== 'Tab') return;
    const focusable = capturePanelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not([readonly]), summary');
    if (!focusable?.length) return;
    const first = focusable[0]!; const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  function closeCaptureFocus() {
    if (captureSaving) return;
    if (recognizing) {
      recognizing.onresult = null; recognizing.onend = null; recognizing.onerror = null;
      try { recognizing.stop(); } catch { recognizing.abort?.(); }
      setRecognizing(null);
      setVoiceStatus({ kind: 'notice', text: 'Voice capture stopped. Your words are ready to review.' });
    }
    if (dumpTarget) {
      pieceDrafts.current[dumpTarget.itemId] = capture;
      setCapture(captureBeforeDump.current); setDumpTarget(null); setCaptureFocused(false); setCaptureInputMode('keyboard'); setVoiceStatus(null);
      requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.original-actions button')?.focus());
      return;
    }
    changeView('explore');
  }
  function startVoice() {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (recognizing) {
      try { recognizing.stop(); } catch { recognizing.abort?.(); }
      setRecognizing(null);
      setVoiceStatus({ kind: 'notice', text: 'Recording stopped. Your words are ready to review.' });
      return;
    }
    setCaptureFocused(true);
    if (!window.isSecureContext) {
      setVoiceStatus({ kind: 'error', text: 'Voice capture needs a secure page. Open ClearHead on localhost or an HTTPS address.' });
      return;
    }
    if (!Recognition) {
      setVoiceStatus({ kind: 'error', text: 'This browser does not support voice capture. You can still type your thought here.' });
      return;
    }
    voiceBaseCapture.current = capture;
    let voice: SpeechRecognitionLike;
    try { voice = new Recognition(); }
    catch { setVoiceStatus({ kind: 'error', text: 'The microphone could not start. Check site permissions and try again.' }); return; }
    voice.lang = navigator.language || 'en-US'; voice.interimResults = true; voice.continuous = true;
    voice.onresult = (event) => {
      const transcript = Array.from(event.results).map((result) => result[0]?.transcript ?? '').join(' ');
      const combined = appendVoiceTranscript(voiceBaseCapture.current, transcript);
      if (combined.truncated) setVoiceStatus({ kind: 'notice', text: `Voice capture reached ${rawCaptureMaxLength.toLocaleString()} characters. Save this thought, then continue in another.` });
      setCapture(combined.rawCapture);
    };
    voice.onstart = () => setVoiceStatus({ kind: 'listening', text: 'Listening. Speak naturally; your words will appear here.' });
    voice.onerror = (event) => {
      if (event.error === 'aborted') return;
      const message = event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? 'Microphone access is blocked. Allow it for this site in your browser settings, then try again.'
        : event.error === 'audio-capture'
          ? 'No microphone is available. Connect or select one, then try again.'
          : event.error === 'no-speech'
            ? 'I didn’t hear speech. Try again when you’re ready.'
            : event.error === 'network'
              ? 'The browser’s speech service could not connect. Check your connection and try again.'
              : event.error === 'language-not-supported'
                ? `Voice capture does not support ${voice.lang} in this browser. You can type your thought instead.`
                : 'Voice capture stopped unexpectedly. Your written words are still here; try the mic again.';
      setRecognizing(null); setVoiceStatus({ kind: 'error', text: message });
    };
    voice.onend = () => {
      setRecognizing(null);
      setVoiceStatus((current) => current?.kind === 'error' ? current : { kind: 'notice', text: 'Recording ended. Your words are ready to review.' });
    };
    setVoiceStatus({ kind: 'listening', text: 'Starting your microphone…' });
    setRecognizing(voice);
    try { voice.start(); }
    catch (error) {
      setRecognizing(null);
      const name = error instanceof DOMException ? error.name : '';
      setVoiceStatus({ kind: 'error', text: name === 'NotAllowedError' ? 'Microphone access is blocked. Allow it for this site in your browser settings, then try again.' : 'The microphone could not start. Check site permissions and try again.' });
    }
  }
  async function clearCompleted() { const completed = activeItems.filter((item) => item.status === 'completed'); if (!completed.length) return; const next = itemsRef.current.filter((item) => item.status !== 'completed'); persist(next, 'Completed thoughts removed from this view.'); }

  if (!ready) return <main className="auth-screen"><p>Opening your space…</p></main>;
  if (!authClient) return <main className="auth-screen"><section className="auth-card"><Brand /><h1>ClearHead needs setup</h1><p>Add the public Supabase URL and key to <code>apps/web/.env</code>, then restart the web app.</p></section></main>;
  if (!session) return <SignIn client={authClient} />;

  const deterministicCues: SpaceCue[] = [
    ...(unalignedOpenCount > 0 ? [{
      icon: 'goal' as const,
      text: `${unalignedOpenCount} open intention${unalignedOpenCount === 1 ? '' : 's'} ${unalignedOpenCount === 1 ? "isn't" : "aren't"} tied to a goal yet`,
      actionLabel: 'Align', actionIcon: 'align' as const, onAction: () => changeView('align'),
    }] : []),
    ...(unscheduledNearTerm.length ? [{
      icon: 'time' as const,
      text: `${unscheduledNearTerm.length} intention${unscheduledNearTerm.length === 1 ? '' : 's'} marked for ${unscheduledNearTerm.some((item) => item.horizon === 'today') ? 'today' : 'this week'} ${unscheduledNearTerm.length === 1 ? "isn't" : "aren't"} scheduled yet`,
      actionLabel: 'Schedule', actionIcon: 'time' as const, onAction: () => startSchedule(unscheduledNearTerm[0]!.id),
    }] : []),
    ...(openCount > 0 && freeDaysAhead > 0 ? [{
      icon: 'calendar' as const,
      text: `${freeDaysAhead} day${freeDaysAhead === 1 ? '' : 's'} this week ${freeDaysAhead === 1 ? 'has' : 'have'} nothing scheduled`,
      actionLabel: 'Plan', actionIcon: 'time' as const, onAction: () => changeView('time'),
    }] : []),
  ];
  const doneToday = items.filter((item) => item.status === 'completed' && localDate(new Date(item.updatedAt)) === todayString);
  const todayPlan = scheduled.filter(({ block }) => block.date === todayString);
  const alignedTodayIds = new Set(todayPlan.flatMap(({ item }) => alignedTo(item.id).map((entry) => entry.id)));
  const alignedToday: SpaceAlignedGoal[] = alignments.filter((entry) => entry.kind === 'reason' && alignedTodayIds.has(entry.id))
    .map((entry) => ({ id: entry.id, title: entry.title, icon: alignmentTypes[entry.kind].icon, taskCount: todayPlan.filter(({ item }) => entry.intentionIds.includes(item.id)).length }));
  const goalsTouchedToday = alignments.filter((entry) => !entry.archived && entry.kind === 'goal'
    && entry.intentionIds.some((id) => doneToday.some((item) => item.id === id))).length;
  const gistBase = todayPlan.length ? `${doneToday.length} of ${todayPlan.length} planned done today` : doneToday.length ? `${doneToday.length} done today` : 'Nothing done or planned yet today';
  const gist = goalsTouchedToday ? `${gistBase}, ${goalsTouchedToday} goal${goalsTouchedToday === 1 ? '' : 's'} touched.` : `${gistBase}.`;
  const coachActionMeta: Record<SpaceCoachCard['action'], { icon: UiIconName; actionIcon: UiIconName; label: string; onAction: () => void } | null> = {
    align: { icon: 'goal', actionIcon: 'align', label: 'Align', onAction: () => changeView('align') },
    time: { icon: 'time', actionIcon: 'time', label: 'Schedule', onAction: () => changeView('time') },
    explore: { icon: 'explore', actionIcon: 'explore', label: 'Review', onAction: () => changeView('explore') },
    none: null,
  };
  const aiCues: SpaceCue[] = (spaceCoachCards ?? []).map((card) => {
    const meta = coachActionMeta[card.action];
    return { icon: meta?.icon ?? 'suggestions', text: card.text, actionLabel: meta?.label, actionIcon: meta?.actionIcon, onAction: meta?.onAction, aiSuggested: true };
  });
  const spaceCues: SpaceCue[] = [...aiCues, ...deterministicCues];
  const dayOfYear = Math.floor((today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / 86400000);
  const spaceQuote = spaceQuotes[dayOfYear % spaceQuotes.length]!;

  const railCollapseIcon: UiIconName = navCollapsed ? (navPosition === 'left' ? 'chevron-right' : 'chevron-left') : (navPosition === 'left' ? 'chevron-left' : 'chevron-right');

  const voiceActions: VoiceActions = {
    listIntentions: (filter) => (filter === 'archived' ? items.filter((item) => item.status === 'archived') : filter === 'trashed' ? items.filter((item) => item.status === 'trashed') : filter === 'all' ? items : activeItems)
      .map((item) => ({ id: item.id, title: item.title, kind: item.kind, status: item.status, horizon: item.horizon ?? null, updatedAt: item.updatedAt })),
    getIntention: (itemId) => {
      const item = items.find((entry) => entry.id === itemId); if (!item) return null;
      return {
        id: item.id, title: item.title, kind: item.kind, status: item.status, horizon: item.horizon ?? null, updatedAt: item.updatedAt,
        rawCapture: item.rawCapture, intent: item.intent ?? null, purpose: item.purpose ?? null, desiredOutcome: item.desiredOutcome ?? null,
        roughPlan: item.roughPlan ?? null, effortEstimate: item.effortEstimate ?? null,
        blocks: (item.blocks ?? []).map((block) => ({ id: block.id, date: block.date, time: block.time, duration: block.duration, externalEventId: block.externalEventId })),
      };
    },
    listRelationships: () => relationships.map((link) => ({ id: link.id, fromId: link.fromClientId, fromTitle: link.fromTitle, toId: link.toClientId, toTitle: link.toTitle, relation: link.relation })),
    getPreferences: () => ({ ...prefs }),
    listConnections: () => connectionStatuses.map((status) => ({ provider: status.provider, connected: status.connected })),
    checkCalendarAvailability: async (startDate, endDate) => {
      const start = new Date(`${startDate}T00:00:00`); const end = new Date(`${endDate}T00:00:00`);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { ok: false, error: 'Those dates were not valid.' };
      const busy = await refreshAvailability({ start, end });
      if (busy === null) return { ok: false, error: 'Could not read calendar availability. Is Google Calendar connected?' };
      return { ok: true, message: `${busy.length} busy ${busy.length === 1 ? 'window' : 'windows'} in that range.`, busy };
    },

    createIntention: async (rawCapture) => {
      const created = await createIntentionFromVoice(rawCapture);
      if (!created) return { ok: false, error: 'Could not capture that just now.' };
      return { ok: true, id: created.id, title: created.title, message: `Added “${created.title}”.` };
    },
    updateIntention: (itemId, patch) => {
      const item = items.find((entry) => entry.id === itemId); if (!item) return { ok: false, error: 'No intention with that id.' };
      updateItem(itemId, (current) => ({ ...current, ...patch }), 'Thought updated.');
      return { ok: true, id: itemId, title: (patch.title as string | undefined) ?? item.title, message: `Updated “${(patch.title as string | undefined) ?? item.title}”.` };
    },
    archiveIntention: (itemId) => {
      const item = items.find((entry) => entry.id === itemId); if (!item) return { ok: false, error: 'No intention with that id.' };
      updateItem(itemId, (current) => ({ ...current, status: 'archived' }), 'Thought archived.');
      return { ok: true, id: itemId, title: item.title, message: `Archived “${item.title}”.` };
    },
    restoreIntention: (itemId) => {
      const item = items.find((entry) => entry.id === itemId); if (!item) return { ok: false, error: 'No intention with that id.' };
      updateItem(itemId, (current) => ({ ...current, status: 'ready' }), 'Thought restored to your space.');
      return { ok: true, id: itemId, title: item.title, message: `Restored “${item.title}”.` };
    },
    trashIntention: (itemId) => {
      const item = items.find((entry) => entry.id === itemId); if (!item) return { ok: false, error: 'No intention with that id.' };
      updateItem(itemId, (current) => ({ ...current, status: 'trashed' }), 'Moved to Trash.');
      return { ok: true, id: itemId, title: item.title, message: `Moved “${item.title}” to Trash.` };
    },
    restoreFromTrash: (itemId) => {
      const item = items.find((entry) => entry.id === itemId); if (!item) return { ok: false, error: 'No intention with that id.' };
      updateItem(itemId, (current) => ({ ...current, status: 'ready' }), 'Thought restored to your space.');
      return { ok: true, id: itemId, title: item.title, message: `Restored “${item.title}” from Trash.` };
    },

    scheduleTimeBlock: (intentionId, date, time, durationMinutes) => {
      const item = items.find((entry) => entry.id === intentionId);
      const ok = scheduleBlock(intentionId, date, time, durationMinutes);
      return ok
        ? { ok: true, id: intentionId, title: item?.title, message: `Set aside time for “${item?.title ?? 'that'}”.` }
        : { ok: false, error: 'Could not schedule that time. Check the intention id, date, and time.' };
    },
    removeTimeBlock: (intentionId, blockId) => {
      const item = items.find((entry) => entry.id === intentionId); const block = item?.blocks?.find((entry) => entry.id === blockId);
      if (!item || !block) return { ok: false, error: 'No matching time block.' };
      const hadExternalEvent = Boolean(block.externalEventId);
      removeBlock(intentionId, blockId, true);
      return { ok: true, id: intentionId, title: item.title, message: hadExternalEvent ? 'Removed from ClearHead. The Google Calendar event remains in Google.' : 'Time block removed.' };
    },

    createRelationship: async (fromId, toId, relation) => {
      await createRelationship(fromId, toId, relation as IntentionRelationship['relation']);
      return { ok: true, message: 'Connected.' };
    },
    deleteRelationship: async (relationshipId) => {
      await deleteRelationship(relationshipId);
      return { ok: true, message: 'Connection removed.' };
    },

    updatePreferences: (patch) => {
      const { suggestionsEnabled, ...rest } = patch as { suggestionsEnabled?: boolean } & Record<string, unknown>;
      updatePreferences({ ...prefs, ...rest, ...(suggestionsEnabled !== undefined ? { suggestions: suggestionsEnabled } : {}) } as Preferences);
      return { ok: true, message: 'Preferences updated.' };
    },
    setSuggestionFeedback: async (clientId, state, snoozedUntil) => {
      await recordSuggestionFeedback(clientId, state as SuggestionFeedback['state'], snoozedUntil);
      return { ok: true, message: 'Got it.' };
    },

    navigateView: (targetView, opts) => {
      if (targetView === 'account') openAccount((opts.accountTab as AccountTab) || 'profile');
      else changeView(targetView as View);
      if (opts.intentionId) setDetailId(opts.intentionId);
      return { ok: true };
    },

    addCalendarEvent: async (intentionId, blockId, confirm) => {
      if (!confirm) return { ok: false, needsConfirmation: true, message: 'Describe what will happen and ask the user to confirm first.' };
      if (!googleConnected) { changeView('connections'); return { ok: false, message: 'Google Calendar is not connected yet — opened Connections so the user can connect it.' }; }
      const item = items.find((entry) => entry.id === intentionId);
      await addCalendarEvent(intentionId, blockId, true);
      return { ok: true, id: intentionId, title: item?.title, message: `Added “${item?.title ?? 'that'}” to Google Calendar.` };
    },
    deleteAllIntentions: (confirm) => {
      if (!confirm) return { ok: false, needsConfirmation: true, message: 'Warn the user this is irreversible and ask them to confirm first.' };
      deleteEverything(true);
      return { ok: true, message: 'All intentions deleted.' };
    },
    disconnectIntegration: async (provider, confirm) => {
      if (!confirm) return { ok: false, needsConfirmation: true, message: 'Warn the user this disconnects the provider and ask them to confirm first.' };
      if (!oauthProviders.includes(provider as OAuthProvider) && provider !== 'icloud') return { ok: false, error: 'Unknown provider.' };
      // A provider can have more than one connected account now; disconnect the
      // longest-connected one when the voice command only names the provider.
      const account = connectionStatuses.find((status) => status.provider === connectionProviderId(provider as ConnectionProvider));
      if (!account) return { ok: false, error: 'That provider is not connected.' };
      try {
        const result = await syncClient.current?.disconnectIntegration(account.id);
        return { ok: true, message: result?.revocationWarning ?? 'Disconnected.' };
      } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Could not disconnect that provider.' }; }
    },
    requestAccountDeletion: () => {
      openAccount('preferences');
      return { ok: true, message: "Opened account preferences — the user needs to tap Delete account there to confirm. This never deletes anything by itself." };
    },
  };

  return <div className={`app-shell ${captureFocused ? 'dumps-view' : ''}`}>
    {(navPosition === 'top' || navPosition === 'bottom') && <nav className={`nav-bar nav-bar-${navPosition}`} aria-label="Main navigation">
      <a className="brand" href="#space" onClick={(event) => { event.preventDefault(); changeView('space'); }}><span className="brand-mark"><i /><i /><i /></span><span>clearhead</span></a>
      {navPosition === 'bottom'
        ? <div className="nav-bar-items">
            {nav.slice(0, 3).map(navBarButton)}
            <button type="button" className="dump-action" onClick={openDumpNow} title="Dump now"><BrainDumpIcon /><span>Dump now</span></button>
            {nav.slice(3).map(navBarButton)}
          </div>
        : <>
            <div className="nav-bar-items">{nav.map(navBarButton)}</div>
            <button type="button" className="dump-action" onClick={openDumpNow} title="Dump now"><BrainDumpIcon /><span>Dump now</span></button>
          </>}
    </nav>}
    {(navPosition === 'left' || navPosition === 'right') && <aside className={`sidebar ${navCollapsed ? 'collapsed' : ''}`} aria-label="Main navigation">
      <div className="sidebar-head">
        <a className="brand" href="#space" onClick={(event) => { event.preventDefault(); changeView('space'); }}><span className="brand-mark"><i /><i /><i /></span><span>clearhead</span></a>
        <button type="button" className="nav-collapse-toggle" onClick={toggleNavCollapsed} aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'} title={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}><UiIcon name={railCollapseIcon} /></button>
      </div>
      <nav className="main-nav">{nav.slice(0, 4).map((entry) => <button key={entry.id} className={`nav-item ${view === entry.id ? 'active' : ''}`} onClick={() => changeView(entry.id)} title={entry.label}><span className="nav-icon">{entry.icon}</span><span>{entry.label}</span>{entry.id === 'explore' ? <span className="nav-count">{activeItems.length}</span> : null}</button>)}</nav>
      <div className="sidebar-divider" />{nav.slice(4).map((entry) => <button key={entry.id} className={`nav-item ${entry.id === 'suggestions' ? 'suggestion-link' : ''} ${view === entry.id ? 'active' : ''}`} onClick={() => changeView(entry.id)} title={entry.label}><span className="nav-icon">{entry.icon}</span><span>{entry.label}</span>{entry.id === 'suggestions' && suggestions.length > 0 ? <span className="suggestion-dot" /> : null}</button>)}
      <div className="sidebar-spacer" />
      <div className="sidebar-footer">
        <AccountMenu compact={navCollapsed} name={profileName} email={session.user.email ?? ''} onSelect={(action) => {
          if (action === 'sign-out') signOut();
          else openAccount(action);
        }} />
        <div className="sidebar-footer-theme">
          <button className="theme-toggle" type="button" onClick={toggleTheme} role="switch" aria-label={`Switch to ${isDarkFamily(theme) ? 'light' : 'dark'} theme`} aria-checked={isDarkFamily(theme)} title={`Switch to ${isDarkFamily(theme) ? 'light' : 'dark'} theme`}><UiIcon name="theme-light" className="theme-toggle-icon theme-toggle-icon-light" /><UiIcon name="theme-dark" className="theme-toggle-icon theme-toggle-icon-dark" /></button>
        </div>
      </div>
    </aside>}
    {(navPosition === 'left' || navPosition === 'right') && <button type="button" className="search-fab" aria-label="Search your thoughts" title={`Search your thoughts (${searchShortcutLabel})`} onClick={() => setPaletteOpen(true)}><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.75" cy="8.75" r="6" /><path d="m17 17-4-4" /></svg></button>}
    <main className="main-area">
      <header className="topbar"><button className="mobile-brand" onClick={() => changeView('space')}><span className="brand-mark"><i /><i /><i /></span>clearhead</button><div className="topbar-actions"><button type="button" className="global-search-trigger" aria-label="Search your thoughts" title="Search your thoughts" onClick={() => setPaletteOpen(true)}><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.75" cy="8.75" r="6" /><path d="m17 17-4-4" /></svg><span className="global-search-placeholder">Search</span><kbd>{searchShortcutLabel}</kbd></button><button className="theme-toggle" type="button" onClick={toggleTheme} role="switch" aria-label={`Switch to ${isDarkFamily(theme) ? 'light' : 'dark'} theme`} aria-checked={isDarkFamily(theme)} title={`Switch to ${isDarkFamily(theme) ? 'light' : 'dark'} theme`}><UiIcon name="theme-light" className="theme-toggle-icon theme-toggle-icon-light" /><UiIcon name="theme-dark" className="theme-toggle-icon theme-toggle-icon-dark" /></button><AccountMenu compact name={profileName} email={session.user.email ?? ''} onSelect={(action) => {
        if (action === 'sign-out') signOut();
        else openAccount(action);
      }} /></div></header>
      <div className="mobile-tabs" aria-label="Perspectives"><button type="button" className="dump-action" onClick={openDumpNow}><BrainDumpIcon /><span>Dump now</span></button>{nav.filter((entry) => ['explore', 'align', 'time', 'connections'].includes(entry.id)).map((entry) => <button key={entry.id} type="button" className={`mobile-tab ${view === entry.id ? 'active' : ''}`} aria-current={view === entry.id ? 'page' : undefined} onClick={() => changeView(entry.id)}><span className="mobile-tab-icon">{entry.icon}</span>{entry.id === 'connections' ? 'Connect' : entry.label}</button>)}</div>
      <div className="content-wrap" hidden={Boolean(detail)}>
        {accountTab && <AccountSettingsPage activeTab={accountTab} onTabChange={openAccount}
          profile={<div className="settings-content"><h2>Profile</h2><p className="settings-lede">Your ClearHead account.</p>
        <div className="account-profile-heading"><span className="avatar" aria-hidden="true">{(profileName || session.user.email || 'V')[0]?.toUpperCase() ?? 'V'}</span><b>{profileName || 'Your space'}</b></div>
        <Setting title="Name" detail="Shown in your sidebar, and used to greet you in your Space"><input type="text" maxLength={60} aria-label="Your name" placeholder="Add your name" value={profileName} onChange={(event) => setProfileName(event.target.value)} onBlur={() => void saveProfileName()} /></Setting>
        <dl className="account-profile-details"><div><dt>Email address</dt><dd>{session.user.email ?? 'Not provided'}</dd></div><div><dt>Member since</dt><dd>{session.user.created_at ? new Date(session.user.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : 'Not available'}</dd></div></dl>
      </div>}
          personalization={<div className="settings-content"><h2>Personalization</h2><p className="settings-lede">Make this space feel like yours.</p>
        <Setting title="Appearance" detail="Choose a theme for this device, or follow your system setting"><span className="select-field-control"><select aria-label="Appearance" value={themeChoice} onChange={(event) => setThemePreference(event.target.value as ThemeChoice)}>{themeChoices.map((value) => <option key={value} value={value}>{themeChoiceLabels[value]}</option>)}</select><UiIcon name="chevron-down" className="select-field-chevron" /></span></Setting>
        <div className="theme-picker">
          <div className="theme-picker-head"><b>Color theme</b><small>Pick a palette — it adapts to light and dark automatically</small></div>
          <div className="theme-swatch-grid" role="group" aria-label="Color theme">{themes.map((entry) => <button key={entry.id} type="button" className={`theme-swatch-choice ${themeName === entry.id ? 'selected' : ''}`} aria-pressed={themeName === entry.id} onClick={() => setThemeName(entry.id)} title={entry.name}><span className="theme-swatch-preview" aria-hidden="true">{entry.swatch.map((color, index) => <i key={index} style={{ background: color }} />)}</span><span className="theme-swatch-name">{entry.name}</span></button>)}</div>
        </div>
        <Setting title="Reduced motion" detail="Keep transitions and the brain animation still"><label className="switch"><input type="checkbox" aria-label="Reduced motion" checked={prefs.reduceMotion} onChange={(event) => updatePreferences({ ...prefs, reduceMotion: event.target.checked })} /><span /></label></Setting>
        <Setting title="Assistant name" detail="What should your voice assistant call itself?"><input type="text" maxLength={30} aria-label="Assistant name" value={agentSettings.name} placeholder={voiceAgentDefaultName} onChange={(event) => setAgentSettings({ ...agentSettings, name: event.target.value })} onBlur={(event) => { if (!event.target.value.trim()) setAgentSettings({ ...agentSettings, name: voiceAgentDefaultName }); }} /></Setting>
        <Setting title="Assistant tone" detail="How your assistant should sound when it talks with you"><span className="select-field-control"><select aria-label="Assistant tone" value={agentSettings.tone} onChange={(event) => setAgentSettings({ ...agentSettings, tone: event.target.value as VoiceAgentTone })}>{voiceAgentTones.map((value) => <option key={value} value={value}>{voiceAgentToneLabels[value]}</option>)}</select><UiIcon name="chevron-down" className="select-field-chevron" /></span></Setting>
        <Setting title="Assistant voice" detail="Pick a voice, then test it before you commit">
          <VoicePicker value={agentSettings.voice} onChange={(voice) => setAgentSettings({ ...agentSettings, voice })} agentName={agentSettings.name || voiceAgentDefaultName} apiUrl={API} getAccessToken={async () => (await authClient?.auth.getSession())?.data.session?.access_token ?? null} />
        </Setting>
        <Setting title="Navigation position" detail="Choose where Space, Explore, Align, Time, Suggestions, and Connections live on screen">
          <div className="nav-position-choices" role="group" aria-label="Navigation position">{(['left', 'top', 'right', 'bottom'] as const).map((value) => <button key={value} type="button" className={`nav-position-choice ${navPosition === value ? 'selected' : ''}`} aria-pressed={navPosition === value} onClick={() => setNavPosition(value)}>{value[0]!.toUpperCase() + value.slice(1)}</button>)}</div>
        </Setting>
        {(navPosition === 'left' || navPosition === 'right') && <Setting title="Collapse navigation" detail="Show icons only to save space; expand it again any time"><label className="switch"><input type="checkbox" aria-label="Collapse navigation" checked={navCollapsed} onChange={toggleNavCollapsed} /><span /></label></Setting>}
      </div>}
          preferences={<div className="settings-content"><h2>Preferences</h2><p className="settings-lede">Your thoughts sync securely across your devices. Choose what feels right.</p><Setting title="Browser reminders" detail={webPushMessage || (webPushSubscribed ? 'Receive a gentle browser notification when a snoozed thought returns.' : 'Opt in to a private reminder when a snoozed thought returns.')}><button className="outline-button" disabled={webPushBusy} onClick={() => void toggleWebPush()}>{webPushBusy ? 'Updating…' : webPushSubscribed ? 'Turn off' : 'Turn on'}</button></Setting><Setting title="Quiet hours" detail={prefs.quietStart ? `Snooze reminders pause from ${prefs.quietStart} to ${prefs.quietEnd} (${prefs.timezone || 'device time'}).` : 'Let reminders wait until morning, from 10pm to 8am local time.'}><label className="switch"><input type="checkbox" aria-label="Quiet hours" checked={Boolean(prefs.quietStart)} onChange={(event) => { const enabled = event.target.checked; updatePreferences({ ...prefs, quietStart: enabled ? '22:00' : null, quietEnd: enabled ? '08:00' : null, timezone: enabled ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' : null }); }} /><span /></label></Setting><Setting title="Also show these timezones" detail="See these alongside your own time in the day view, so you can tell what time it is somewhere else at a glance."><TimezonePicker value={prefs.pinnedTimezones} onChange={(pinnedTimezones) => updatePreferences({ ...prefs, pinnedTimezones })} /></Setting><Setting title="Suggestions" detail="Show gentle ideas in your suggestion tray"><label className="switch"><input type="checkbox" aria-label="Suggestions" checked={prefs.suggestions} onChange={(event) => updatePreferences({ ...prefs, suggestions: event.target.checked })} /><span /></label></Setting><Setting title="AI-assisted features" detail="Suggest a title, identify the type, and ask useful follow-up questions. For interpretation, relevant text goes to Laya for preliminary category and timeframe signals, then to OpenAI for the final decision. Brainstorming sends the thought and conversation to OpenAI. On Space, a coaching insight about your recent activity patterns (completions, scheduled time by kind, goal alignment) is generated by OpenAI every few hours and also appears in the voice assistant's chat."><label className="switch"><input type="checkbox" aria-label="AI-assisted features" checked={prefs.aiInterpretationEnabled} onChange={(event) => void toggleAI(event.target.checked)} /><span /></label></Setting><Setting title="Suggestion limit" detail="Limit the number of ideas in your tray"><span className="select-field-control"><select aria-label="Suggestion limit" value={prefs.nudgeLimit} onChange={(event) => updatePreferences({ ...prefs, nudgeLimit: Number(event.target.value) })}><option value={0}>Off</option><option value={1}>1 suggestion</option><option value={2}>2 suggestions</option></select><UiIcon name="chevron-down" className="select-field-chevron" /></span></Setting><div className="settings-actions"><button className="outline-button" onClick={exportThenClose}>Export my thoughts</button><button className="outline-button" onClick={signOut}>Sign out</button><button className="outline-button" onClick={() => void deleteAccount()}>Delete account</button><button className="danger-button" onClick={() => deleteEverything()}>Delete all intentions</button></div><div className="privacy-note"><span>⌑</span><p>Your data is private to your account. AI-assisted features are optional. When enabled, thought interpretation sends relevant text to Laya for preliminary category and timeframe signals, then to OpenAI for the final decision. Brainstorming sends the thought and conversation to OpenAI for replies. Space's coaching insight sends your recent completions, scheduled time by kind, and goal alignment to OpenAI, refreshed every few hours, and also appears in the voice assistant. ClearHead never saves an AI reply into a thought without your edit. Voice transcription uses your browser’s speech service when available. Signed-in crash reports include only platform, error category, and a one-way fingerprint.</p></div></div>}
          syncBackup={<div className="settings-content"><h2>Sync &amp; backup</h2><p className="settings-lede">See whether your thoughts are synced, retry a sync, or download a copy of your ClearHead data.</p><div className={`sync-backup-status ${syncError ? 'has-error' : ''}`} role="status"><span className="sync-backup-indicator"><UiIcon name={syncError ? 'alert' : /waiting|updating|pending/i.test(syncLabel) ? 'time' : 'cloud'} /></span><div><b>{syncLabel}</b><small>{syncError ? 'Your recent changes remain saved on this device. Retry when you have a connection.' : 'Your account syncs across your signed-in devices.'}</small></div></div><div className="sync-backup-actions"><button className="capture-button" type="button" disabled={syncNowBusy || !syncClientReady} onClick={() => void syncNow()}>{syncNowBusy ? 'Syncing…' : 'Sync now'} <span>↻</span></button><button className="outline-button" type="button" onClick={() => void exportData()}>Download backup <span>↓</span></button></div><p className="sync-backup-note">Backups include your saved thoughts and local sync queue. When offline, the download contains data available on this device.</p></div>}
        />}
        <AnimatePresence mode="wait">
        {view === 'space' && <motion.section key="space" className="view active" {...viewMotion}><TabHeader icon="home" title={greeting} tagline={<>“{spaceQuote.text}” <span className="space-quote-author">— {spaceQuote.author}</span></>} action={<button className="text-button" onClick={() => changeView('explore')}>View all intentions <span>↗</span></button>} />{legacyImports.length > 0 ? <div className="legacy-import-banner" role="note"><span>Found {legacyImports.length} thought{legacyImports.length === 1 ? '' : 's'} saved by an earlier version of ClearHead in this browser. They stay on this device unless you import them. Planned times transfer; old Calendar links do not.</span><button className="outline-button" onClick={importLegacyThoughts}>Import into this account</button></div> : null}<div className="space-panel space-stats-card"><SpaceInsights insights={spaceInsights} /></div><div className="space-split"><div className="space-recent"><div className="space-today-card"><p className="space-gist">{gist}</p><div className="space-dump-wrap"><button type="button" className="space-dump-cta" onClick={openDumpNow}><BrainDumpIcon /><span>Dump now</span></button><p className="space-dump-caption">Write it or say it — however it comes out.</p></div></div><SpaceUpcomingPanel upcoming={spaceUpcoming} kindNames={kindNames} kindIcons={kindIcons} onOpenIntention={(id) => setDetailId(id)} onOpenTime={() => changeView('time')} /></div><div className="space-worth-aligned"><SpaceCues cues={spaceCues} /></div><aside className="space-schedule" aria-label="Why(s) of the day, time breakdown, and suggestions"><SpaceAlignedGoals goals={alignedToday} onOpenGoal={() => changeView('align')} /><SpaceTimeBreakdown scheduled={scheduled} today={today} kinds={kinds} kindNames={kindNames} kindIcons={kindIcons} /><SpaceSuggestedPanel suggestions={spaceSuggestions} onOpenIntention={(id) => setDetailId(id)} onOpenSuggestions={() => changeView('suggestions')} /></aside></div></motion.section>}

        {view === 'explore' && <motion.section key="explore" className="view active" {...viewMotion}><TabHeader icon="explore" title="Explore" tagline="Give an idea a little space. Nothing needs to be decided yet." /><div className="toolbar">
          <SegmentedTabs ariaLabel="Explore filter" value={filter} onChange={setFilter} items={['all', 'idea', 'action', 'question', 'meeting', 'note', 'archived', 'trashed'].map((value) => ({
            value,
            label: value === 'all' ? 'All' : value === 'archived' ? 'Archived' : value === 'trashed' ? 'Trash' : kindNames[value] + 's',
            icon: value === 'archived' ? <UiIcon name="archive" /> : value === 'trashed' ? <UiIcon name="trash" /> : value !== 'all' ? <UiIcon name={kindIcons[value] ?? 'kind-unclassified'} /> : undefined,
            count: value === 'all' ? activeItems.length : value === 'archived' ? items.filter((item) => item.status === 'archived').length : value === 'trashed' ? items.filter((item) => item.status === 'trashed').length : activeItems.filter((item) => item.kind === value).length,
          }))} />
          {searchOpen ? <input id="search-input" className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter this list…" autoFocus /> : <button className="search-button" onClick={() => setSearchOpen(true)}>⌕ <span>Filter</span></button>}
          <SegmentedTabs ariaLabel="Explore view" size="sm" iconOnly value={exploreLayout} onChange={(next) => setExploreLayout(next as typeof exploreLayout)} items={[
            { value: 'list', ariaLabel: 'List view', icon: <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M7.5 5h9M7.5 10h9M7.5 15h9M3.5 5h.01M3.5 10h.01M3.5 15h.01" /></svg> },
            { value: 'gallery', ariaLabel: 'Gallery view', icon: <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="5.5" height="5.5" rx="1" /><rect x="11.5" y="3" width="5.5" height="5.5" rx="1" /><rect x="3" y="11.5" width="5.5" height="5.5" rx="1" /><rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1" /></svg> },
          ]} />
        </div>{exploreLayout === 'gallery' ? <div className="intention-grid explore-gallery">{filtered.length ? <AnimatePresence mode="popLayout" initial={false}>{filtered.map((item, index) => <IntentionCard key={item.id} item={item} index={index} connectedLabel={relationshipCount(item.id) ? connectionSummary(connectedThoughts(item.id)) : null} alignedLabel={alignedTo(item.id).length ? alignmentSummary(alignedTo(item.id)) : null} onOpen={() => setDetailId(item.id)} onPreview={() => setPreviewId(item.id)} onOpenConnections={() => setConnectionsFor(item.id)} onOpenAlignments={() => setAlignmentsFor(item.id)} />)}</AnimatePresence> : <Empty title={filter === 'archived' ? 'No archived thoughts' : filter === 'trashed' ? 'Trash is empty' : 'Nothing here yet'} text="Try another filter or capture a new thought." />}</div> : <div className="explore-list">{filtered.length ? <AnimatePresence mode="popLayout" initial={false}>{filtered.map((item, index) => <motion.div className="explore-row" role="button" tabIndex={0} key={item.id} layout="position" variants={listItemVariants} initial="hidden" animate="visible" exit="exit" transition={listCardTransition(index, reduceViewMotion)} whileHover={reduceViewMotion ? undefined : listRowHoverLift} whileTap={reduceViewMotion ? undefined : listTap} onClick={() => setDetailId(item.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setDetailId(item.id); } }}><span className={`row-orb ${item.kind}`}><UiIcon name={kindIcons[item.kind] ?? 'kind-unclassified'} /><ProviderBadge provider={itemExternalProvider(item)} className="row-orb-badge" /></span><span className="row-copy"><h3>{item.title}</h3><p>{item.rawCapture}</p><span className="row-chips"><ThoughtStatus status={item.status} time={timeAgo(item.status === 'captured' ? item.createdAt : item.updatedAt)} />{item.status === 'trashed' ? <span className="trash-countdown">Deletes forever in {daysUntilPurge(item.trashedAt)}d</span> : null}<ScheduledBadge item={item} />{item.horizon ? <span className="thought-horizon"><UiIcon name="time" />{item.horizon}</span> : null}{relationshipCount(item.id) ? <button type="button" className="thought-link-indicator" onClick={(event) => { event.stopPropagation(); setConnectionsFor(item.id); }}><UiIcon name="connections" />Connected to {connectionSummary(connectedThoughts(item.id))}</button> : null}{alignedTo(item.id).length ? <button type="button" className="thought-link-indicator" onClick={(event) => { event.stopPropagation(); setAlignmentsFor(item.id); }}><UiIcon name="align" />Aligned to {alignmentSummary(alignedTo(item.id))}</button> : <button type="button" className="thought-link-indicator is-unaligned" onClick={(event) => { event.stopPropagation(); setAlignmentsFor(item.id); }}><UiIcon name="align" />Not aligned yet</button>}</span></span><button type="button" className="row-preview-button" aria-label="Preview this thought" title="Preview" onClick={(event) => { event.stopPropagation(); setPreviewId(item.id); }}><UiIcon name="preview" /></button><span className="row-trailing"><span className="row-arrow">›</span></span></motion.div>)}</AnimatePresence> : <Empty title={filter === 'archived' ? 'No archived thoughts' : filter === 'trashed' ? 'Trash is empty' : 'Nothing here yet'} text={filter === 'archived' ? 'Thoughts you archive will stay here until you restore or delete them.' : filter === 'trashed' ? `Thoughts you delete stay here for ${TRASH_RETENTION_DAYS} days before they're permanently removed.` : 'Try another filter or capture a new thought.'} />}</div>}</motion.section>}

        {view === 'align' && <motion.div key="align" className="view-shell" {...viewMotion}><AlignView entries={alignments} items={activeItems} onSave={(entry, version, replaceConflict) => {
          if (!syncClient.current) throw new Error('Your account is still opening. Try again in a moment.');
          syncClient.current.saveAlignment(entry, version, replaceConflict);
          showToast('Saved to Align.');
        }} onUseSynced={(entryId) => {
          if (!syncClient.current) throw new Error('Your account is still opening. Try again in a moment.');
          syncClient.current.useSyncedAlignment(entryId);
        }} onDelete={(entryId) => {
          void syncClient.current?.deleteAlignment(entryId)
            .then(() => showToast('Deleted from Align.'))
            .catch((error) => showToast(error instanceof Error ? error.message : 'Could not delete this entry.'));
        }} onOpenIntention={(itemId) => setDetailId(itemId)} /></motion.div>}

        {view === 'time' && <motion.div key="time" className="view-shell" {...viewMotion}><TimeView today={todayString} items={activeItems} scheduled={scheduled} busyWindows={busyWindows} busyWindowRange={busyWindowRange} pinnedTimezones={prefs.pinnedTimezones} onSchedule={(itemId, date, time, duration) => startSchedule(itemId, date, time, duration)} onRemove={removeBlock} onAddCalendar={addCalendarEvent} onOpen={(itemId) => setDetailId(itemId)} onAvailability={(start, end) => refreshAvailability({ start, end })} onRefreshCalendar={(start, end) => refreshCalendar({ start, end })} calendarSyncing={calendarSyncing} connected={calendarAccounts.length > 0} /></motion.div>}

        {view === 'suggestions' && <motion.section key="suggestions" className="view active suggestions-workspace" {...viewMotion}><TabHeader icon="suggestions" title="Suggestions" tagline="A few possibilities based on what you’ve saved. Always your call." /><div className="suggestion-explainer"><span>✧</span><p>Suggestions are ranked from your purpose, timeframe, recent attention, and effort estimate. ClearHead won’t schedule anything without you.</p><button className="outline-button" onClick={() => openAccount('preferences')}>Preferences</button></div><div className="suggestion-list">{suggestions.length ? suggestions.map(({ item, rationale }) => <article className="suggestion-card" key={item.id}><div className="suggestion-top"><span className="suggestion-label">✧ A thought to return to</span><span className="suggestion-confidence">Only a suggestion</span></div><h3>{item.title}</h3><p>{item.rawCapture}</p><div className="suggestion-reason"><span>◎</span><span>{rationale}</span></div><div className="suggestion-actions"><button className="capture-button" onClick={() => { void recordSuggestionFeedback(item.id, 'accepted', null, 'Added to your focus.'); setDetailId(item.id); }}>Keep in focus</button><button className="outline-button" onClick={() => planSuggestedTime(item)}>Find a time</button><button className="outline-button" onClick={() => void recordSuggestionFeedback(item.id, 'snoozed', dateShift(new Date(), 3).toISOString(), 'We’ll leave this one quiet for now.')}>Leave for later</button><button className="subtle-button" onClick={() => void recordSuggestionFeedback(item.id, 'dismissed', null, 'Suggestion dismissed; thought kept in your space.')}>Dismiss</button></div></article>) : <div className="suggestion-empty">No nudges for now. Your space can be quiet.</div>}</div></motion.section>}

      {view === 'connections' && <motion.section key="connections" className="view active connections-workspace" {...viewMotion}><TabHeader icon="connections" title="Connections" tagline="Bring your calendars and work into view. You choose what to connect." /><Connections client={syncClient.current} statuses={connectionStatuses} callbackMessage={connectionMessage} onCapture={keepConnectionEntry} syncingAccounts={syncingCalendarAccounts} onMarkSyncing={markCalendarSyncing} /></motion.section>}
        </AnimatePresence>
        <AnimatePresence>{captureFocused && !dumpTarget ? <CapturePanel key="dump-now" panelRef={capturePanelRef} inputRef={captureInputRef} capture={capture} onCapture={setCapture} mode={captureInputMode} onMode={selectCaptureMode} listening={Boolean(recognizing)} voiceStatus={voiceStatus} saving={captureSaving} onSave={() => void saveCapture()} onClose={closeCaptureFocus} onKeyDown={handleCaptureKeyDown} reduceMotion={prefs.reduceMotion} theme={isDarkFamily(theme) ? 'dark' : 'light'} /> : null}</AnimatePresence>
      </div>
      <AnimatePresence mode="wait">{detail && <motion.section className="thought-workspace" role="region" aria-label="Intention details" key={detail.id} {...viewMotion}>
        <div className="thought-workspace-heading"><button className="text-button" onClick={() => changeView('explore')}>← Back to Explore</button><div className="thought-heading-tools"><label className="version-switch" title="Switch thought version"><ThoughtIcon name="version" /><select aria-label="Switch thought version" value={selectedVersionId || detail.originalVersions?.at(-1)?.id || ''} onChange={(event) => { setSelectedVersionId(event.target.value); setDetailTab('original'); }}><option value="" disabled>Version</option>{(detail.originalVersions ?? []).map((version, index) => <option key={version.id} value={version.id}>Version {index + 1}</option>)}</select><span aria-hidden="true">⌄</span></label><ThoughtStatus status={detail.status} /></div></div>
        <div className="detail-layout">
          <div className="detail-main">
            <div className="detail-kind"><i />{kindNames[detailDraft.kind ?? detail.kind] ?? 'Thought'}</div>
            <h1 className="thought-heading">{detailDraft.title || detail.title}</h1>
            <div className="thought-tabs segmented-tabs" role="tablist" aria-label="Thought views">{(['polished', 'original', 'timeline'] as const).map((tab, index, tabs) => <button key={tab} id={`thought-tab-${tab}`} role="tab" className={`segmented-tab ${detailTab === tab ? 'active' : ''}`} aria-selected={detailTab === tab} aria-controls={`thought-panel-${tab}`} tabIndex={detailTab === tab ? 0 : -1} onClick={() => setDetailTab(tab)} onKeyDown={(event) => {
              const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(index + tabs.length - 1) % tabs.length] : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : undefined;
              if (next) { event.preventDefault(); setDetailTab(next); document.getElementById(`thought-tab-${next}`)?.focus(); }
            }}>{detailTab === tab && <motion.span className="segmented-thumb" layoutId={`thought-tab-thumb-${detail.id}`} transition={reduceViewMotion ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 38, mass: 0.7 }} />}<span className="segmented-tab-content"><ThoughtIcon name={tab} />{tab[0]!.toUpperCase() + tab.slice(1)}</span></button>)}</div>
            <div id="thought-panel-polished" role="tabpanel" aria-labelledby="thought-tab-polished" hidden={detailTab !== 'polished'}>
              <div className="thought-basics"><div className="detail-field ai-polish-host"><label htmlFor="thought-title">Title</label><input id="thought-title" maxLength={160} value={detailDraft.title ?? detail.title} onChange={(event) => setDetailDraft((draft) => ({ ...draft, title: event.target.value }))} /><AiPolish fieldKind="title" disabled={!(detailDraft.title ?? detail.title).trim()} getText={() => detailDraft.title ?? detail.title} renderPreview={(text) => <p>{text}</p>} onApply={(text) => setDetailDraft((draft) => ({ ...draft, title: text }))} /></div><div className="detail-field"><label htmlFor="thought-kind">Type</label><select id="thought-kind" value={detailDraft.kind ?? detail.kind} onChange={(event) => setDetailDraft((draft) => ({ ...draft, kind: event.target.value }))}>{kinds.map((kind) => <option key={kind} value={kind}>{kindNames[kind]}</option>)}</select></div></div>
              <ThoughtFields item={detail} draft={detailDraft} onChange={(key, value) => setDetailDraft((draft) => ({ ...draft, [key]: value }))} enabled={prefs.aiInterpretationEnabled} client={syncClientReady ? syncClient.current : null} onPreferences={() => openAccount('preferences')} />
              {detail.aiInterpretation ? <div className="ai-change-note"><p>{detail.aiInterpretation.rationale || 'AI suggested a title, type, and timing for this thought.'}</p>{detail.aiInterpretation.canUndo ? <button className="outline-button" onClick={() => void undoAIInterpretation()}>Undo AI suggestion</button> : detail.aiInterpretation.undoneAt ? <small>AI suggestion undone · original capture preserved</small> : null}</div> : null}
            </div>
            <div id="thought-panel-original" role="tabpanel" aria-labelledby="thought-tab-original" hidden={detailTab !== 'original'}><OriginalThought item={detail} onDump={openDump} selectedVersionId={selectedVersionId || detail.originalVersions?.at(-1)?.id} /></div>
            <div id="thought-panel-timeline" role="tabpanel" aria-labelledby="thought-tab-timeline" hidden={detailTab !== 'timeline'}>{detailTab === 'timeline' ? <ThoughtTimeline item={detail} client={syncClientReady ? syncClient.current : null} /> : null}</div>
          </div>
          <aside className="detail-rail">
            <div className="rail-section rail-actions">
              <div className="rail-head"><UiIcon name="check-circle" /><h3>Actions</h3></div>
              <button className="save-detail" onClick={() => { saveDetail(); }}><RollingLabel>Save changes</RollingLabel></button>
              <div className="rail-actions-row">{detail.status === 'trashed' ? <><button className="complete-detail" onClick={() => { updateItem(detail.id, (item) => ({ ...item, status: 'ready' }), 'Thought restored to your space.'); setDetailId(null); }}><UiIcon name="restore" />Restore</button><button className="danger-button" onClick={() => { deleteForever(detail.id); setDetailId(null); }}><UiIcon name="trash" />Delete forever</button></> : detail.status === 'archived' ? <><button className="complete-detail" onClick={() => { updateItem(detail.id, (item) => ({ ...item, status: 'ready' }), 'Thought restored to your space.'); setDetailId(null); }}><UiIcon name="restore" />Restore</button><button className="complete-detail" onClick={() => { setDetailId(null); startSchedule(detail.id); }}><UiIcon name="calendar" />Set time</button></> : <><button className="complete-detail" onClick={() => { updateItem(detail.id, (item) => ({ ...item, status: item.status === 'completed' ? 'ready' : 'completed' }), detail.status === 'completed' ? 'Back in your space.' : 'Marked complete.'); }}><UiIcon name={detail.status === 'completed' ? 'play' : 'check-circle'} />{detail.status === 'completed' ? 'Reopen' : 'Complete'}</button><button className="complete-detail" onClick={() => { setDetailId(null); startSchedule(detail.id); }}><UiIcon name="calendar" />Set time</button></>}</div>
              <span className="detail-meta">{detail.syncState === 'pending' ? 'Saved here · syncing' : 'Private to your space'}</span>
            </div>
            <ThoughtRelationships item={detail} items={activeItems} relationships={relationships} onCreate={createRelationship} onDelete={deleteRelationship} onOpen={(id) => { setDetailId(id); setDetailDraft({}); }} />
            <div className="rail-section rail-schedule">
              <div className="rail-head"><UiIcon name="calendar" /><h3>Scheduled time</h3></div>
              {detail.blocks?.length ? <div className="detail-fields">{detail.blocks.map((block) => <div className="schedule-item" key={block.id}><span className="schedule-time">
                <span className="schedule-time-col schedule-time-date"><span className="schedule-time-label">Date</span><span className="schedule-time-value">{scheduleDateCaptionShort(block.date)}</span></span>
                <span className="schedule-time-divider" aria-hidden="true" />
                <span className="schedule-time-col schedule-time-clock"><span className="schedule-time-label">Time</span><span className="schedule-time-value">{scheduleTimeRange(block.date, block.time, block.duration)}</span></span>
                <span className="schedule-time-divider" aria-hidden="true" />
                <span className="schedule-time-col schedule-time-duration"><span className="schedule-time-label">Duration</span><span className="schedule-time-value">{scheduleDurationCaption(block.duration)}</span></span>
              </span><span className="schedule-marker" /><span className="schedule-copy">{block.externalEventId ? <a className="calendar-added" href={block.externalLink} target="_blank" rel="noreferrer"><ProviderBadge provider={block.externalProvider} /><AccountBadge accountLabel={block.externalAccountLabel} />✓ In {providerDisplayName(block.externalProvider)}</a> : <button className="calendar-add" onClick={() => void addCalendarEvent(detail.id, block.id)}><UiIcon name="calendar-add" />{calendarAccounts.length ? 'Add to calendar' : 'Connect calendar to add'}</button>}</span><button className="schedule-remove" onClick={() => removeBlock(detail.id, block.id)} aria-label="Remove time block"><UiIcon name="close" />Remove</button></div>)}</div> : <p className="rail-empty">Nothing set aside yet.</p>}
            </div>
            {detail.status !== 'archived' && detail.status !== 'trashed' ? <div className="rail-actions-row rail-destructive-row"><button className="danger-button rail-archive" title="Archive this thought" aria-label="Archive this thought" onClick={() => { updateItem(detail.id, (item) => ({ ...item, status: 'archived' }), 'Thought archived.'); setDetailId(null); }}><UiIcon name="archive" />Archive</button><button className="danger-button rail-trash" title="Delete this thought" aria-label="Delete this thought" onClick={() => { updateItem(detail.id, (item) => ({ ...item, status: 'trashed' }), 'Moved to Trash.'); setDetailId(null); }}><UiIcon name="trash" />Delete</button></div> : null}
          </aside>
        </div></motion.section>}</AnimatePresence>
    </main>


    <AnimatePresence>{dumpTarget && dumpItem ? <CapturePanel key="dump-continue" panelRef={capturePanelRef} inputRef={captureInputRef} capture={capture} onCapture={setCapture} mode={captureInputMode} onMode={selectCaptureMode} listening={Boolean(recognizing)} voiceStatus={voiceStatus} saving={captureSaving} onSave={() => void saveCapture()} onClose={closeCaptureFocus} onKeyDown={handleCaptureKeyDown} reduceMotion={prefs.reduceMotion} theme={isDarkFamily(theme) ? 'dark' : 'light'} previousPieces={<OriginalPieces versions={dumpItem.originalVersions ?? []} compact />} gist={<OriginalGist item={dumpItem} />} versionLabel={`Version ${(dumpItem.originalVersions?.length ?? 1) + (dumpTarget.newVersion ? 1 : 0)}`} /> : null}</AnimatePresence>
    <AnimatePresence>{calendarConfirm ? (() => {
      const item = items.find((entry) => entry.id === calendarConfirm.itemId); const block = item?.blocks?.find((entry) => entry.id === calendarConfirm.blockId);
      return item && block ? <AddToCalendarModal key="calendar-confirm" item={{ title: item.title, intent: item.intent ?? '', purpose: item.purpose ?? '' }} block={{ remoteId: block.remoteId ?? '', date: block.date, time: block.time, duration: block.duration }} accounts={calendarAccounts} onConfirm={(title, description, integrationIds) => void confirmAddCalendarEvent(calendarConfirm.itemId, calendarConfirm.blockId, title, description, integrationIds)} onClose={() => setCalendarConfirm(null)} /> : null;
    })() : null}</AnimatePresence>
    <AnimatePresence>{previewId ? (() => { const previewItem = items.find((entry) => entry.id === previewId); return previewItem ? <PreviewModal key="preview" title={previewItem.title} lede={previewItem.rawCapture} onClose={() => setPreviewId(null)} sections={[
      { label: thoughtFieldLabels.intent, html: previewItem.intent },
      { label: thoughtFieldLabels.purpose, html: previewItem.purpose },
      { label: thoughtFieldLabels.desiredOutcome, html: previewItem.desiredOutcome },
      { label: thoughtFieldLabels.roughPlan, html: previewItem.roughPlan },
    ]} /> : null; })() : null}</AnimatePresence>
    <AnimatePresence>{connectionsFor ? <Modal key="connections" label="Connected thoughts" onClose={() => setConnectionsFor(null)} className="settings-dialog"><div className="settings-content connections-modal"><div className="date-label">CONNECTED THOUGHTS</div><h2>{items.find((entry) => entry.id === connectionsFor)?.title ?? 'This thought'}</h2><p className="settings-lede">{connectionSummary(connectedThoughts(connectionsFor)) || 'No connections yet.'}</p><div className="connections-modal-list">{connectedThoughts(connectionsFor).map((connected) => <button key={connected.id} type="button" className="connections-modal-item" onClick={() => { setConnectionsFor(null); setDetailId(connected.id); }}><UiIcon name={kindIcons[connected.kind] ?? 'kind-unclassified'} /><span>{connected.title}</span></button>)}</div></div></Modal> : null}</AnimatePresence>
    <AnimatePresence>{alignmentsFor ? <Modal key="alignments" label="Aligned to" onClose={() => setAlignmentsFor(null)} className="settings-dialog"><div className="settings-content connections-modal"><div className="date-label">ALIGNED TO</div><h2>{items.find((entry) => entry.id === alignmentsFor)?.title ?? 'This thought'}</h2><p className="settings-lede">{alignmentSummary(alignedTo(alignmentsFor)) || 'Not aligned to anything yet.'}</p><div className="connections-modal-list">{alignedTo(alignmentsFor).map((entry) => <button key={entry.id} type="button" className="connections-modal-item" onClick={() => { setAlignmentsFor(null); changeView('align'); }}><UiIcon name={alignmentTypes[entry.kind].icon} /><span>{entry.title}</span></button>)}</div></div></Modal> : null}</AnimatePresence>
    <AnimatePresence>{scheduleOpen && <Modal key="schedule" label="Set aside time" onClose={() => setScheduleOpen(false)} className="settings-dialog schedule-dialog">
      <form className="settings-content" onSubmit={saveSchedule}>
        <div className="schedule-dialog-head">
          <span className="schedule-dialog-icon"><UiIcon name="calendar" /></span>
          <div><div className="date-label">A LITTLE SPACE FOR IT</div><h2>Make room</h2></div>
        </div>
        <p className="settings-lede">Choose an intention and a time that feels possible.</p>
        <div className="detail-fields">
          <motion.div className="detail-field" variants={listItemVariants} initial="hidden" animate="visible" transition={listItemTransition(0, reduceViewMotion)}>
            <label htmlFor="schedule-intention">Intention</label>
            <select id="schedule-intention" value={scheduleTarget ?? ''} onChange={(event) => setScheduleTarget(event.target.value)} required><option value="" disabled>Choose a thought</option>{activeItems.filter((item) => item.status !== 'completed').map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
          </motion.div>
          <div className="schedule-input-row">
            <motion.div className="detail-field" variants={listItemVariants} initial="hidden" animate="visible" transition={listItemTransition(1, reduceViewMotion)}>
              <label htmlFor="schedule-date"><UiIcon className="field-label-icon" name="calendar" />Date</label>
              <input id="schedule-date" type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} required />
            </motion.div>
            <motion.div className="detail-field" variants={listItemVariants} initial="hidden" animate="visible" transition={listItemTransition(2, reduceViewMotion)}>
              <label htmlFor="schedule-time"><UiIcon className="field-label-icon" name="time" />Start time</label>
              <input id="schedule-time" type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} required />
            </motion.div>
          </div>
          <motion.div className="detail-field" variants={listItemVariants} initial="hidden" animate="visible" transition={listItemTransition(3, reduceViewMotion)}>
            <label id="schedule-duration-label">Time set aside</label>
            <div className="duration-chips" role="group" aria-labelledby="schedule-duration-label">
              {[15, 30, 45, 60, 90].map((value) => <button type="button" key={value} className={`duration-chip ${scheduleDuration === value ? 'active' : ''}`} onClick={() => setScheduleDuration(value)}>{durationLabel(value)}</button>)}
              {![15, 30, 45, 60, 90].includes(scheduleDuration) ? <button type="button" className="duration-chip active">{durationLabel(scheduleDuration)} · estimate</button> : null}
            </div>
          </motion.div>
          <p className="schedule-preview">{scheduleDateCaption(scheduleDate)} · {scheduleTimeRange(scheduleDate, scheduleTime, scheduleDuration)} · {durationLabel(scheduleDuration)}</p>
        </div>
        <div className="settings-actions"><button className="outline-button" type="button" onClick={() => setScheduleOpen(false)}>Cancel</button><button className="save-detail" type="submit"><RollingLabel>Set this time aside</RollingLabel></button></div>
      </form>
    </Modal>}</AnimatePresence>
    <AnimatePresence>{onboardingOpen && <Modal key="onboarding" label="Privacy overview" onClose={() => finishOnboarding()} className="settings-dialog"><div className="settings-content"><div className="date-label">WELCOME TO CLEARHEAD</div><h2>Your thoughts stay yours.</h2><p className="settings-lede">Capture saves on this device first, then syncs to your account when you’re online. Your original words stay with each thought.</p><div className="privacy-note"><span>⌑</span><p>AI suggestions and brainstorming are optional. When enabled, thought interpretation sends relevant text to Laya for preliminary category and timeframe signals, then to OpenAI for the final decision. Brainstorming sends the thought and conversation to OpenAI. Calendar and workspace connections are optional. Calendar events are only created when you ask. If you’re signed in and online when a screen crashes, ClearHead can send a report with the platform, error category, and one-way fingerprint; it excludes error text, stack details, and your saved thoughts. You can export or delete your data from Preferences.</p></div><div className="settings-actions"><button className="capture-button" onClick={() => finishOnboarding()}>Start with a thought <span>↗</span></button><button className="outline-button" onClick={() => finishOnboarding(true)}>Review privacy settings</button></div></div></Modal>}</AnimatePresence>
    <AnimatePresence>{paletteOpen && <CommandPalette
      key="palette"
      items={activeItems}
      kindNames={kindNames}
      kindGlyphs={kindGlyphs}
      onOpenItem={(id) => { setDetailId(id); setPaletteOpen(false); }}
      onNavigate={(destination: PaletteDestination, filterValue) => { changeView(destination); if (filterValue) setFilter(filterValue); setPaletteOpen(false); }}
      onClose={() => setPaletteOpen(false)}
    />}</AnimatePresence>
    <div className={`toast ${toast ? 'show' : ''}`} role="status" aria-live="polite">{toast}</div>
    {syncConflicts.length > 0 && <div className="sync-conflict-banner" role="alert">
      <span>{syncConflicts.length} edit{syncConflicts.length === 1 ? '' : 's'} saved as separate cop{syncConflicts.length === 1 ? 'y' : 'ies'} because something else changed {syncConflicts.length === 1 ? 'it' : 'them'} first.</span>
      <div className="sync-conflict-banner-actions">
        <button className="outline-button" onClick={() => { setDetailId(syncConflicts[0]!.id); setSyncConflicts((current) => current.slice(1)); }}>Review</button>
        <button className="icon-button" aria-label="Dismiss" onClick={() => setSyncConflicts((current) => current.slice(1))}>×</button>
      </div>
    </div>}
    {(navPosition === 'left' || navPosition === 'right') && <button type="button" className="dump-fab" onClick={openDumpNow} title="Dump now" aria-label="Dump now"><BrainDumpIcon /></button>}
    <VoiceAssistant
      actions={voiceActions}
      apiUrl={API}
      getAccessToken={async () => (await authClient?.auth.getSession())?.data.session?.access_token ?? null}
      userName={firstName || session.user.email?.split('@')[0] || ''}
      agentName={agentSettings.name}
      agentTone={agentSettings.tone}
      agentVoice={agentSettings.voice}
      disabled={!syncClientReady}
      insights={spaceCoachCards?.map((card) => card.text) ?? []}
    />
  </div>;
}

function Setting({ title, detail, children }: { title: string; detail: string; children: ReactNode }) { return <div className="setting-row"><div><b>{title}</b><small>{detail}</small></div>{children}</div>; }
function ScheduledBadge({ item, compact = false }: { item: Intention; compact?: boolean }) {
  const scheduled = nextScheduledBlock(item);
  if (!scheduled) return null;
  const label = `${blockDayLabel(scheduled.date)} · ${scheduled.time}`;
  return compact
    ? <span className="thought-scheduled is-compact" title={label} aria-label={`Scheduled ${label}`}><UiIcon name="calendar" /></span>
    : <span className="thought-scheduled"><UiIcon name="calendar" />{label}</span>;
}

function IntentionCard({ item, onOpen, onPreview, onOpenConnections, onOpenAlignments, connectedLabel, alignedLabel, index = 0 }: { item: Intention; onOpen: () => void; onPreview: () => void; onOpenConnections?: () => void; onOpenAlignments?: () => void; connectedLabel?: string | null; alignedLabel?: string | null; index?: number }) {
  const reduceMotion = useReducedMotionPref();
  return <motion.div className="intention-card" role="button" tabIndex={0} layout="position" variants={listItemVariants} initial="hidden" animate="visible" exit="exit"
    transition={listCardTransition(index, reduceMotion)} whileHover={reduceMotion ? undefined : listHoverLift} whileTap={reduceMotion ? undefined : listTap}
    onClick={onOpen} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(); } }}>
    <span className="card-head">
      <h3>{item.title}</h3>
      <span className="card-head-meta">
        <button type="button" className="card-preview-button" aria-label="Preview this thought" title="Preview" onClick={(event) => { event.stopPropagation(); onPreview(); }}><UiIcon name="preview" /></button>
        <time className="card-added" dateTime={item.createdAt}>{timeAgo(item.createdAt)}</time>
      </span>
    </span>
    <RichTextView html={item.intent || item.rawCapture} maxChars={160} />
    <span className="card-chips">
      <span className="kind-chip"><UiIcon name={kindIcons[item.kind] ?? 'kind-unclassified'} />{kindNames[item.kind] ?? 'Thought'}</span>
      <ThoughtStatus status={item.status} />
      {item.status === 'trashed' ? <span className="trash-countdown">Deletes forever in {daysUntilPurge(item.trashedAt)}d</span> : null}
      <ScheduledBadge item={item} />
      {item.horizon ? <span className="thought-horizon"><UiIcon name="time" />{item.horizon}</span> : null}
      {connectedLabel ? <button type="button" className="thought-link-indicator" onClick={(event) => { event.stopPropagation(); onOpenConnections?.(); }}><UiIcon name="connections" />Connected to {connectedLabel}</button> : null}
      {alignedLabel ? <button type="button" className="thought-link-indicator" onClick={(event) => { event.stopPropagation(); onOpenAlignments?.(); }}><UiIcon name="align" />Aligned to {alignedLabel}</button> : <button type="button" className="thought-link-indicator is-unaligned" onClick={(event) => { event.stopPropagation(); onOpenAlignments?.(); }}><UiIcon name="align" />Not aligned yet</button>}
    </span>
  </motion.div>;
}

function ThoughtRelationships({ item, items, relationships, onCreate, onDelete, onOpen }: {
  item: Intention; items: Intention[]; relationships: IntentionRelationship[];
  onCreate: (from: string, to: string, relation: IntentionRelationship['relation']) => void;
  onDelete: (id: string) => void; onOpen: (id: string) => void;
}) {
  const connectable = items.filter((candidate) => candidate.id !== item.id && candidate.status !== 'archived' && candidate.status !== 'trashed');
  const [otherId, setOtherId] = useState('');
  const [relation, setRelation] = useState<IntentionRelationship['relation']>('related');
  useEffect(() => { if (!connectable.some((candidate) => candidate.id === otherId)) setOtherId(connectable[0]?.id ?? ''); }, [connectable, otherId]);
  const links = relationships.filter((link) => link.fromClientId === item.id || link.toClientId === item.id);
  const counterpart = (link: IntentionRelationship) => {
    const id = link.fromClientId === item.id ? link.toClientId : link.fromClientId;
    return { id, title: id === link.fromClientId ? link.fromTitle : link.toTitle, relation: link.fromClientId === item.id ? link.relation.replace('_', ' ') : `is ${link.relation.replace('_', ' ')}` };
  };
  return <section className="relationship-panel thought-relationships"><div className="purpose-head"><span className="purpose-icon"><UiIcon name="connections" /></span><h2>Connected thoughts</h2><span>{links.length} link{links.length === 1 ? '' : 's'}</span></div><p className="relationship-help">Link this thought to another to show how they relate.</p>
    {connectable.length ? <div className="relationship-controls"><label><span>Relationship</span><select value={relation} onChange={(event) => setRelation(event.target.value as IntentionRelationship['relation'])}><option value="supports">Supports</option><option value="related">Related to</option><option value="depends_on">Depends on</option></select></label><label><span>Connect to</span><select value={otherId} onChange={(event) => setOtherId(event.target.value)}>{connectable.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}</select></label><button className="outline-button" disabled={!otherId} onClick={() => onCreate(item.id, otherId, relation)}>＋ Link thought</button></div> : <p className="relationship-empty">Save another thought first, then you can link it here.</p>}
    {links.length ? <div className="relationship-list">{links.map((link) => { const other = counterpart(link); return <div className="relationship-row" key={link.id}><span className="thought-link-indicator" aria-hidden="true"><UiIcon name="connections" /></span><button onClick={() => onOpen(other.id)}>{other.title}</button><span>{other.relation}</span><button className="relationship-remove" onClick={() => onDelete(link.id)} aria-label={`Remove connection to ${other.title}`}>×</button></div>; })}</div> : null}
  </section>;
}

function TimeView({ today, items, scheduled, busyWindows, busyWindowRange, pinnedTimezones, onSchedule, onRemove, onAddCalendar, onOpen, onAvailability, onRefreshCalendar, calendarSyncing, connected }: {
  today: string; items: Intention[]; scheduled: Array<{ item: Intention; block: Block }>; busyWindows: Array<{ start: string; end: string }>; busyWindowRange: CalendarCheck | null;
  pinnedTimezones: string[];
  onSchedule: (id?: string, date?: string, time?: string, duration?: number) => void; onRemove: (id: string, blockId: string) => void; onAddCalendar: (id: string, blockId: string) => void;
  onOpen: (id: string) => void; onAvailability: (start: Date, end: Date) => void; onRefreshCalendar: (start: Date, end: Date) => void; calendarSyncing: boolean; connected: boolean;
}) {
  const [period, setPeriod] = useState<TimePeriod>('week');
  const [scheduleDrawerOpen, setScheduleDrawerOpen] = useState(false);
  const [layout, setLayout] = useState<'calendar' | 'scheduler' | 'rhythm'>('calendar');
  const [focusDate, setFocusDate] = useState(() => new Date(`${today}T12:00:00`));
  const month = focusDate;
  const weekStart = dateShift(focusDate, -focusDate.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const visibleDays = Array.from({ length: 7 }, (_, index) => dateShift(weekStart, index));
  const visible = scheduled.filter(({ block }) => period === 'day' ? Boolean(dayInterval(focusDate, new Date(`${block.date}T${block.time}`), new Date(new Date(`${block.date}T${block.time}`).getTime() + block.duration * 60_000)))
    : period === 'week' ? block.date >= localDate(visibleDays[0]!) && block.date <= localDate(visibleDays[6]!)
    : period === 'month' ? block.date.startsWith(`${focusDate.getFullYear()}-${String(focusDate.getMonth() + 1).padStart(2, '0')}`)
    : block.date.startsWith(`${focusDate.getFullYear()}-`));
  function navigate(amount: number) {
    setFocusDate((date) => period === 'day' || period === 'week' ? dateShift(date, amount * (period === 'week' ? 7 : 1))
      : period === 'month' ? new Date(date.getFullYear(), date.getMonth() + amount, 1)
      : new Date(date.getFullYear() + amount, date.getMonth(), 1));
  }
  const changePeriod = (next: TimePeriod) => setPeriod(next);
  const allPeriods: TimePeriod[] = ['day', 'week', 'month', 'year'];
  const enabledPeriods: TimePeriod[] = layout === 'rhythm' ? ['week'] : layout === 'scheduler' ? ['day', 'week'] : allPeriods;
  function changeLayout(next: typeof layout) {
    setLayout(next);
    if (next === 'rhythm' || (next === 'scheduler' && (period === 'month' || period === 'year'))) setPeriod('week');
  }

  const availabilityStart = period === 'day' ? new Date(focusDate.getFullYear(), focusDate.getMonth(), focusDate.getDate()) : visibleDays[0]!;
  const availabilityEnd = period === 'day' ? dateShift(availabilityStart, 1) : dateShift(visibleDays[6]!, 1);
  const availabilityIsCurrent = calendarCheckIsFresh(busyWindowRange) && calendarAvailabilityMatchesRange(busyWindowRange, { start: localDate(availabilityStart), end: localDate(availabilityEnd) });
  const scheduledIntervals = scheduled.map(({ block }) => {
    const start = new Date(`${block.date}T${block.time}`).getTime();
    return { start, end: start + block.duration * 60_000 };
  });
  // A busy window that overlaps a block we already know about (synced in as its own
  // card, e.g. from Google Calendar) would otherwise double-render the same event as
  // both a titled card and an opaque grey "busy" block. Only show busy windows that
  // don't correspond to anything ClearHead already has a real card for.
  const checkedBusyWindows = (availabilityIsCurrent ? busyWindows : []).filter((window) => {
    const start = Date.parse(window.start); const end = Date.parse(window.end);
    return !scheduledIntervals.some((interval) => start < interval.end && interval.start < end);
  });
  const dayBusyWindows = checkedBusyWindows.filter((window) => dayInterval(focusDate, new Date(window.start), new Date(window.end)));
  // calendarSyncing stays true until the background sync job actually finishes (see
  // syncingCalendarAccounts in Home), so this button keeps indicating progress well past
  // the instant the click handler returns, rather than flipping back to idle right away.
  const refreshCalendarButton = <button className="subtle-button icon-only calendar-refresh-button" disabled={calendarSyncing} title={calendarSyncing ? 'Syncing calendars…' : 'Sync calendars now'} aria-label={calendarSyncing ? 'Syncing calendars' : 'Sync calendars now'} onClick={() => onRefreshCalendar(availabilityStart, availabilityEnd)}>
    {calendarSyncing ? <span className="sync-progress-dot" aria-hidden="true" /> : null}<UiIcon name="refresh" className={calendarSyncing ? 'is-spinning' : ''} />
  </button>;
  return <section className="view active time-workspace">
    <TabHeader icon="time" title="Time" tagline="Make a place for your intentions." action={<>
      {(period === 'week' || layout === 'scheduler') && connected ? refreshCalendarButton : null}
      <button className="capture-button tab-header-cta" onClick={() => onSchedule(undefined, localDate(focusDate))}><RollingLabel>＋ Make room</RollingLabel></button>
    </>} />
    <div className="time-toolbar"><div className="week-control"><button className="arrow-button" onClick={() => navigate(-1)} aria-label={`Previous ${period}`}>‹</button><b aria-live="polite">{period === 'day' ? focusDate.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : period === 'month' ? month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : period === 'year' ? String(month.getFullYear()) : `${dateTitle(visibleDays[0]!)} – ${dateTitle(visibleDays[6]!)} · ${focusDate.getFullYear()}`}</b><button className="arrow-button" onClick={() => navigate(1)} aria-label={`Next ${period}`}>›</button><button className="outline-button" onClick={() => setFocusDate(new Date(`${today}T12:00:00`))}>Today</button></div>
      <SegmentedTabs ariaLabel="Calendar period" size="sm" value={period} onChange={(next) => changePeriod(next as TimePeriod)} items={allPeriods.map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1), disabled: !enabledPeriods.includes(value) }))} />
    </div>
    <div className="time-layout-toolbar">
      <SegmentedTabs ariaLabel="Schedule layout" value={layout} onChange={(next) => changeLayout(next as typeof layout)} items={[
        { value: 'calendar', label: 'Calendar', icon: <UiIcon name="layout-calendar" /> },
        { value: 'scheduler', label: 'Scheduler', icon: <UiIcon name="layout-scheduler" /> },
        { value: 'rhythm', label: 'Rhythm', icon: <UiIcon name="layout-rhythm" /> },
      ]} />
      {layout === 'scheduler' || layout === 'rhythm' ? <button type="button" className="schedule-drawer-tab" onClick={() => setScheduleDrawerOpen((value) => !value)} aria-expanded={scheduleDrawerOpen}>
        <span>{visible.length} block{visible.length === 1 ? '' : 's'} planned</span><UiIcon name="chevron-down" className={`schedule-drawer-caret ${scheduleDrawerOpen ? 'is-open' : ''}`} />
      </button> : <span>{visible.length} block{visible.length === 1 ? '' : 's'} planned</span>}
    </div>
    {period === 'day' && (layout === 'calendar' || layout === 'scheduler') && <div className="day-summary"><span>{!connected ? 'Connect Google Calendar to see busy windows.' : !availabilityIsCurrent ? 'Calendar availability has not been checked for this day.' : dayBusyWindows.length ? `${dayBusyWindows.length} busy window${dayBusyWindows.length === 1 ? '' : 's'} · ${dayBusyWindows.map((window) => `${new Date(window.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}–${new Date(window.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`).join(', ')}` : 'No busy windows in the latest check for this day.'}</span><div className="day-summary-actions">{connected ? refreshCalendarButton : null}<button className="outline-button" onClick={() => onSchedule(undefined, localDate(focusDate))}>＋ Make room this day</button></div></div>}
    <div className="time-scroll">
      {layout === 'calendar' ? <TimeCalendar period={period} date={focusDate} today={today} scheduled={scheduled} busyWindows={checkedBusyWindows} pinnedTimezones={pinnedTimezones} onOpen={onOpen} onChoose={(date, next) => { setFocusDate(date); setPeriod(next); }} onSchedule={(date, time) => onSchedule(undefined, date, time)} /> : null}
      {layout === 'scheduler' ? <OpenSpace days={period === 'day' ? [focusDate] : visibleDays} items={items} scheduled={scheduled} busyWindows={checkedBusyWindows} availabilityChecked={connected && availabilityIsCurrent} onOpen={onOpen} onSchedule={(id, date, time, duration) => {
        if (connected && availabilityIsCurrent && !calendarCheckIsFresh(busyWindowRange)) { onAvailability(availabilityStart, availabilityEnd); return; }
        onSchedule(id, date, time, duration);
      }} /> : null}
      {layout === 'rhythm' ? <Rhythm days={visibleDays} scheduled={scheduled} busyWindows={checkedBusyWindows} availabilityChecked={connected && availabilityIsCurrent} onChooseDay={(date) => { setFocusDate(date); setPeriod('day'); setLayout('calendar'); }} /> : null}
    </div>
    <AnimatePresence>{scheduleDrawerOpen && (layout === 'scheduler' || layout === 'rhythm') ? <Modal key="schedule-drawer" label="Time you’ve set aside" onClose={() => setScheduleDrawerOpen(false)} className="schedule-drawer-panel">
      <div className="schedule-panel"><div className="schedule-heading"><div><h2>Time you’ve set aside</h2><p>{visible.length ? `${visible.length} block${visible.length === 1 ? '' : 's'} planned` : 'No blocks planned yet. A gentle start is enough.'}</p></div><button className="outline-button" onClick={() => onSchedule(undefined, localDate(focusDate))}>＋ <span>Make room</span></button></div><div className="schedule-list">{visible.length ? visible.map(({ item, block }) => <div className="schedule-item" key={block.id}><span className="schedule-time">{block.date}<br />{block.time}</span><span className="schedule-marker" /><span className="schedule-copy"><button className="schedule-title-button" onClick={() => onOpen(item.id)}>{item.title}</button><small>{block.duration} minutes · {kindNames[item.kind] ?? 'Thought'}</small>{block.externalEventId ? <a className="calendar-added" href={block.externalLink} target="_blank" rel="noreferrer"><ProviderBadge provider={block.externalProvider} /><AccountBadge accountLabel={block.externalAccountLabel} />✓ In {providerDisplayName(block.externalProvider)}</a> : <button className="calendar-add" onClick={() => onAddCalendar(item.id, block.id)}><UiIcon name="calendar-add" />{connected ? 'Add to calendar' : 'Connect calendar to add'}</button>}</span><button className="schedule-remove" aria-label="Remove time block" onClick={() => onRemove(item.id, block.id)}>×</button></div>) : <div className="schedule-empty">No time set aside in this view yet.</div>}</div></div>
    </Modal> : null}</AnimatePresence>
  </section>;
}
