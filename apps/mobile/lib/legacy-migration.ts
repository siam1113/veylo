export type LegacyRow = Record<string, string | number | null | undefined>;

export const legacyTableColumns: Record<string, string[]> = {
  intentions: [
    'id', 'remote_id', 'raw_capture', 'title', 'kind', 'status', 'intent', 'purpose', 'desired_outcome', 'rough_plan',
    'horizon', 'effort_estimate', 'energy_context', 'version', 'blocks_json', 'ai_interpretation_json', 'created_at', 'updated_at', 'sync_state',
  ],
  sync_meta: ['key', 'value'],
  relationships: ['id', 'payload'],
  relationship_outbox: ['op_id', 'payload'],
  suggestion_feedback: ['client_id', 'state', 'snoozed_until', 'sync_state'],
  local_preferences: ['id', 'payload'],
  preferences_outbox: ['id', 'payload'],
  time_block_deletions: ['client_id', 'intention_client_id', 'starts_at', 'ends_at', 'timezone'],
};

export const legacyTableKeys: Record<string, string> = {
  intentions: 'id', sync_meta: 'key', relationships: 'id', relationship_outbox: 'op_id',
  suggestion_feedback: 'client_id', local_preferences: 'id', preferences_outbox: 'id',
  time_block_deletions: 'client_id',
};

export type LegacyRowProjection = { key: string; keyValue: string | number; columns: string[] };

/** Validate and allowlist the row shape before building a quoted migration query. */
export function legacyRowProjection(table: string, row: LegacyRow): LegacyRowProjection {
  if (!Object.prototype.hasOwnProperty.call(legacyTableColumns, table)
      || !Object.prototype.hasOwnProperty.call(legacyTableKeys, table)) {
    throw new Error(`The local data migration does not recognize table ${table}.`);
  }
  const allowedColumns = legacyTableColumns[table];
  const key = legacyTableKeys[table];
  if (!allowedColumns || !key) throw new Error(`The local data migration does not recognize table ${table}.`);
  const columns = allowedColumns.filter((column) => Object.prototype.hasOwnProperty.call(row, column));
  if (!columns.length || !columns.includes(key)) {
    throw new Error(`The local data migration found no recognized fields or row key in ${table}; the original data was retained.`);
  }
  const keyValue = row[key];
  if (keyValue === undefined || keyValue === null) {
    throw new Error(`The local data migration found a row without its ${key} key; the original data was retained.`);
  }
  return { key, keyValue, columns };
}

export function legacyRowMatches(columns: string[], expected: LegacyRow, copied: LegacyRow | null): boolean {
  return copied !== null && columns.every((column) => Object.is(copied[column] ?? null, expected[column] ?? null));
}
