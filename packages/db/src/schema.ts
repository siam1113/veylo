import {
  boolean, check, foreignKey, index, integer, jsonb, pgSchema, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid, varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { CustomField, OriginalVersion } from '@clearhead/domain';

// Supabase owns this table; the declaration lets Drizzle reflect the foreign
// keys without treating auth.users as an application-managed table.
const authUsers = pgSchema('auth').table('users', { id: uuid('id').primaryKey() });

export const intentions = pgTable('intentions', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id').notNull(),
  rawCapture: text('raw_capture').notNull(),
  originalVersions: jsonb('original_versions').$type<OriginalVersion[]>().notNull().default([]),
  title: varchar('title', { length: 160 }).notNull(),
  kind: varchar('kind', { length: 32 }).notNull().default('unclassified'),
  intent: text('intent'),
  purpose: text('purpose'),
  desiredOutcome: text('desired_outcome'),
  roughPlan: text('rough_plan'),
  horizon: varchar('horizon', { length: 16 }),
  effortEstimate: integer('effort_estimate'),
  energyContext: varchar('energy_context', { length: 120 }),
  customFields: jsonb('custom_fields').$type<CustomField[]>().notNull().default([]),
  status: varchar('status', { length: 24 }).notNull().default('captured'),
  aiMetadata: jsonb('ai_metadata').$type<Record<string, unknown>>().notNull().default({}),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  trashedAt: timestamp('trashed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerRecent: index('intentions_owner_recent_idx').on(table.ownerId, table.updatedAt.desc()),
  ownerClient: uniqueIndex('intentions_owner_client_idx').on(table.ownerId, table.clientId),
  ownerIdentity: unique('intentions_owner_id_id_key').on(table.ownerId, table.id),
  rawCaptureLength: check('intentions_raw_capture_check', sql`char_length(${table.rawCapture}) BETWEEN 1 AND 8000`),
  rawCaptureNonblank: check('intentions_raw_capture_nonblank_check', sql`${table.rawCapture} !~ '^[[:space:]]*$'`),
  kindValue: check('intentions_kind_check', sql`${table.kind} IN ('idea','action','commitment','question','goal','meeting','note','unclassified')`),
  horizonValue: check('intentions_horizon_check', sql`${table.horizon} IS NULL OR ${table.horizon} IN ('today','week','month','someday','custom')`),
  effortRange: check('intentions_effort_estimate_check', sql`${table.effortEstimate} IS NULL OR ${table.effortEstimate} BETWEEN 0 AND 10080`),
  statusValue: check('intentions_status_check', sql`${table.status} IN ('captured','exploring','ready','planned','active','completed','archived','trashed')`),
  positiveVersion: check('intentions_version_check', sql`${table.version} > 0`),
}));

export const intentionRevisions = pgTable('intention_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
  intentionId: uuid('intention_id').notNull(),
  version: integer('version').notNull(),
  action: varchar('action', { length: 24 }).notNull(),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  changedFields: text('changed_fields').array().notNull().default(sql`ARRAY[]::text[]`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  intentionRecent: index('intention_revisions_recent_idx').on(table.ownerId, table.intentionId, table.createdAt.desc()),
  intentionVersion: unique('intention_revisions_owner_intention_version_action_key').on(table.ownerId, table.intentionId, table.version, table.action),
  positiveVersion: check('intention_revisions_version_check', sql`${table.version} > 0`),
  actionValue: check('intention_revisions_action_check', sql`${table.action} IN ('created','updated','status_changed','deleted','ai_suggestion','ai_undo','ai_requested','piece_added','version_started')`),
  intentionOwner: foreignKey({
    name: 'intention_revisions_intention_owner_fkey',
    columns: [table.ownerId, table.intentionId],
    foreignColumns: [intentions.ownerId, intentions.id],
  }).onDelete('cascade'),
}));

