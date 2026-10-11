import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { legacyRowMatches, legacyRowProjection, legacyTableColumns, type LegacyRow } from './legacy-migration';

const databases = new Map<string, ReturnType<typeof SQLite.openDatabaseAsync>>();
const initialized = new Map<string, Promise<Awaited<ReturnType<typeof SQLite.openDatabaseAsync>>>>();
const writeTails = new Map<string, Promise<void>>();
const activeReads = new Map<string, number>();
const readWaiters = new Map<string, Array<() => void>>();
const deletingUsers = new Set<string>();
const databaseName = (userId: string) => `veylo-encrypted-${userId}.db`;
const legacyDatabaseName = (userId: string) => `veylo-${userId}.db`;
const databaseKeyName = (userId: string) => `veylo-sqlcipher-key-${userId}`;
const databaseMigrationName = (userId: string) => `veylo-sqlcipher-migrated-${userId}`;

async function databaseEncryptionKey(userId: string): Promise<string> {
  const keyName = databaseKeyName(userId);
  const existing = await SecureStore.getItemAsync(keyName);
  if (existing) {
    if (!/^[0-9a-f]{64}$/i.test(existing)) throw new Error('This device’s encrypted intention store key is invalid. Contact support before clearing app data.');
    return existing;
  }
  const bytes = await Crypto.getRandomBytesAsync(32);
  const key = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(keyName, key);
  return key;
}

function database(userId: string) {
  if (deletingUsers.has(userId)) throw new Error('This account’s local data is being deleted.');
  if (!databases.has(userId)) {
    const setup = (async () => {
      const key = await databaseEncryptionKey(userId);
      const db = await SQLite.openDatabaseAsync(databaseName(userId));
      try {
        await db.execAsync(`PRAGMA key = '${key}'; PRAGMA secure_delete = ON;`);
        const cipher = await db.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version');
        if (!cipher?.cipher_version) throw new Error('Encrypted local storage is unavailable in this build. Install a Veylo development or production build with SQLCipher enabled.');
        return db;
      } catch (error) {
        await db.closeAsync().catch(() => undefined);
        throw error;
      }
    })();
    databases.set(userId, setup);
    void setup.catch(() => { if (databases.get(userId) === setup) databases.delete(userId); });
  }
  return databases.get(userId)!;
}

async function migratePlaintextDatabase(userId: string, encrypted: Awaited<ReturnType<typeof SQLite.openDatabaseAsync>>): Promise<void> {
  const marker = databaseMigrationName(userId);
  if (await SecureStore.getItemAsync(marker) === 'complete') return;
  const legacy = await SQLite.openDatabaseAsync(legacyDatabaseName(userId));
  let legacyTables: string[] = [];
  try {
    const existingTables = new Set((await legacy.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    )).map((row) => row.name));
    legacyTables = Object.keys(legacyTableColumns).filter((table) => existingTables.has(table));
    if (legacyTables.length) {
      await encrypted.withTransactionAsync(async () => {
        for (const table of legacyTables) {
          const rows = await legacy.getAllAsync<LegacyRow>(`SELECT * FROM "${table}"`);
          for (const row of rows) {
            const projection = legacyRowProjection(table, row);
            const names = projection.columns.map((column) => `"${column}"`).join(', ');
            const slots = projection.columns.map(() => '?').join(', ');
            await encrypted.runAsync(
              `INSERT OR IGNORE INTO "${table}" (${names}) VALUES (${slots})`,
              ...projection.columns.map((column) => row[column] ?? null),
            );
            const copied = await encrypted.getFirstAsync<LegacyRow>(
              `SELECT ${names} FROM "${table}" WHERE "${projection.key}" = ?`, projection.keyValue,
            );
            if (!legacyRowMatches(projection.columns, row, copied)) {
              throw new Error(`The local data migration could not verify every row in ${table}; the original data was retained.`);
            }
          }
        }
      });
      await legacy.execAsync('PRAGMA secure_delete = ON;');
      for (const table of legacyTables) await legacy.execAsync(`DELETE FROM "${table}";`);
      await legacy.execAsync('PRAGMA wal_checkpoint(TRUNCATE);');
    }
  } finally {
    await legacy.closeAsync();
  }
  await SQLite.deleteDatabaseAsync(legacyDatabaseName(userId));
  await SecureStore.setItemAsync(marker, 'complete');
}

