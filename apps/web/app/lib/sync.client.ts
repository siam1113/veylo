import { createAlignmentStore, type LocalAlignment } from './alignments.client';
import type { AlignmentContent } from '@veylo/domain';
import { chunkJsonPayload, initialOriginalVersions, mergeOriginalVersions, type OriginalVersion, type OriginalGist, type ThoughtEvaluation } from '@veylo/domain';

export type SyncBlock = {
  id: string; remoteId?: string; date: string; time: string; duration: number;
  startsAt?: string; endsAt?: string;
  externalProvider?: string; externalEventId?: string; externalLink?: string; syncState?: string;
};

export type SyncIntention = {
  id: string; clientId?: string; remoteId?: string; rawCapture: string; raw?: string;
  title: string; kind: string; intent?: string | null; purpose?: string | null;
  desiredOutcome?: string | null; roughPlan?: string | null; horizon?: string | null;
  effortEstimate?: number | null; energyContext?: string | null; status: string;
  createdAt: string; updatedAt: string; version?: number | null; blocks?: SyncBlock[];
  originalVersions?: OriginalVersion[]; originalGists?: Record<string, OriginalGist>;
  fieldEvaluation?: ThoughtEvaluation | null;
  aiInterpretation?: { confidence: number | null; rationale: string | null; model: string | null; processedAt: string; undoneAt: string | null; canUndo: boolean } | null;
  syncState?: 'pending' | 'synced'; [key: string]: unknown;
};

export type UserPreferences = { aiInterpretationEnabled: boolean; reduceMotion: boolean; suggestionsEnabled: boolean; suggestionLimit: number; quietStart: string | null; quietEnd: string | null; timezone: string | null };
export type IntentionRelationship = { id: string; fromClientId: string; fromTitle: string; toClientId: string; toTitle: string; relation: 'supports' | 'related' | 'depends_on' };
export type SuggestionFeedback = { clientId: string; state: 'open' | 'accepted' | 'dismissed' | 'snoozed'; snoozedUntil: string | null };
export type BrainstormMessage = { id: string; clientRequestId: string; parentMessageId: string | null; role: 'user' | 'assistant'; status: 'pending' | 'complete' | 'failed'; content: string; createdAt: string };
export type IntentionHistoryEntry = { id: string; version: number; action: 'created' | 'updated' | 'status_changed' | 'deleted' | 'ai_suggestion' | 'ai_undo' | 'ai_requested' | 'piece_added' | 'version_started'; details?: { questions?: string[] }; changedFields: string[]; createdAt: string };
export type JiraIssue = { id: string; key: string; summary: string; status: string; project: string; issueType: string; priority: string | null; dueDate: string | null; updatedAt: string | null; url: string | null };
export type NotionPage = { id: string; kind: 'page' | 'database'; title: string; url: string; lastEditedAt: string | null };
export type NotionPageResult = { pages: NotionPage[]; nextCursor: string | null; hasMore: boolean };
export type WebPushConfig = { publicKey: string | null; subscribed: boolean };
export const oauthProviders = ['google', 'jira', 'notion', 'outlook', 'clickup', 'asana', 'trello', 'todoist', 'microsoft_todo', 'linear', 'github', 'slack'] as const;
export type OAuthProvider = typeof oauthProviders[number];
export type ConnectionProvider = OAuthProvider | 'icloud';
export type ConnectionStatus = { provider: string; connected: boolean; siteName?: string | null; workspaceName?: string | null };
export type ConnectionCatalog = { provider: string; configured: boolean };
export type ConnectionEntry = { id: string; title: string; url?: string; date?: string | null; context?: string; captureText?: string };
export type ConnectionEntries = { entries: ConnectionEntry[]; hasMore: boolean; notice?: string };
export const connectionProviderId = (provider: ConnectionProvider) => provider === 'google' ? 'google_calendar' : provider === 'jira' ? 'jira_cloud' : provider;

type DeletedBlock = Record<string, unknown> & { clientId: string };
type Snapshot = { id: string; items: SyncIntention[]; clearAll?: boolean; deletedBlocks?: DeletedBlock[]; savedAt?: string };
type PreferenceSnapshot = { id: string; preferences: UserPreferences; savedAt: string };
type FeedbackSnapshot = { id: string; feedback: SuggestionFeedback[]; savedAt: string };
type RelationshipOperation = { id: string; action: 'create' | 'delete'; relationship: IntentionRelationship };
type RelationshipOutboxSnapshot = { id: string; operations: RelationshipOperation[]; savedAt: string };
type SyncOptions = {
  apiUrl: string; userId: string; getSession: () => Promise<{ userId: string; accessToken: string } | null>; signOut: () => Promise<void>;
  onAlignments?: (items: LocalAlignment[]) => void;
  onRemote: (items: SyncIntention[]) => void; onIntegrations: (items: Array<{ provider: string; connected: boolean; siteName?: string | null; workspaceName?: string | null }>) => void;
  onRelationships: (items: IntentionRelationship[]) => void;
  onSuggestionFeedback: (items: SuggestionFeedback[]) => void;
  onPreferences: (value: UserPreferences) => void; onState: (label: string, error: boolean) => void; onToast: (message: string) => void;
};