export const brainstormMessages = pgTable('brainstorm_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
  intentionId: uuid('intention_id').notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  parentMessageId: uuid('parent_message_id'),
  role: varchar('role', { length: 12 }).notNull(),
  status: varchar('status', { length: 12 }).notNull(),
  content: text('content').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerIntentionRecent: index('brainstorm_messages_owner_intention_created_idx').on(table.ownerId, table.intentionId, table.createdAt.desc()),
  requestRole: uniqueIndex('brainstorm_messages_request_role_key').on(table.ownerId, table.clientRequestId, table.role),
  ownerIntentionId: uniqueIndex('brainstorm_messages_owner_intention_id_key').on(table.ownerId, table.intentionId, table.id),
  roleValue: check('brainstorm_messages_role_check', sql`${table.role} IN ('user','assistant')`),
  statusValue: check('brainstorm_messages_status_check', sql`${table.status} IN ('pending','complete','failed')`),
  contentLength: check('brainstorm_messages_content_check', sql`char_length(${table.content}) <= 4000`),
  userContent: check('brainstorm_messages_user_content_check', sql`${table.role} <> 'user' OR char_length(${table.content}) BETWEEN 1 AND 2000`),
  roleState: check('brainstorm_messages_role_state_check', sql`(${table.role} = 'user' AND ${table.parentMessageId} IS NULL AND ${table.status} = 'complete') OR (${table.role} = 'assistant' AND ${table.parentMessageId} IS NOT NULL)`),
  intentionOwner: foreignKey({
    name: 'brainstorm_messages_intention_owner_fkey',
    columns: [table.ownerId, table.intentionId],
    foreignColumns: [intentions.ownerId, intentions.id],
  }).onDelete('cascade'),
  parentOwner: foreignKey({
    name: 'brainstorm_messages_parent_owner_fkey',
    columns: [table.ownerId, table.intentionId, table.parentMessageId],
    foreignColumns: [table.ownerId, table.intentionId, table.id],
  }).onDelete('cascade'),
}));

export const intentionRelationships = pgTable('intention_relationships', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
  fromId: uuid('from_intention_id').notNull(),
  toId: uuid('to_intention_id').notNull(),
  relation: varchar('relation', { length: 24 }).notNull().default('related'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uniqueRelation: uniqueIndex('intention_relationship_unique_idx').on(table.ownerId, table.fromId, table.toId, table.relation),
  ownerFrom: index('intention_relationships_owner_from_idx').on(table.ownerId, table.fromId),
  relationValue: check('intention_relationships_relation_check', sql`${table.relation} IN ('supports','related','depends_on')`),
  distinctIntentions: check('intention_relationships_check', sql`${table.fromId} <> ${table.toId}`),
  fromOwner: foreignKey({
    name: 'intention_relationships_from_owner_fkey',
    columns: [table.ownerId, table.fromId],
    foreignColumns: [intentions.ownerId, intentions.id],
  }).onDelete('cascade'),
  toOwner: foreignKey({
    name: 'intention_relationships_to_owner_fkey',
    columns: [table.ownerId, table.toId],
    foreignColumns: [intentions.ownerId, intentions.id],
  }).onDelete('cascade'),
}));

export const timeBlocks = pgTable('time_blocks', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
  intentionId: uuid('intention_id').notNull(),
  clientId: uuid('client_id').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  timezone: varchar('timezone', { length: 80 }).notNull(),
  externalProvider: varchar('external_provider', { length: 32 }),
  externalEventId: varchar('external_event_id', { length: 255 }),
  externalUrl: text('external_url'),
  externalTitle: varchar('external_title', { length: 160 }),
  // The connected account's label (e.g. an email) for the provider named in externalProvider -
  // disambiguates which of a user's possibly-several accounts of that provider this is.
  externalAccountLabel: varchar('external_account_label', { length: 160 }),
  syncState: varchar('sync_state', { length: 20 }).notNull().default('local'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerStart: index('time_blocks_owner_start_idx').on(table.ownerId, table.startsAt),
  ownerClient: uniqueIndex('time_blocks_owner_client_idx').on(table.ownerId, table.clientId),
  ownerProviderEvent: uniqueIndex('time_blocks_owner_provider_event_idx').on(table.ownerId, table.externalProvider, table.externalEventId)
    .where(sql`${table.deletedAt} IS NULL AND ${table.externalProvider} IS NOT NULL AND ${table.externalEventId} IS NOT NULL`),
  // FK target for calendar_pushes - lets a push row's (ownerId, timeBlockId) be verified in one constraint.
  ownerBlockId: uniqueIndex('time_blocks_owner_id_id_idx').on(table.ownerId, table.id),
  validRange: check('time_blocks_ends_at_check', sql`${table.endsAt} > ${table.startsAt}`),
  syncStateValue: check('time_blocks_sync_state_check', sql`${table.syncState} IN ('local','pending','synced','error')`),
  intentionOwner: foreignKey({
    name: 'time_blocks_intention_owner_fkey',
    columns: [table.ownerId, table.intentionId],
    foreignColumns: [intentions.ownerId, intentions.id],
  }).onDelete('cascade'),
}));