function enqueueWrite<T>(userId: string, write: () => Promise<T>): Promise<T> {
  if (deletingUsers.has(userId)) return Promise.reject(new Error('This account’s local data is being deleted.'));
  const previous = writeTails.get(userId) ?? Promise.resolve();
  const current = previous.then(write, write);
  writeTails.set(userId, current.then(() => undefined, () => undefined));
  return current;
}

function withRead<T>(userId: string, read: () => Promise<T>): Promise<T> {
  if (deletingUsers.has(userId)) return Promise.reject(new Error('This account’s local data is being deleted.'));
  activeReads.set(userId, (activeReads.get(userId) ?? 0) + 1);
  return Promise.resolve().then(read).finally(() => {
    const remaining = (activeReads.get(userId) ?? 1) - 1;
    if (remaining > 0) activeReads.set(userId, remaining);
    else {
      activeReads.delete(userId);
      for (const resolve of readWaiters.get(userId) ?? []) resolve();
      readWaiters.delete(userId);
    }
  });
}

function waitForReads(userId: string): Promise<void> {
  if (!activeReads.get(userId)) return Promise.resolve();
  return new Promise((resolve) => {
    const waiters = readWaiters.get(userId) ?? [];
    waiters.push(resolve);
    readWaiters.set(userId, waiters);
  });
}

export type LocalIntention = {
  id: string; remoteId: string | null; rawCapture: string; title: string; kind: string;
  intent: string | null; purpose: string | null; desiredOutcome: string | null; roughPlan: string | null;
  horizon: string | null; effortEstimate: number | null; energyContext: string | null; version: number | null; blocks: LocalTimeBlock[];
  status: string; createdAt: string; updatedAt: string; syncState: 'pending' | 'synced';
  aiInterpretation?: { confidence: number | null; rationale: string | null; model: string | null; processedAt: string; undoneAt: string | null; canUndo: boolean } | null;
};
export type LocalTimeBlock = {
  id: string; remoteId: string | null; startsAt: string; endsAt: string; timezone: string;
  externalEventId: string | null; externalUrl: string | null; syncState: 'local' | 'pending' | 'synced';
};
export type LocalTimeBlockDeletion = {
  clientId: string; intentionClientId: string; startsAt: string; endsAt: string; timezone: string;
};
export type LocalRelationship = {
  id: string; fromClientId: string; fromTitle: string; toClientId: string; toTitle: string;
  relation: 'supports' | 'related' | 'depends_on';
};
export type LocalRelationshipOperation = { opId: string; action: 'create' | 'delete'; relationship: LocalRelationship };
export type LocalSuggestionFeedback = {
  clientId: string; state: 'open' | 'accepted' | 'dismissed' | 'snoozed';
  snoozedUntil: string | null; syncState: 'pending' | 'synced';
};
export type LocalPreferences = {
  aiInterpretationEnabled: boolean; reduceMotion: boolean; suggestionsEnabled: boolean; suggestionLimit: number;
  quietStart: string | null; quietEnd: string | null; timezone: string | null;
};

export function initializeStore(userId: string) {
  if (deletingUsers.has(userId)) return Promise.reject(new Error('This account’s local data is being deleted.'));
  const existing = initialized.get(userId);
  if (existing) return existing;
  const setup = initializeDatabase(userId);
  initialized.set(userId, setup);
  void setup.catch(() => { if (initialized.get(userId) === setup) initialized.delete(userId); });
  return setup;
}