export type SyncClient = {
  saveAlignment(input: AlignmentContent & { id?: string }, expectedVersion: number | null, replaceConflict?: boolean): void;
  useSyncedAlignment(id: string): void;

  connectionCatalog(): Promise<ConnectionCatalog[]>;
  refreshConnections(): Promise<ConnectionStatus[]>;
  connectProvider(provider: OAuthProvider): Promise<void>;
  disconnectProvider(provider: ConnectionProvider): Promise<{ revocationWarning?: string }>;
  connectIcloud(credentials: { appleId: string; appPassword: string }): Promise<void>;
  connectionEntries(provider: Exclude<ConnectionProvider, 'google' | 'jira' | 'notion'>): Promise<ConnectionEntries>;
  start(items: SyncIntention[]): Promise<void>; queue(items: SyncIntention[]): Promise<void>; flush(): Promise<void>;
  completeOAuth(provider: OAuthProvider, code: string, state: string): Promise<void>;
  connectGoogle(): Promise<void>; disconnectGoogle(): Promise<{ revocationWarning?: string }>;
  connectJira(): Promise<void>; disconnectJira(): Promise<void>; getJiraIssues(): Promise<{ siteName: string; issues: JiraIssue[] }>;
  connectNotion(): Promise<void>; disconnectNotion(): Promise<{ revocationWarning?: string }>; getNotionPages(cursor?: string): Promise<NotionPageResult>;
  calendarAvailability(startsAt: string, endsAt: string, timezone: string): Promise<{ busy: Array<{ start: string; end: string }> }>;
  createCalendarEvent(timeBlockId: string): Promise<{ externalEventId: string; externalUrl?: string; alreadyExists?: boolean }>;
  setPreferences(value: UserPreferences): Promise<void>;
  getWebPushConfig(): Promise<WebPushConfig>; enableWebPush(subscription: { endpoint: string; expirationTime: number | null; keys: { p256dh: string; auth: string } }): Promise<void>;
  disableWebPush(endpoint: string): Promise<void>;
  createRelationship(fromClientId: string, toClientId: string, relation: IntentionRelationship['relation']): Promise<IntentionRelationship | null>;
  deleteRelationship(id: string): Promise<void>;
  setSuggestionFeedback(clientId: string, state: SuggestionFeedback['state'], snoozedUntil?: string | null): Promise<void>;
  setAIInterpretation(enabled: boolean): Promise<unknown>; deleteEverything(): Promise<void>;
  getBrainstormMessages(intentionId: string): Promise<BrainstormMessage[]>;
  evaluateThought(intentionId: string): Promise<{ queued: boolean }>;
  getIntentionHistory(intentionId: string): Promise<IntentionHistoryEntry[]>;
  sendBrainstormMessage(intentionId: string, clientRequestId: string, message: string): Promise<{ message: BrainstormMessage; queued: boolean }>;
  undoAIInterpretation(remoteId: string, expectedVersion: number): Promise<SyncIntention>;
  signOut(): Promise<void>; exportData(): Promise<unknown>; deleteAccount(): Promise<{ localDataCleared: boolean; externalRevocationWarnings: string[] }>; dispose(): void;
};

const DB_NAME = 'veylo-offline-v1';
const STORE_NAME = 'outbox';
const uuid = () => crypto.randomUUID();
const validUuid = (value: string | undefined) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value ?? '');

