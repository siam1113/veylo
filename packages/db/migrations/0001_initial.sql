-- ClearHead initial schema. Apply after creating a Supabase project.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS intentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  raw_capture text NOT NULL CHECK (char_length(raw_capture) BETWEEN 1 AND 1200),
  title varchar(160) NOT NULL,
  kind varchar(32) NOT NULL DEFAULT 'unclassified' CHECK (kind IN ('idea','action','commitment','question','goal','meeting','note','unclassified')),
  intent text, purpose text, desired_outcome text, rough_plan text,
  horizon varchar(16) CHECK (horizon IS NULL OR horizon IN ('today','week','month','someday','custom')),
  effort_estimate integer CHECK (effort_estimate IS NULL OR effort_estimate BETWEEN 0 AND 10080),
  energy_context varchar(120),
  status varchar(24) NOT NULL DEFAULT 'captured' CHECK (status IN ('captured','exploring','ready','planned','active','completed','archived')),
  ai_metadata jsonb NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, client_id)
);
CREATE INDEX IF NOT EXISTS intentions_owner_recent_idx ON intentions(owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS intention_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_intention_id uuid NOT NULL REFERENCES intentions(id) ON DELETE CASCADE,
  to_intention_id uuid NOT NULL REFERENCES intentions(id) ON DELETE CASCADE,
  relation varchar(24) NOT NULL DEFAULT 'related' CHECK (relation IN ('supports','related','depends_on')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, from_intention_id, to_intention_id, relation),
  CHECK (from_intention_id <> to_intention_id)
);
CREATE INDEX IF NOT EXISTS intention_relationships_owner_from_idx ON intention_relationships(owner_id, from_intention_id);

CREATE TABLE IF NOT EXISTS time_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  intention_id uuid NOT NULL REFERENCES intentions(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  timezone varchar(80) NOT NULL,
  external_provider varchar(32),
  external_event_id varchar(255),
  external_url text,
  sync_state varchar(20) NOT NULL DEFAULT 'local' CHECK (sync_state IN ('local','pending','synced','error')),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, client_id)
);
CREATE INDEX IF NOT EXISTS time_blocks_owner_start_idx ON time_blocks(owner_id, starts_at);

CREATE TABLE IF NOT EXISTS integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider varchar(32) NOT NULL,
  provider_account_id varchar(255),
  encrypted_access_token text,
  encrypted_refresh_token text,
  access_token_expires_at timestamptz,
  scopes text[] NOT NULL DEFAULT '{}',
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}',
  UNIQUE (owner_id, provider)
);
CREATE INDEX IF NOT EXISTS integrations_owner_idx ON integrations(owner_id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key varchar(128) NOT NULL,
  request_hash varchar(64) NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, key)
);
CREATE INDEX IF NOT EXISTS idempotency_keys_created_idx ON idempotency_keys(created_at);

CREATE TABLE IF NOT EXISTS suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  intention_id uuid REFERENCES intentions(id) ON DELETE SET NULL,
  type varchar(32) NOT NULL,
  rationale text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  state varchar(20) NOT NULL DEFAULT 'open' CHECK (state IN ('open','accepted','dismissed','snoozed','expired')),
  snoozed_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS suggestions_owner_state_idx ON suggestions(owner_id, state);

CREATE TABLE IF NOT EXISTS push_preferences (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ai_interpretation_enabled boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT false,
  quiet_start varchar(5), quiet_end varchar(5), timezone varchar(80),
  daily_limit integer NOT NULL DEFAULT 2 CHECK (daily_limit BETWEEN 0 AND 20),
  updated_at timestamptz NOT NULL DEFAULT now()
);