async function initializeDatabase(userId: string) {
  const db = await database(userId);
  await db.execAsync(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS intentions (
      id TEXT PRIMARY KEY NOT NULL, remote_id TEXT, raw_capture TEXT NOT NULL,
      title TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
      intent TEXT, purpose TEXT, desired_outcome TEXT, rough_plan TEXT, horizon TEXT, effort_estimate INTEGER, energy_context TEXT,
      version INTEGER, blocks_json TEXT NOT NULL DEFAULT '[]',
      ai_interpretation_json TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      sync_state TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS relationships (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS relationship_outbox (op_id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS suggestion_feedback (
      client_id TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL,
      snoozed_until TEXT, sync_state TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE IF NOT EXISTS local_preferences (id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1), payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS preferences_outbox (id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1), payload TEXT NOT NULL);`);
  await db.execAsync(`CREATE TABLE IF NOT EXISTS time_block_deletions (
    client_id TEXT PRIMARY KEY NOT NULL, intention_client_id TEXT NOT NULL,
    starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, timezone TEXT NOT NULL
  );`);
  const columns = new Set((await db.getAllAsync<{ name: string }>('PRAGMA table_info(intentions)')).map((column) => column.name));
  const additions: Array<[string, string]> = [
    ['intent', 'TEXT'], ['purpose', 'TEXT'], ['desired_outcome', 'TEXT'], ['rough_plan', 'TEXT'],
    ['horizon', 'TEXT'], ['effort_estimate', 'INTEGER'], ['energy_context', 'TEXT'], ['version', 'INTEGER'], ['blocks_json', "TEXT NOT NULL DEFAULT '[]'"], ['ai_interpretation_json', 'TEXT'],
  ];
  for (const [name, type] of additions) if (!columns.has(name)) await db.execAsync(`ALTER TABLE intentions ADD COLUMN ${name} ${type}`);
  await migratePlaintextDatabase(userId, db);
  return db;
}

export function getLocalFlag(userId: string, key: string): Promise<boolean> {
  return withRead(userId, async () => {
  const db = await initializeStore(userId);
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM sync_meta WHERE key = ?', key);
  return row?.value === 'true';
  });
}

export function setLocalFlag(userId: string, key: string, value: boolean): Promise<void> {
  return enqueueWrite(userId, async () => {
  const db = await initializeStore(userId);
  await db.runAsync('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)', key, value ? 'true' : 'false');
  });
}

export function getLocalValue(userId: string, key: string): Promise<string | null> {
  return withRead(userId, async () => {
  const db = await initializeStore(userId);
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM sync_meta WHERE key = ?', key);
  return row?.value ?? null;
  });
}

export function setLocalValue(userId: string, key: string, value: string): Promise<void> {
  return enqueueWrite(userId, async () => {
  const db = await initializeStore(userId);
  await db.runAsync('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)', key, value);
  });
}

async function readLocalPreferencesRow(userId: string, table: 'local_preferences' | 'preferences_outbox'): Promise<LocalPreferences | null> {
  const db = await initializeStore(userId);
  const row = await db.getFirstAsync<{ payload: string }>(`SELECT payload FROM ${table} WHERE id = 1`);
  if (!row) return null;
  try {
    const value = JSON.parse(row.payload) as LocalPreferences;
    return value && typeof value.aiInterpretationEnabled === 'boolean' && typeof value.reduceMotion === 'boolean'
      && typeof value.suggestionsEnabled === 'boolean' && Number.isInteger(value.suggestionLimit)
      && (value.quietStart === null || typeof value.quietStart === 'string')
      && (value.quietEnd === null || typeof value.quietEnd === 'string')
      && (value.timezone === null || typeof value.timezone === 'string') ? value : null;
  } catch { return null; }
}

export function getLocalPreferences(userId: string) { return withRead(userId, () => readLocalPreferencesRow(userId, 'local_preferences')); }
export function getPendingLocalPreferences(userId: string) { return withRead(userId, () => readLocalPreferencesRow(userId, 'preferences_outbox')); }

export function saveLocalPreferences(userId: string, preferences: LocalPreferences, pending = true): Promise<void> {
  return enqueueWrite(userId, async () => {
  const db = await initializeStore(userId);
  const payload = JSON.stringify(preferences);
  await db.withTransactionAsync(async () => {
    await db.runAsync('INSERT OR REPLACE INTO local_preferences (id, payload) VALUES (1, ?)', payload);
    if (pending) await db.runAsync('INSERT OR REPLACE INTO preferences_outbox (id, payload) VALUES (1, ?)', payload);
  });
  });
}

export function clearPendingLocalPreferences(userId: string, expected: LocalPreferences): Promise<boolean> {
  return enqueueWrite(userId, async () => {
  const db = await initializeStore(userId);
  const expectedPayload = JSON.stringify(expected);
  let cleared = false;
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<{ payload: string }>('SELECT payload FROM preferences_outbox WHERE id = 1');
    if (row?.payload !== expectedPayload) return;
    await db.runAsync('DELETE FROM preferences_outbox WHERE id = 1');
    cleared = true;
  });
  return cleared;
  });
}

export function listLocalRelationships(userId: string): Promise<LocalRelationship[]> {
  return withRead(userId, async () => {
  const db = await initializeStore(userId);
  const rows = await db.getAllAsync<{ payload: string }>('SELECT payload FROM relationships ORDER BY rowid');
  return rows.flatMap(({ payload }) => {
    try {
      const row = JSON.parse(payload) as LocalRelationship;
      return row && typeof row.id === 'string' && typeof row.fromClientId === 'string'
        && typeof row.toClientId === 'string' && ['supports', 'related', 'depends_on'].includes(row.relation) ? [row] : [];
    } catch { return []; }
  });
  });
}

export function saveLocalRelationships(userId: string, relationships: LocalRelationship[]) {
  return enqueueWrite(userId, async () => {
  const db = await initializeStore(userId);
  await db.withTransactionAsync(async () => {
    await db.execAsync('DELETE FROM relationships');
    for (const relationship of relationships) {
      await db.runAsync('INSERT OR REPLACE INTO relationships (id, payload) VALUES (?, ?)', relationship.id, JSON.stringify(relationship));
    }
  });
  });
}

export function listLocalRelationshipOperations(userId: string): Promise<LocalRelationshipOperation[]> {
  return withRead(userId, async () => {
  const db = await initializeStore(userId);
  const rows = await db.getAllAsync<{ payload: string }>('SELECT payload FROM relationship_outbox ORDER BY rowid');
  return rows.flatMap(({ payload }) => {
    try {
      const operation = JSON.parse(payload) as LocalRelationshipOperation;
      return operation && typeof operation.opId === 'string' && ['create', 'delete'].includes(operation.action)
        && typeof operation.relationship?.fromClientId === 'string' && typeof operation.relationship?.toClientId === 'string'
        && ['supports', 'related', 'depends_on'].includes(operation.relationship?.relation) ? [operation] : [];
    } catch { return []; }
  });
  });
}

export async function deleteLocalRelationshipOperations(userId: string, opIds: string[]): Promise<void> {
  if (!opIds.length) return;
  await enqueueWrite(userId, async () => {
  const db = await initializeStore(userId);
  await db.withTransactionAsync(async () => {
    for (const opId of opIds) await db.runAsync('DELETE FROM relationship_outbox WHERE op_id = ?', opId);
  });
  });
}

export function queueLocalRelationshipOperation(userId: string, operation: LocalRelationshipOperation) {
  return enqueueWrite(userId, async () => {
  const db = await initializeStore(userId);
  await db.runAsync('INSERT OR REPLACE INTO relationship_outbox (op_id, payload) VALUES (?, ?)', operation.opId, JSON.stringify(operation));
  });
}

export function clearLocalRelationshipOperations(userId: string) {
  return enqueueWrite(userId, async () => {
  const db = await initializeStore(userId);
  await db.execAsync('DELETE FROM relationship_outbox');
  });
}

export function applyLocalRelationshipOperations(userId: string, base: LocalRelationship[]): Promise<LocalRelationship[]> {
  return withRead(userId, async () => {
  const byId = new Map(base.map((relationship) => [relationship.id, relationship]));
  for (const operation of await listLocalRelationshipOperations(userId)) {
    const { relationship } = operation;
    if (operation.action === 'create') {
      if (![...byId.values()].some((item) => item.fromClientId === relationship.fromClientId && item.toClientId === relationship.toClientId && item.relation === relationship.relation)) byId.set(relationship.id, relationship);
    } else {
      for (const [id, item] of byId) if (id === relationship.id || (item.fromClientId === relationship.fromClientId && item.toClientId === relationship.toClientId && item.relation === relationship.relation)) byId.delete(id);
    }
  }
  return [...byId.values()];
  });
}

export function listLocalSuggestionFeedback(userId: string): Promise<LocalSuggestionFeedback[]> {
  return withRead(userId, async () => {
  const db = await initializeStore(userId);
  return db.getAllAsync<LocalSuggestionFeedback>(
    'SELECT client_id AS clientId, state, snoozed_until AS snoozedUntil, sync_state AS syncState FROM suggestion_feedback',
  );
  });
}

export function saveLocalSuggestionFeedback(userId: string, feedback: LocalSuggestionFeedback[]) {
  return enqueueWrite(userId, async () => {
  const db = await initializeStore(userId);
  await db.withTransactionAsync(async () => {
    await db.execAsync('DELETE FROM suggestion_feedback');
    for (const item of feedback) {
      await db.runAsync(
        'INSERT OR REPLACE INTO suggestion_feedback (client_id, state, snoozed_until, sync_state) VALUES (?, ?, ?, ?)',
        item.clientId, item.state, item.snoozedUntil, item.syncState,
      );
    }
  });
  });
}

export function putLocalSuggestionFeedback(userId: string, item: LocalSuggestionFeedback): Promise<LocalSuggestionFeedback[]> {
  return enqueueWrite(userId, async () => {
  const db = await initializeStore(userId);
  await db.runAsync(
    'INSERT OR REPLACE INTO suggestion_feedback (client_id, state, snoozed_until, sync_state) VALUES (?, ?, ?, ?)',
    item.clientId, item.state, item.snoozedUntil, item.syncState,
  );
  const rows = await db.getAllAsync<LocalSuggestionFeedback>(
    'SELECT client_id AS clientId, state, snoozed_until AS snoozedUntil, sync_state AS syncState FROM suggestion_feedback',
  );
  return rows;
  });
}

export function listLocal(userId: string): Promise<LocalIntention[]> {
  return withRead(userId, async () => {
  const db = await initializeStore(userId);
  const rows = await db.getAllAsync<Omit<LocalIntention, 'blocks' | 'aiInterpretation'> & { blocksJson: string; aiInterpretationJson: string | null }>(
    'SELECT id, remote_id AS remoteId, raw_capture AS rawCapture, title, kind, status, intent, purpose, desired_outcome AS desiredOutcome, rough_plan AS roughPlan, horizon, effort_estimate AS effortEstimate, energy_context AS energyContext, version, blocks_json AS blocksJson, ai_interpretation_json AS aiInterpretationJson, created_at AS createdAt, updated_at AS updatedAt, sync_state AS syncState FROM intentions ORDER BY updated_at DESC');
  return rows.map(({ blocksJson, aiInterpretationJson, ...row }) => ({
    ...row, blocks: JSON.parse(blocksJson || '[]') as LocalTimeBlock[],
    aiInterpretation: aiInterpretationJson ? JSON.parse(aiInterpretationJson) as NonNullable<LocalIntention['aiInterpretation']> : null,
  }));
  });
}

async function writeLocal(db: Awaited<ReturnType<typeof SQLite.openDatabaseAsync>>, item: LocalIntention) {
  await db.runAsync(`INSERT INTO intentions (id, remote_id, raw_capture, title, kind, status, intent, purpose, desired_outcome, rough_plan, horizon, effort_estimate, energy_context, version, blocks_json, ai_interpretation_json, created_at, updated_at, sync_state)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET remote_id=COALESCE(excluded.remote_id, intentions.remote_id), title=excluded.title, raw_capture=excluded.raw_capture, kind=excluded.kind,
    status=excluded.status, intent=excluded.intent, purpose=excluded.purpose, desired_outcome=excluded.desired_outcome,
    rough_plan=excluded.rough_plan, horizon=excluded.horizon, effort_estimate=excluded.effort_estimate, energy_context=excluded.energy_context, version=COALESCE(excluded.version, intentions.version),
    blocks_json=excluded.blocks_json, ai_interpretation_json=excluded.ai_interpretation_json, updated_at=excluded.updated_at, sync_state=excluded.sync_state`,
  item.id, item.remoteId, item.rawCapture, item.title, item.kind, item.status, item.intent, item.purpose, item.desiredOutcome,
  item.roughPlan, item.horizon, item.effortEstimate, item.energyContext, item.version, JSON.stringify(item.blocks), item.aiInterpretation ? JSON.stringify(item.aiInterpretation) : null, item.createdAt, item.updatedAt, item.syncState);
}

export function saveLocal(userId: string, item: LocalIntention) {
  return enqueueWrite(userId, async () => {
  await writeLocal(await initializeStore(userId), item);
  });
}

export function queueLocalTimeBlockDeletion(userId: string, item: LocalIntention, block: LocalTimeBlock): Promise<void> {
  return enqueueWrite(userId, async () => {
  const db = await initializeStore(userId);
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'INSERT OR REPLACE INTO time_block_deletions (client_id, intention_client_id, starts_at, ends_at, timezone) VALUES (?, ?, ?, ?, ?)',
      block.id, item.id, block.startsAt, block.endsAt, block.timezone,
    );
    await writeLocal(db, item);
  });
  });
}

export function listLocalTimeBlockDeletions(userId: string): Promise<LocalTimeBlockDeletion[]> {
  return withRead(userId, async () => {
  const db = await initializeStore(userId);
  return db.getAllAsync<LocalTimeBlockDeletion>(
    'SELECT client_id AS clientId, intention_client_id AS intentionClientId, starts_at AS startsAt, ends_at AS endsAt, timezone FROM time_block_deletions ORDER BY rowid',
  );
  });
}

export async function deleteLocalTimeBlockDeletions(userId: string, clientIds: string[]): Promise<void> {
  if (!clientIds.length) return;
  await enqueueWrite(userId, async () => {
  const db = await initializeStore(userId);
  await db.withTransactionAsync(async () => {
    for (const clientId of clientIds) await db.runAsync('DELETE FROM time_block_deletions WHERE client_id = ?', clientId);
  });
  });
}

export function deleteLocal(userId: string, clientId: string) {
  return enqueueWrite(userId, async () => {
  const db = await initializeStore(userId);
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM intentions WHERE id = ?', clientId);
    await db.runAsync('DELETE FROM time_block_deletions WHERE intention_client_id = ?', clientId);
  });
  });
}

export async function clearLocal(userId: string): Promise<void> {
  if (deletingUsers.has(userId)) return;
  deletingUsers.add(userId);
  await writeTails.get(userId)?.catch(() => undefined);
  await initialized.get(userId)?.catch(() => undefined);
  await waitForReads(userId);
  writeTails.delete(userId);
  activeReads.delete(userId);
  readWaiters.delete(userId);
  const pendingDatabase = databases.get(userId);
  let cleanupError: unknown;
  if (pendingDatabase) {
    let db: Awaited<ReturnType<typeof SQLite.openDatabaseAsync>> | null = null;
    try {
      db = await pendingDatabase;
      await db.execAsync('PRAGMA secure_delete = ON; DELETE FROM intentions; DELETE FROM sync_meta; DELETE FROM relationships; DELETE FROM relationship_outbox; DELETE FROM suggestion_feedback; DELETE FROM local_preferences; DELETE FROM preferences_outbox; DELETE FROM time_block_deletions; PRAGMA wal_checkpoint(TRUNCATE);');
    } catch (error) { cleanupError = error; }
    if (db) try { await db.closeAsync(); } catch (error) { cleanupError ??= error; }
  }
  databases.delete(userId);
  initialized.delete(userId);
  try {
    await SQLite.deleteDatabaseAsync(databaseName(userId));
    await SQLite.deleteDatabaseAsync(legacyDatabaseName(userId));
    await SecureStore.deleteItemAsync(databaseKeyName(userId));
    await SecureStore.deleteItemAsync(databaseMigrationName(userId));
  }
  catch (error) {
    throw new Error('Could not remove the local account database.', { cause: cleanupError ?? error });
  }
}