export const integrations = pgTable('integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 32 }).notNull(),
  providerAccountId: varchar('provider_account_id', { length: 255 }),
  encryptedAccessToken: text('encrypted_access_token'),
  encryptedRefreshToken: text('encrypted_refresh_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  scopes: text('scopes').array().notNull().default([]),
  connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
}, (table) => ({
  // Multi-account: a user can connect more than one account of the same provider,
  // so the identity key is (owner, provider, provider account), not (owner, provider)
  // alone. providerAccountId must never be left NULL by application code for new
  // rows, or this index stops deduping (Postgres doesn't treat NULL = NULL here).
  ownerProviderAccount: uniqueIndex('integrations_owner_provider_account_idx').on(table.ownerId, table.provider, table.providerAccountId),
  ownerIndex: index('integrations_owner_idx').on(table.ownerId),
  providerActive: index('integrations_provider_active_idx').on(table.provider).where(sql`${table.revokedAt} IS NULL`),
}));

export const calendarPushes = pgTable('calendar_pushes', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
  timeBlockId: uuid('time_block_id').notNull(),
  integrationId: uuid('integration_id').notNull().references(() => integrations.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 32 }).notNull(),
  externalEventId: varchar('external_event_id', { length: 255 }),
  externalUrl: text('external_url'),
  externalTitle: varchar('external_title', { length: 160 }),
  syncState: varchar('sync_state', { length: 20 }).notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  // One push per (time block, connected account) - re-adding the same calendar account is a retry, not a second row.
  blockIntegration: uniqueIndex('calendar_pushes_block_integration_idx').on(table.timeBlockId, table.integrationId)
    .where(sql`${table.deletedAt} IS NULL`),
  // Mirrors time_blocks_owner_provider_event_idx (migration 0017): dedups against the provider's
  // own event id per account, so autonomous sync reading a pushed event back can't double-create.
  ownerProviderEvent: uniqueIndex('calendar_pushes_owner_provider_event_idx').on(table.ownerId, table.provider, table.externalEventId)
    .where(sql`${table.deletedAt} IS NULL AND ${table.externalEventId} IS NOT NULL`),
  timeBlockIndex: index('calendar_pushes_time_block_idx').on(table.timeBlockId).where(sql`${table.deletedAt} IS NULL`),
  integrationIndex: index('calendar_pushes_integration_idx').on(table.integrationId).where(sql`${table.deletedAt} IS NULL`),
  syncStateValue: check('calendar_pushes_sync_state_check', sql`${table.syncState} IN ('pending','synced','error')`),
  timeBlockOwner: foreignKey({
    name: 'calendar_pushes_time_block_owner_fkey',
    columns: [table.ownerId, table.timeBlockId],
    foreignColumns: [timeBlocks.ownerId, timeBlocks.id],
  }).onDelete('cascade'),
}));

export const oauthStates = pgTable('oauth_states', {
  stateHash: varchar('state_hash', { length: 64 }).primaryKey(),
  ownerId: uuid('owner_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 32 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  expiresAtIndex: index('oauth_states_expires_at_idx').on(table.expiresAt),
  providerValue: check('oauth_states_provider_check', sql`${table.provider} IN ('google_calendar','jira_cloud','notion','outlook','clickup','asana','trello','todoist','microsoft_todo','linear','github','slack')`),
}));

export const idempotencyKeys = pgTable('idempotency_keys', {
  ownerId: uuid('owner_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
  key: varchar('key', { length: 128 }).notNull(),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  response: jsonb('response').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerKey: primaryKey({ name: 'idempotency_keys_pkey', columns: [table.ownerId, table.key] }),
  createdIndex: index('idempotency_keys_created_idx').on(table.createdAt),
}));