export function createRetryScheduler({ flush, isOnline, setTimer, clearTimer }: {
  flush: () => void; isOnline: () => boolean;
  setTimer?: (callback: () => void, delay: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}) {
  const scheduleTimer = setTimer ?? ((callback, delay) => setTimeout(callback, delay));
  const cancelTimer = clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let timer: unknown = null;
  let delay = 2_000;
  function schedule(): void {
    if (timer !== null) return;
    const nextDelay = delay;
    delay = Math.min(delay * 2, 60_000);
    timer = scheduleTimer(() => {
      timer = null;
      if (isOnline()) flush();
      else schedule();
    }, nextDelay);
  }
  function cancel(): void {
    if (timer !== null) cancelTimer(timer);
    timer = null;
  }
  return { schedule, cancel, reset() { delay = 2_000; }, dispose: cancel };
}

export function createSyncClient(options: SyncOptions): SyncClient {
  const api = options.apiUrl.replace(/\/$/, '');
  const snapshotId = `snapshot:${options.userId}`;
  const queuedPreferencesId = `preferences:${options.userId}`;
  const queuedFeedbackId = `suggestion-feedback:${options.userId}`;
  const queuedRelationshipsId = `relationships:${options.userId}`;
  const dataKey = `veylo-intentions-v1:${options.userId}`;
  const syncKey = `veylo-last-sync:${options.userId}`;
  const preferencesKey = `veylo-preferences-v1:${options.userId}`;
  const relationshipsKey = `veylo-relationships-v1:${options.userId}`;
  const alignmentsKey = `veylo-alignments-v1:${options.userId}`;
  const suggestionFeedbackKey = `veylo-suggestion-feedback-v1:${options.userId}`;
  const readLocalCache = (key: string): string | null => {
    try { return localStorage.getItem(key); } catch { return null; }
  };
  const writeLocalCache = (key: string, value: string): void => {
    try { localStorage.setItem(key, value); } catch { /* IndexedDB and the server remain authoritative. */ }
  };
  let databasePromise: Promise<IDBDatabase> | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushing = false;
  let flushAgain = false;
  let accountDeletionRequested = false;
  let flushIdle: Promise<void> = Promise.resolve();
  let finishActiveFlush: (() => void) | null = null;
  let clearRequested = false;
  let snapshotRevision = 0;
  let snapshotWrites: Promise<void> = Promise.resolve();
  let feedbackWrites: Promise<void> = Promise.resolve();
  let feedbackRevision = 0;
  let preferenceWrites: Promise<void> = Promise.resolve();
  let preferenceRevision = 0;
  let relationshipWrites: Promise<void> = Promise.resolve();
  let integrationCache: Array<{ provider: string; connected: boolean; siteName?: string | null; workspaceName?: string | null }> = [];
  let disposed = false;
  const activeRequests = new Set<AbortController>();
  let activeRequestWaiters: Array<() => void> = [];
  let startupDone: Promise<void> = Promise.resolve();
  const retryScheduler = createRetryScheduler({ flush: () => { void flush(); }, isOnline: () => navigator.onLine });

  function scheduleRetry(): void {
    if (accountDeletionRequested || disposed) return;
    retryScheduler.schedule();
  }

  function flushImmediately(): void {
    retryScheduler.cancel();
    void flush();
  }

  function database(): Promise<IDBDatabase> {
    if (!('indexedDB' in window)) return Promise.reject(new Error('Offline storage is unavailable in this browser.'));
    if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'id' }); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Could not open offline storage.'));
    });
    return databasePromise;
  }

  async function putSnapshot(items: SyncIntention[], clearAll = false, deletedBlocks: DeletedBlock[] = []): Promise<void> {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put({ id: snapshotId, items, clearAll, deletedBlocks, savedAt: new Date().toISOString() } satisfies Snapshot);
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
    });
  }

  function scheduleSnapshotWrite(writeSnapshot: () => Promise<void>): Promise<void> {
    const write = snapshotWrites.then(writeSnapshot);
    snapshotWrites = write.catch(() => undefined);
    return write;
  }

  async function getSnapshot(): Promise<Snapshot | null> {
    const db = await database();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(snapshotId);
      request.onsuccess = () => resolve((request.result as Snapshot | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async function getQueuedPreferences(): Promise<UserPreferences | null> {
    const db = await database();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(queuedPreferencesId);
      request.onsuccess = () => resolve((request.result as PreferenceSnapshot | undefined)?.preferences ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async function putQueuedPreferences(preferences: UserPreferences): Promise<void> {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put({ id: queuedPreferencesId, preferences, savedAt: new Date().toISOString() } satisfies PreferenceSnapshot);
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
    });
  }

  async function clearQueuedPreferences(): Promise<void> {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(queuedPreferencesId);
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
    });
  }

  function cachedSuggestionFeedback(): SuggestionFeedback[] {
    try {
      const rows = JSON.parse(localStorage.getItem(suggestionFeedbackKey) || '[]') as Array<Partial<SuggestionFeedback>>;
      return rows.filter((row): row is SuggestionFeedback => Boolean(
        row && typeof row.clientId === 'string' && ['open', 'accepted', 'dismissed', 'snoozed'].includes(row.state ?? '')
        && (row.snoozedUntil === null || typeof row.snoozedUntil === 'string'),
      ));
    } catch { return []; }
  }

  async function getQueuedSuggestionFeedback(): Promise<SuggestionFeedback[] | null> {
    const db = await database();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(queuedFeedbackId);
      request.onsuccess = () => resolve((request.result as FeedbackSnapshot | undefined)?.feedback ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async function putQueuedSuggestionFeedback(feedback: SuggestionFeedback[]): Promise<void> {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put({ id: queuedFeedbackId, feedback, savedAt: new Date().toISOString() } satisfies FeedbackSnapshot);
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
    });
  }

  async function clearQueuedSuggestionFeedback(): Promise<void> {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(queuedFeedbackId);
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
    });
  }

  async function getQueuedRelationshipOperations(): Promise<RelationshipOperation[]> {
    const db = await database();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(queuedRelationshipsId);
      request.onsuccess = () => resolve((request.result as RelationshipOutboxSnapshot | undefined)?.operations ?? []);
      request.onerror = () => reject(request.error);
    });
  }

  async function putQueuedRelationshipOperations(operations: RelationshipOperation[]): Promise<void> {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      if (operations.length) transaction.objectStore(STORE_NAME).put({ id: queuedRelationshipsId, operations, savedAt: new Date().toISOString() } satisfies RelationshipOutboxSnapshot);
      else transaction.objectStore(STORE_NAME).delete(queuedRelationshipsId);
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
    });
  }

  function queueRelationshipOperation(action: RelationshipOperation['action'], relationship: IntentionRelationship): Promise<void> {
    const write = relationshipWrites.then(async () => {
      const operations = await getQueuedRelationshipOperations();
      operations.push({ id: uuid(), action, relationship });
      await putQueuedRelationshipOperations(operations);
    });
    relationshipWrites = write.catch(() => undefined);
    return write;
  }

  function removeQueuedRelationshipOperations(ids: Set<string>): Promise<void> {
    const write = relationshipWrites.then(async () => {
      const operations = await getQueuedRelationshipOperations();
      await putQueuedRelationshipOperations(operations.filter((operation) => !ids.has(operation.id)));
    });
    relationshipWrites = write.catch(() => undefined);
    return write;
  }

  function clearQueuedRelationships(): Promise<void> {
    const write = relationshipWrites.then(() => putQueuedRelationshipOperations([]));
    relationshipWrites = write.catch(() => undefined);
    return write;
  }

  async function clearAccountOutbox(): Promise<void> {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.delete(snapshotId); store.delete(queuedPreferencesId); store.delete(queuedFeedbackId); store.delete(queuedRelationshipsId);
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
    });
  }

  function normalize(items: SyncIntention[]): SyncIntention[] {
    return items.map((source) => {
      const item = structuredClone(source);
      if (!validUuid(item.id)) item.id = uuid();
      item.clientId = item.id;
      for (const block of item.blocks ?? []) if (!validUuid(block.id)) block.id = uuid();
      return item;
    });
  }

  function waitForActiveRequests(): Promise<void> {
    if (!activeRequests.size) return Promise.resolve();
    return new Promise((resolve) => activeRequestWaiters.push(resolve));
  }

  async function request<T>(path: string, init: RequestInit = {}, allowDuringDeletion = false): Promise<T> {
    if (disposed) throw new Error('This Veylo session is no longer active.');
    if (accountDeletionRequested && !allowDuringDeletion) throw new Error('Account deletion is in progress.');
    const session = await options.getSession();
    if (disposed) throw new Error('This Veylo session is no longer active.');
    if (accountDeletionRequested && !allowDuringDeletion) throw new Error('Account deletion is in progress.');
    if (!session) throw new Error('Sign in to sync. Your local save is safe.');
    if (session.userId !== options.userId) throw new Error('The signed-in account changed. Refresh Veylo before syncing.');
    const controller = new AbortController();
    activeRequests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const abortFromCaller = () => controller.abort(init.signal?.reason);
    if (init.signal?.aborted) abortFromCaller();
    else init.signal?.addEventListener('abort', abortFromCaller, { once: true });
    try {
      const response = await fetch(`${api}/v1${path}`, {
        ...init, signal: controller.signal,
        headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { message?: string };
        throw Object.assign(new Error(body.message || `Sync failed (${response.status})`), { statusCode: response.status, responseBody: body });
      }
      if (response.status === 204) return undefined as T;
      return await response.json() as T;
    } catch (error) {
      if (controller.signal.aborted && !init.signal?.aborted) throw new Error('Veylo server request timed out. Check your connection and try again.');
      throw error;
    } finally {
      clearTimeout(timeout);
      init.signal?.removeEventListener('abort', abortFromCaller);
      activeRequests.delete(controller);
      if (!activeRequests.size) {
        for (const resolve of activeRequestWaiters) resolve();
        activeRequestWaiters = [];
      }
    }
  }

  let alignmentStore: ReturnType<typeof createAlignmentStore> | null = null;
  function getAlignmentStore() {
    if (!alignmentStore) alignmentStore = createAlignmentStore({
      key: alignmentsKey, storage: localStorage, request,
      onChange: (rows) => options.onAlignments?.(rows),
      isClosed: () => disposed || accountDeletionRequested,
    });
    return alignmentStore;
  }

  async function refreshIntegrations(): Promise<void> {
    const result = await request<{ integrations: Array<{ provider: string; connected: boolean; siteName?: string | null; workspaceName?: string | null }> }>('/integrations');
    if (accountDeletionRequested || disposed) return;
    integrationCache = result.integrations ?? [];
    options.onIntegrations(integrationCache);
  }

  const fields = (item: SyncIntention) => ({
    clientId: item.id, capturedAt: item.originalVersions?.[0]?.pieces[0]?.createdAt ?? item.createdAt, rawCapture: item.rawCapture || item.raw || item.title, title: item.title || 'A new thought', kind: item.kind || 'unclassified',
    intent: item.intent || null, purpose: item.purpose || null, desiredOutcome: item.desiredOutcome || null,
    roughPlan: item.roughPlan || null, horizon: item.horizon || null, effortEstimate: item.effortEstimate ?? null,
    energyContext: item.energyContext || null, status: item.status || 'captured', expectedVersion: item.version ?? null,
  });

  function fromRemote(row: Record<string, any>, current?: SyncIntention): SyncIntention {
    return {
      ...(current ?? {}), id: row.clientId, clientId: row.clientId, remoteId: row.id,
      originalVersions: mergeOriginalVersions(row.originalVersions?.length ? row.originalVersions : initialOriginalVersions(row.clientId, row.rawCapture, row.createdAt, row.createdAt), current?.originalVersions),
      originalGists: row.originalGists ?? {},
      rawCapture: row.rawCapture, raw: row.rawCapture, title: row.title, kind: row.kind,
      intent: row.intent, purpose: row.purpose, desiredOutcome: row.desiredOutcome, roughPlan: row.roughPlan,
      horizon: row.horizon, effortEstimate: row.effortEstimate, energyContext: row.energyContext,
      fieldEvaluation: row.fieldEvaluation ?? null,
      aiInterpretation: row.aiInterpretation ?? null,
      status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt, version: row.version, syncState: 'synced',
    };
  }

  async function pull(local: SyncIntention[]): Promise<{ items: SyncIntention[]; serverTime: string }> {
    const since = readLocalCache(syncKey) || '';
    const result = await request<{ serverTime: string; intentions?: Array<Record<string, any>>; timeBlocks?: Array<Record<string, any>> }>(`/sync${since ? `?since=${encodeURIComponent(since)}` : ''}`);
    const map = new Map(local.map((item) => [item.id, item]));
    for (const row of result.intentions ?? []) {
      const existing = map.get(row.clientId);
      if (row.deletedAt) { map.delete(row.clientId); continue; }
      if (existing?.syncState === 'pending' && Date.parse(existing.updatedAt || '0') >= Date.parse(row.updatedAt)) continue;
      map.set(row.clientId, fromRemote(row, existing));
    }
    for (const remoteBlock of result.timeBlocks ?? []) {
      const parent = map.get(remoteBlock.intentionClientId); if (!parent) continue;
      parent.blocks = parent.blocks ?? [];
      const index = parent.blocks.findIndex((block) => block.id === remoteBlock.clientId);
      if (remoteBlock.deletedAt) { if (index >= 0) parent.blocks.splice(index, 1); continue; }
      const value: SyncBlock = {
        id: remoteBlock.clientId, remoteId: remoteBlock.id, date: remoteBlock.startsAt.slice(0, 10),
        time: new Date(remoteBlock.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
        duration: Math.max(1, Math.round((Date.parse(remoteBlock.endsAt) - Date.parse(remoteBlock.startsAt)) / 60000)),
        externalProvider: remoteBlock.externalProvider, externalEventId: remoteBlock.externalEventId,
        externalLink: remoteBlock.externalUrl, syncState: remoteBlock.syncState,
      };
      if (index < 0) parent.blocks.push(value); else parent.blocks[index] = value;
    }
    return {
      items: [...map.values()].sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt)),
      serverTime: result.serverTime,
    };
  }

  async function push(items: SyncIntention[], deletedBlocks: DeletedBlock[] = []): Promise<SyncIntention[]> {
    const payload = normalize(items);
    const savedRows: Array<{ clientId: string; remoteId: string; version: number }> = [];
    const conflictRows: Array<{ clientId: string; current: Record<string, any> }> = [];
    for (const batch of chunkJsonPayload(payload, (itemsInBatch) => ({ intentions: itemsInBatch.map(fields) }))) {
      const result = await request<{ saved?: typeof savedRows; conflicts?: typeof conflictRows }>('/sync/push', {
        method: 'POST', body: JSON.stringify({ intentions: batch.map(fields) }),
      });
      savedRows.push(...(result.saved ?? []));
      conflictRows.push(...(result.conflicts ?? []));
    }
    const byClient = new Map(payload.map((item) => [item.id, item]));
    for (const saved of savedRows) {
      const item = byClient.get(saved.clientId);
      if (item) { item.remoteId = saved.remoteId; item.version = saved.version; item.syncState = 'synced'; }
    }
    for (const conflict of conflictRows) {
      const edited = byClient.get(conflict.clientId); if (!edited) continue;
      if (conflict.current.deletedAt) {
        const index = payload.indexOf(edited);
        if (index >= 0) payload.splice(index, 1);
        options.onToast('This thought was deleted on another device, so its offline copy was removed.');
        continue;
      }
      const fork = structuredClone(edited); fork.id = uuid(); fork.clientId = fork.id; fork.remoteId = undefined; fork.version = null;
      fork.originalVersions = fork.originalVersions?.map((version, index) => ({ ...version, id: index === 0 ? fork.id : version.id, pieces: version.pieces.map((piece, pieceIndex) => ({ ...piece, id: index === 0 && pieceIndex === 0 ? fork.id : piece.id, syncedAt: null })) }));
      fork.originalGists = {};
      fork.title = `${fork.title} (offline copy)`; fork.status = 'captured'; fork.blocks = []; fork.createdAt = new Date().toISOString(); fork.updatedAt = fork.createdAt; fork.syncState = 'pending';
      Object.assign(edited, fromRemote(conflict.current, edited)); payload.push(fork);
      options.onToast('An offline edit conflicted with a newer version. Your edit is saved as an offline copy.');
    }

    // Pieces have stable IDs and their own append endpoint. Retrying a saved
    // offline snapshot cannot duplicate a piece or replace another device's words.
    for (const item of payload) {
      if (!item.remoteId) continue;
      for (const version of item.originalVersions ?? []) for (const piece of version.pieces) {
        if (piece.syncedAt) continue;
        const result = await request<{ intention: Record<string, any> }>(`/intentions/${encodeURIComponent(item.remoteId)}/pieces`, {
          method: 'POST', body: JSON.stringify({ id: piece.id, versionId: version.id, content: piece.content, createdAt: piece.createdAt, startNewVersion: true }),
        });
        Object.assign(item, fromRemote(result.intention, item));
      }
    }

    const blockPayload: Array<Record<string, unknown>> = [];
    for (const item of payload) for (const block of item.blocks ?? []) {
      const start = new Date(`${block.date}T${block.time}:00`); const end = new Date(start.getTime() + Number(block.duration || 30) * 60000);
      blockPayload.push({ clientId: block.id, intentionClientId: item.id, startsAt: start.toISOString(), endsAt: end.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', externalProvider: block.externalProvider || null, externalEventId: block.externalEventId || null, externalUrl: block.externalLink || null, syncState: block.syncState || 'local' });
    }
    blockPayload.push(...deletedBlocks.map((block) => ({ ...block, deleted: true })));
    if (blockPayload.length) {
      const savedBlocks: Array<{ clientId: string; remoteId: string }> = [];
      for (const batch of chunkJsonPayload(blockPayload, (blocksInBatch) => ({ blocks: blocksInBatch }))) {
        const result = await request<{ saved?: Array<{ clientId: string; remoteId: string }> }>('/sync/blocks', {
          method: 'POST', body: JSON.stringify({ blocks: batch }),
        });
        savedBlocks.push(...(result.saved ?? []));
      }
      const ids = new Map(savedBlocks.map((row) => [row.clientId, row.remoteId]));
      for (const item of payload) for (const block of item.blocks ?? []) if (ids.has(block.id)) block.remoteId = ids.get(block.id);
    }
    return payload;
  }

  async function syncQueuedPreferences(): Promise<void> {
    await preferenceWrites;
    const revision = preferenceRevision;
    const preferences = await getQueuedPreferences();
    if (!preferences) return;
    const saved = await request<UserPreferences>('/preferences', { method: 'PUT', body: JSON.stringify(preferences) });
    const clearWrite = preferenceWrites.then(async () => {
      if (revision !== preferenceRevision) return false;
      await clearQueuedPreferences();
      return true;
    });
    preferenceWrites = clearWrite.then(() => undefined).catch(() => undefined);
    if (!await clearWrite) { flushAgain = true; return; }
    options.onPreferences(saved);
  }

  async function syncQueuedSuggestionFeedback(): Promise<void> {
    await feedbackWrites;
    const revision = feedbackRevision;
    const feedback = await getQueuedSuggestionFeedback();
    if (!feedback) return;
    const savedFeedback: SuggestionFeedback[] = [];
    for (let offset = 0; offset < feedback.length; offset += 500) {
      const saved = await request<{ feedback: SuggestionFeedback[] }>('/suggestion-feedback', {
        method: 'PUT', body: JSON.stringify({ feedback: feedback.slice(offset, offset + 500) }),
      });
      savedFeedback.push(...(saved.feedback ?? []));
    }
    const clearWrite = feedbackWrites.then(async () => {
      if (revision !== feedbackRevision) return false;
      await clearQueuedSuggestionFeedback();
      return true;
    });
    feedbackWrites = clearWrite.then(() => undefined).catch(() => undefined);
    if (!await clearWrite) { flushAgain = true; return; }
    const current = new Map(cachedSuggestionFeedback().map((item) => [item.clientId, item]));
    for (const item of savedFeedback) current.set(item.clientId, item);
    const merged = [...current.values()];
    writeLocalCache(suggestionFeedbackKey, JSON.stringify(merged));
    options.onSuggestionFeedback(merged);
  }

  function cachedRelationships(): IntentionRelationship[] {
    try {
      const rows = JSON.parse(localStorage.getItem(relationshipsKey) || '[]') as Array<Partial<IntentionRelationship>>;
      return rows.filter((row): row is IntentionRelationship => Boolean(
        row && typeof row.id === 'string' && typeof row.fromClientId === 'string' && typeof row.fromTitle === 'string'
        && typeof row.toClientId === 'string' && typeof row.toTitle === 'string'
        && ['supports', 'related', 'depends_on'].includes(row.relation ?? ''),
      ));
    }
    catch { return []; }
  }

  function applyRelationshipOperations(base: IntentionRelationship[], operations: RelationshipOperation[]): IntentionRelationship[] {
    const byId = new Map(base.map((relationship) => [relationship.id, relationship]));
    for (const operation of operations) {
      const { relationship } = operation;
      if (operation.action === 'create') {
        if (![...byId.values()].some((item) => item.fromClientId === relationship.fromClientId && item.toClientId === relationship.toClientId && item.relation === relationship.relation)) byId.set(relationship.id, relationship);
      } else {
        for (const [id, item] of byId) if (id === relationship.id || (item.fromClientId === relationship.fromClientId && item.toClientId === relationship.toClientId && item.relation === relationship.relation)) byId.delete(id);
      }
    }
    return [...byId.values()];
  }

  async function refreshRelationships(): Promise<void> {
    const result = await request<{ relationships: IntentionRelationship[] }>('/relationships');
    if (accountDeletionRequested || disposed) return;
    const operations = await getQueuedRelationshipOperations();
    if (accountDeletionRequested || disposed) return;
    const merged = applyRelationshipOperations(result.relationships ?? [], operations);
    writeLocalCache(relationshipsKey, JSON.stringify(merged));
    options.onRelationships(merged);
  }

  async function syncQueuedRelationships(): Promise<void> {
    const operations = await getQueuedRelationshipOperations();
    if (!operations.length) return;
    const completed = new Set<string>();
    for (const operation of operations) {
      const { relationship } = operation;
      try {
        if (operation.action === 'create') {
          await request('/relationships', { method: 'POST', body: JSON.stringify({
            fromClientId: relationship.fromClientId, toClientId: relationship.toClientId, relation: relationship.relation,
          }) });
        } else {
          await request('/relationships', { method: 'DELETE', body: JSON.stringify({
            fromClientId: relationship.fromClientId, toClientId: relationship.toClientId, relation: relationship.relation,
          }) });
        }
        completed.add(operation.id);
      } catch (error) {
        if (operation.action === 'create' && (error as { statusCode?: number }).statusCode === 404) {
          completed.add(operation.id);
          options.onToast('A saved link could not sync because an intention is no longer available.');
          continue;
        }
        throw error;
      }
    }
    await removeQueuedRelationshipOperations(completed);
    const remaining = await getQueuedRelationshipOperations();
    if (remaining.length) flushAgain = true;
    if (!remaining.length) await refreshRelationships();
  }

  async function refreshSuggestionFeedback(): Promise<void> {
    const result = await request<{ feedback: SuggestionFeedback[] }>('/suggestion-feedback');
    if (accountDeletionRequested || disposed) return;
    const merged = new Map((result.feedback ?? []).map((item) => [item.clientId, item]));
    const queued = await getQueuedSuggestionFeedback();
    if (accountDeletionRequested || disposed) return;
    for (const item of queued ?? []) merged.set(item.clientId, item);
    const feedback = [...merged.values()];
    options.onSuggestionFeedback(feedback);
    try { localStorage.setItem(suggestionFeedbackKey, JSON.stringify(feedback)); } catch { /* The session can still use the returned values. */ }
  }

  async function flush(): Promise<void> {
    if (accountDeletionRequested || disposed) return;
    if (flushing) { flushAgain = true; return; }
    if (!navigator.onLine) return;
    retryScheduler.cancel();
    flushing = true;
    let failed = false;
    flushIdle = new Promise((resolve) => { finishActiveFlush = resolve; });
    try {
      let queued: Snapshot | null;
      let revisionAtStart: number;
      do {
        await snapshotWrites;
        revisionAtStart = snapshotRevision;
        queued = await getSnapshot();
      } while (revisionAtStart !== snapshotRevision);
      if (queued?.clearAll) {
        await request('/intentions', { method: 'DELETE' }); writeLocalCache(dataKey, '[]');
        await scheduleSnapshotWrite(() => putSnapshot([]));
        await clearQueuedRelationships(); writeLocalCache(relationshipsKey, '[]'); options.onRelationships([]);
        options.onRemote([]); getAlignmentStore().clearThoughtLinks(); clearRequested = false;
      } else if (queued) {
        const uploaded = await push(queued.items ?? [], queued.deletedBlocks ?? []);
        const pulled = await pull(uploaded);
        const merged = pulled.items;
        if (revisionAtStart !== snapshotRevision) {
          flushAgain = true;
          await scheduleSnapshotWrite(async () => {
            const revisionAtCommit = snapshotRevision;
            const latest = await getSnapshot();
            if (latest?.clearAll) return;
            if (revisionAtCommit !== snapshotRevision) return;
            const current = new Map(merged.map((item) => [item.id, item]));
            for (const item of latest?.items ?? []) if (item.syncState === 'pending') current.set(item.id, item);
            const preserved = [...current.values()].sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
            await putSnapshot(preserved, false, latest?.deletedBlocks ?? queued.deletedBlocks ?? []);
            if (revisionAtCommit !== snapshotRevision) return;
            writeLocalCache(dataKey, JSON.stringify(preserved));
            writeLocalCache(syncKey, pulled.serverTime);
            options.onRemote(preserved);
          });
        } else {
          await scheduleSnapshotWrite(async () => {
            const revisionAtCommit = snapshotRevision;
            await putSnapshot(merged);
            if (revisionAtCommit !== snapshotRevision) { flushAgain = true; return; }
            writeLocalCache(dataKey, JSON.stringify(merged));
            writeLocalCache(syncKey, pulled.serverTime);
            options.onRemote(merged);
          });
        }
      }
      await syncQueuedPreferences();
      await syncQueuedSuggestionFeedback();
      await syncQueuedRelationships();
      if (options.onAlignments) {
        await getAlignmentStore().sync();
        if (getAlignmentStore().rows.some((row) => row.syncState === 'pending')) flushAgain = true;
      }
      const alignmentConflict = options.onAlignments && getAlignmentStore().rows.some((row) => row.syncState === 'conflict');
      options.onState(alignmentConflict ? 'Align changes need review' : queued?.clearAll ? 'Your synced space is clear' : 'Synced across your devices', Boolean(alignmentConflict));
      retryScheduler.reset();
    } catch (error) {
      failed = true;
      options.onState(navigator.onLine ? 'Saved here. Sync will retry.' : 'Saved offline. Sync will resume when connected.', true);
      console.warn('Veylo sync deferred:', error);
      scheduleRetry();
    } finally {
      flushing = false;
      finishActiveFlush?.(); finishActiveFlush = null;
      if (flushAgain && !accountDeletionRequested && !disposed) {
        flushAgain = false;
        if (!failed) void flush();
      }
    }
  }

  function queue(items: SyncIntention[]): Promise<void> {
    if (clearRequested || disposed) return Promise.reject(new Error('Offline sync is closing.'));
    let normalized: SyncIntention[];
    try { normalized = normalize(items); } catch (error) { return Promise.reject(error); }
    snapshotRevision += 1;
    if (flushing) flushAgain = true;
    const write = scheduleSnapshotWrite(async () => {
      if (clearRequested) return;
      const previous = await getSnapshot();
      const active = new Set(normalized.flatMap((item) => (item.blocks ?? []).map((block) => block.id)));
      const tombstones = previous?.deletedBlocks ?? [];
      for (const item of previous?.items ?? []) for (const block of item.blocks ?? []) {
        if (active.has(block.id) || tombstones.some((deleted) => deleted.clientId === block.id)) continue;
        const start = new Date(`${block.date}T${block.time}:00`);
        tombstones.push({ clientId: block.id, intentionClientId: item.id, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + Number(block.duration || 30) * 60000).toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', externalProvider: block.externalProvider || null, externalEventId: block.externalEventId || null, externalUrl: block.externalLink || null, syncState: block.syncState || 'local' });
      }
      await putSnapshot(normalized, false, tombstones);
    });
    void write.then(() => {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(() => void flush(), 500);
    }).catch(() => options.onState('Offline storage unavailable', true));
    return write;
  }

  async function initializeClient(items: SyncIntention[]): Promise<void> {
    let initial = normalize(items); const cached = await getSnapshot();
    if (cached?.clearAll) initial = [];
    else {
      let latestLocal: SyncIntention[] = [];
      try { latestLocal = normalize(JSON.parse(localStorage.getItem(dataKey) || '[]') as SyncIntention[]); } catch { /* Keep the durable IndexedDB copy. */ }
      const merged = new Map((cached?.items ?? initial).map((item) => [item.id, item]));
      for (const item of latestLocal) { const current = merged.get(item.id); if (!current || Date.parse(item.updatedAt || item.createdAt) >= Date.parse(current.updatedAt || current.createdAt)) merged.set(item.id, item); }
      initial = [...merged.values()];
    }
    // Captures can arrive while IndexedDB is opening. Read the latest browser
    // copy before the first snapshot write, then serialize that write with the
    // normal outbox so startup cannot replace a just-saved capture.
    try { localStorage.setItem(dataKey, JSON.stringify(initial)); } catch { /* IndexedDB remains the durable browser copy. */ }
    const initialWrite = scheduleSnapshotWrite(async () => {
      const latest = await getSnapshot();
      if (clearRequested || latest?.clearAll) { options.onRemote([]); return; }
      const merged = new Map(initial.map((item) => [item.id, item]));
      for (const item of latest?.items ?? []) {
        const current = merged.get(item.id);
        if (!current || item.syncState === 'pending' || Date.parse(item.updatedAt || item.createdAt) >= Date.parse(current.updatedAt || current.createdAt)) merged.set(item.id, item);
      }
      const durableItems = [...merged.values()];
      try { localStorage.setItem(dataKey, JSON.stringify(durableItems)); } catch { /* IndexedDB remains the durable browser copy. */ }
      await putSnapshot(durableItems, false, latest?.deletedBlocks ?? cached?.deletedBlocks ?? []);
      options.onRemote(durableItems);
    });
    await initialWrite;
    try { await refreshIntegrations(); } catch { /* Capture remains usable when offline. */ }
    if (options.onAlignments) {
      try { options.onAlignments(getAlignmentStore().rows); }
      catch (error) { options.onToast(error instanceof Error ? error.message : 'Could not load Align data.'); }
    }
    options.onRelationships(cachedRelationships());
    try { await refreshRelationships(); } catch { /* Relationship reads can retry after reconnect. */ }
    options.onSuggestionFeedback(cachedSuggestionFeedback());
    try { await refreshSuggestionFeedback(); } catch { /* Feedback remains available offline and retries after reconnect. */ }
    try {
      const pending = await getQueuedPreferences();
      options.onPreferences(pending ?? await request<UserPreferences>('/preferences'));
    } catch { /* Keep local preferences when offline. */ }
    await flush();
  }

  function start(items: SyncIntention[]): Promise<void> {
    const operation = initializeClient(items);
    startupDone = operation.catch(() => undefined);
    return operation;
  }

  const onOnline = () => { flushImmediately(); void refreshRelationships().catch(() => undefined); void refreshSuggestionFeedback().catch(() => undefined); };
  const onFocus = () => { flushImmediately(); void refreshRelationships().catch(() => undefined); void refreshSuggestionFeedback().catch(() => undefined); };
  window.addEventListener('online', onOnline); window.addEventListener('focus', onFocus);

  return {
    start, queue, flush,
    saveAlignment(input, expectedVersion, replaceConflict) {
      if (clearRequested || accountDeletionRequested || disposed) throw new Error('This session is closing.');
      getAlignmentStore().save(input, expectedVersion, replaceConflict);
      options.onState('Saved here · syncing', false);
      void flush();
    },
    useSyncedAlignment(id) { getAlignmentStore().useSynced(id); },
    async connectionCatalog() { return (await request<{ providers: ConnectionCatalog[] }>('/integrations/catalog')).providers; },
    async refreshConnections() { await refreshIntegrations(); return integrationCache; },
    async connectProvider(provider) {
      const result = await request<{ authorizationUrl: string }>(`/integrations/${provider}/connect`, { method: 'POST', body: '{}' });
      window.location.assign(result.authorizationUrl);
    },
    async connectIcloud(credentials) {
      await request('/integrations/icloud/connect', { method: 'POST', body: JSON.stringify(credentials) });
      integrationCache = [...integrationCache.filter((item) => item.provider !== 'icloud'), { provider: 'icloud', connected: true }];
      options.onIntegrations(integrationCache);
      await refreshIntegrations().catch(() => undefined);
    },
    async disconnectProvider(provider) {
      const result = await request<{ revocationWarning?: string } | undefined>(`/integrations/${provider}`, { method: 'DELETE' });
      integrationCache = integrationCache.filter((item) => item.provider !== connectionProviderId(provider));
      options.onIntegrations(integrationCache);
      await refreshIntegrations().catch(() => undefined);
      return result ?? {};
    },
    connectionEntries(provider) { return request<ConnectionEntries>(`/integrations/${provider}/entries`); },
    async completeOAuth(provider, code, state) {
      await request(`/integrations/${provider}/complete`, { method: 'POST', body: JSON.stringify({ code, state }) });
      const providerId = connectionProviderId(provider);
      integrationCache = [
        ...integrationCache.filter((item) => item.provider !== providerId),
        { provider: providerId, connected: true },
      ];
      options.onIntegrations(integrationCache);
      await refreshIntegrations().catch(() => undefined);
    },
    async connectGoogle() { const result = await request<{ authorizationUrl: string }>('/integrations/google/connect', { method: 'POST', body: '{}' }); window.location.assign(result.authorizationUrl); },
    async disconnectGoogle() {
      const result = await request<{ revocationWarning?: string }>('/integrations/google', { method: 'DELETE' });
      integrationCache = integrationCache.filter((item) => item.provider !== 'google_calendar');
      options.onIntegrations(integrationCache);
      await refreshIntegrations().catch(() => undefined);
      return result;
    },
    async connectJira() { const result = await request<{ authorizationUrl: string }>('/integrations/jira/connect', { method: 'POST', body: '{}' }); window.location.assign(result.authorizationUrl); },
    async disconnectJira() {
      await request('/integrations/jira', { method: 'DELETE' });
      integrationCache = integrationCache.filter((item) => item.provider !== 'jira_cloud');
      options.onIntegrations(integrationCache);
      await refreshIntegrations().catch(() => undefined);
    },
    getJiraIssues() { return request<{ siteName: string; issues: JiraIssue[] }>('/integrations/jira/issues'); },
    async connectNotion() { const result = await request<{ authorizationUrl: string }>('/integrations/notion/connect', { method: 'POST', body: '{}' }); window.location.assign(result.authorizationUrl); },
    async disconnectNotion() {
      const result = await request<{ revocationWarning?: string }>('/integrations/notion', { method: 'DELETE' });
      integrationCache = integrationCache.filter((item) => item.provider !== 'notion');
      options.onIntegrations(integrationCache);
      await refreshIntegrations().catch(() => undefined);
      return result;
    },
    getNotionPages(cursor?: string) { return request<NotionPageResult>(`/integrations/notion/pages${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`); },
    calendarAvailability(startsAt, endsAt, timezone) { return request<{ busy: Array<{ start: string; end: string }> }>('/integrations/google/availability', { method: 'POST', body: JSON.stringify({ startsAt, endsAt, timezone }) }); },
    createCalendarEvent(timeBlockId) { return request<{ externalEventId: string; externalUrl?: string; alreadyExists?: boolean }>('/integrations/google/events', { method: 'POST', body: JSON.stringify({ timeBlockId }) }); },
    async setPreferences(preferences) {
      if (accountDeletionRequested) throw new Error('Account deletion is in progress.');
      writeLocalCache(preferencesKey, JSON.stringify(preferences));
      preferenceRevision += 1;
      if (flushing) flushAgain = true;
      const write = preferenceWrites.then(() => putQueuedPreferences(preferences));
      preferenceWrites = write.catch(() => undefined);
      await write;
      options.onPreferences(preferences);
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(() => void flush(), 500);
    },
    getWebPushConfig() { return request<WebPushConfig>('/notifications/web/config'); },
    async enableWebPush(subscription) { await request('/notifications/web', { method: 'POST', body: JSON.stringify(subscription) }); },
    async disableWebPush(endpoint) { await request('/notifications/web', { method: 'DELETE', body: JSON.stringify({ endpoint }) }); },
    async createRelationship(fromClientId, toClientId, relation) {
      if (clearRequested) throw new Error('Your space is being cleared. Try again after it finishes.');
      const cached = cachedRelationships();
      if (cached.some((item) => item.fromClientId === fromClientId && item.toClientId === toClientId && item.relation === relation)) return null;
      let localItems: SyncIntention[] = [];
      try { localItems = JSON.parse(localStorage.getItem(dataKey) || '[]') as SyncIntention[]; } catch { /* use fallback titles */ }
      const title = (clientId: string) => localItems.find((item) => (item.clientId ?? item.id) === clientId)?.title ?? 'A thought';
      const relationship: IntentionRelationship = { id: `local:${uuid()}`, fromClientId, fromTitle: title(fromClientId), toClientId, toTitle: title(toClientId), relation };
      await queueRelationshipOperation('create', relationship);
      const visible = applyRelationshipOperations(cached, await getQueuedRelationshipOperations());
      writeLocalCache(relationshipsKey, JSON.stringify(visible)); options.onRelationships(visible);
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(() => void flush(), 250);
      return relationship;
    },
    async deleteRelationship(id) {
      if (clearRequested) return;
      const relationship = cachedRelationships().find((item) => item.id === id);
      if (!relationship) return;
      await queueRelationshipOperation('delete', relationship);
      const visible = applyRelationshipOperations(cachedRelationships(), await getQueuedRelationshipOperations());
      writeLocalCache(relationshipsKey, JSON.stringify(visible)); options.onRelationships(visible);
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(() => void flush(), 250);
    },
    setSuggestionFeedback(clientId, state, snoozedUntil = null) {
      if (accountDeletionRequested) return Promise.reject(new Error('Account deletion is in progress.'));
      feedbackRevision += 1;
      if (flushing) flushAgain = true;
      const write = feedbackWrites.then(async () => {
        const current = new Map(cachedSuggestionFeedback().map((item) => [item.clientId, item]));
        for (const item of await getQueuedSuggestionFeedback() ?? []) current.set(item.clientId, item);
        current.set(clientId, { clientId, state, snoozedUntil: state === 'snoozed' ? snoozedUntil : null });
        const feedback = [...current.values()];
        await putQueuedSuggestionFeedback(feedback);
        try { localStorage.setItem(suggestionFeedbackKey, JSON.stringify(feedback)); } catch { /* IndexedDB remains the durable queue. */ }
        options.onSuggestionFeedback(feedback);
      });
      feedbackWrites = write.catch(() => undefined);
      return write.then(() => {
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = setTimeout(() => void flush(), 250);
      });
    },
    setAIInterpretation(enabled) { return request<{ aiInterpretationEnabled: boolean }>('/preferences', { method: 'PUT', body: JSON.stringify({ aiInterpretationEnabled: enabled }) }); },
    async getBrainstormMessages(intentionId) {
      const result = await request<{ messages: BrainstormMessage[] }>(`/intentions/${encodeURIComponent(intentionId)}/brainstorm`);
      return result.messages;
    },
    evaluateThought(intentionId) { return request(`/intentions/${encodeURIComponent(intentionId)}/evaluate`, { method: 'POST' }); },
    async getIntentionHistory(intentionId) {
      const result = await request<{ history: IntentionHistoryEntry[] }>(`/intentions/${encodeURIComponent(intentionId)}/history`);
      return result.history;
    },
    sendBrainstormMessage(intentionId, clientRequestId, message) {
      return request<{ message: BrainstormMessage; queued: boolean }>(`/intentions/${encodeURIComponent(intentionId)}/brainstorm`, {
        method: 'POST', body: JSON.stringify({ clientRequestId, message }),
      });
    },
    async undoAIInterpretation(remoteId, expectedVersion) {
      const result = await request<{ intention: Record<string, any> }>(`/intentions/${encodeURIComponent(remoteId)}/interpretation/undo`, { method: 'POST', body: JSON.stringify({ expectedVersion }) });
      return fromRemote(result.intention);
    },
    async deleteEverything() {
      clearRequested = true;
      snapshotRevision += 1;
      if (flushing) flushAgain = true;
      await clearQueuedRelationships();
      writeLocalCache(relationshipsKey, '[]'); options.onRelationships([]);
      snapshotRevision += 1;
      const write = scheduleSnapshotWrite(() => putSnapshot([], true));
      await write; await flush();
    },
    signOut: options.signOut,
    async exportData() {
      await Promise.all([snapshotWrites, preferenceWrites, feedbackWrites, relationshipWrites]);
      const readJson = <T,>(key: string, fallback: T): T => {
        try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
      };
      const [snapshot, queuedPreferences, queuedFeedback, queuedRelationships] = await Promise.all([
        getSnapshot().catch(() => null), getQueuedPreferences().catch(() => null),
        getQueuedSuggestionFeedback().catch(() => null), getQueuedRelationshipOperations().catch(() => []),
      ]);
      const deviceCache = {
        exportedAt: new Date().toISOString(),
        intentions: readJson<SyncIntention[]>(dataKey, []),
        alignments: readJson<LocalAlignment[]>(alignmentsKey, []),
        relationships: readJson<IntentionRelationship[]>(relationshipsKey, []),
        suggestionFeedback: readJson<SuggestionFeedback[]>(suggestionFeedbackKey, []),
        preferences: readJson<Partial<UserPreferences>>(preferencesKey, {}),
        outbox: { snapshot, preferences: queuedPreferences, suggestionFeedback: queuedFeedback, relationships: queuedRelationships },
      };
      if (!navigator.onLine) return { exportedAt: new Date().toISOString(), exportScope: 'device-only', deviceCache };
      try {
        const account = await request<Record<string, unknown>>('/account/export');
        return { ...account, exportScope: 'account-and-device', deviceCache };
      } catch {
        return { exportedAt: new Date().toISOString(), exportScope: 'device-only', exportNote: 'The account export could not be reached; this file contains only the current browser’s saved data.', deviceCache };
      }
    },
    async deleteAccount() {
      accountDeletionRequested = true;
      clearRequested = true;
      retryScheduler.cancel();
      snapshotRevision += 1;
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      let externalRevocationWarnings: string[] = [];
      try {
        await startupDone;
        await flushIdle;
        await waitForActiveRequests();
        await Promise.all([snapshotWrites, preferenceWrites, feedbackWrites, relationshipWrites]);
        const result = await request<{ externalRevocationWarnings?: string[] }>('/account', { method: 'DELETE' }, true);
        externalRevocationWarnings = Array.isArray(result?.externalRevocationWarnings)
          ? result.externalRevocationWarnings.filter((warning): warning is string => typeof warning === 'string') : [];
      } catch (error) {
        accountDeletionRequested = false;
        clearRequested = false;
        void flush();
        throw error;
      }
      let localDataCleared = true;
      try { await clearAccountOutbox(); } catch { localDataCleared = false; }
      for (const key of [dataKey, syncKey, preferencesKey, relationshipsKey, suggestionFeedbackKey, alignmentsKey]) {
        try { localStorage.removeItem(key); } catch { localDataCleared = false; }
      }
      try { await options.signOut(); } catch { localDataCleared = false; }
      return { localDataCleared, externalRevocationWarnings };
    },
    dispose() {
      disposed = true;
      for (const controller of activeRequests) controller.abort();
      activeRequests.clear();
      retryScheduler.dispose();
      window.removeEventListener('online', onOnline); window.removeEventListener('focus', onFocus);
      if (flushTimer) clearTimeout(flushTimer);
    },
  };
}