export const suggestions = pgTable('suggestions', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
  intentionId: uuid('intention_id').references(() => intentions.id, { onDelete: 'set null' }),
  type: varchar('type', { length: 32 }).notNull(),
  rationale: text('rationale').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  state: varchar('state', { length: 20 }).notNull().default('open'),
  snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
  reminderClaimedAt: timestamp('reminder_claimed_at', { withTimezone: true }),
  reminderClaimKey: varchar('reminder_claim_key', { length: 255 }),
  reminderHandledAt: timestamp('reminder_handled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerState: index('suggestions_owner_state_idx').on(table.ownerId, table.state),
  ownerIntentionType: uniqueIndex('suggestions_owner_intention_type_idx').on(table.ownerId, table.intentionId, table.type),
  stateValue: check('suggestions_state_check', sql`${table.state} IN ('open','accepted','dismissed','snoozed','expired')`),
}));

export const pushPreferences = pgTable('push_preferences', {
  ownerId: uuid('owner_id').primaryKey().references(() => authUsers.id, { onDelete: 'cascade' }),
  aiInterpretationEnabled: boolean('ai_interpretation_enabled').notNull().default(false),
  reduceMotion: boolean('reduce_motion').notNull().default(false),
  suggestionsEnabled: boolean('suggestions_enabled').notNull().default(true),
  suggestionLimit: integer('suggestion_limit').notNull().default(2),
  enabled: boolean('enabled').notNull().default(false),
  quietStart: varchar('quiet_start', { length: 5 }),
  quietEnd: varchar('quiet_end', { length: 5 }),
  timezone: varchar('timezone', { length: 80 }),
  pinnedTimezones: text('pinned_timezones').array().notNull().default(sql`ARRAY[]::text[]`),
  dailyLimit: integer('daily_limit').notNull().default(2),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  dailyLimitRange: check('push_preferences_daily_limit_check', sql`${table.dailyLimit} BETWEEN 0 AND 20`),
  suggestionLimitRange: check('push_preferences_suggestion_limit_check', sql`${table.suggestionLimit} BETWEEN 0 AND 20`),
}));

export const pushDevices = pgTable('push_devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
  expoPushToken: varchar('expo_push_token', { length: 255 }).notNull(),
  platform: varchar('platform', { length: 16 }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  token: uniqueIndex('push_devices_token_idx').on(table.expoPushToken),
  owner: index('push_devices_owner_idx').on(table.ownerId),
  platformValue: check('push_devices_platform_check', sql`${table.platform} IN ('ios','android')`),
}));

export const webPushSubscriptions = pgTable('web_push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
  endpointHash: varchar('endpoint_hash', { length: 64 }).notNull(),
  encryptedSubscription: text('encrypted_subscription').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  endpoint: uniqueIndex('web_push_subscriptions_endpoint_idx').on(table.endpointHash),
  owner: index('web_push_subscriptions_owner_idx').on(table.ownerId),
}));

// Independent Align entries can exist before any thoughts are linked.
export const alignmentAnchors = pgTable('alignment_anchors', {
  id: uuid('id').primaryKey(),
  ownerId: uuid('owner_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
  kind: varchar('kind', { length: 24 }).notNull(),
  title: varchar('title', { length: 160 }).notNull(),
  note: text('note').notNull().default(''),
  intentionIds: uuid('intention_client_ids').array().notNull().default(sql`ARRAY[]::uuid[]`),
  archived: boolean('archived').notNull().default(false),
  version: integer('version').notNull().default(1),
  mutationId: uuid('mutation_id').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerRecent: index('alignment_anchors_owner_recent_idx').on(table.ownerId, table.updatedAt),
  kindValue: check('alignment_anchors_kind_check', sql`${table.kind} IN ('reason','goal','direction','value')`),
  titleValue: check('alignment_anchors_title_check', sql`char_length(btrim(${table.title})) BETWEEN 1 AND 160`),
  noteLength: check('alignment_anchors_note_check', sql`char_length(${table.note}) <= 4000`),
  positiveVersion: check('alignment_anchors_version_check', sql`${table.version} > 0`),
}));
