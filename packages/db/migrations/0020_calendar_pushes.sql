-- A time block's external* columns only ever recorded one pushed-to calendar.
-- Pushing a single thought to more than one connected calendar at once needs
-- a row per (time block, connected account) instead of a single slot - the
-- first push still also writes the legacy time_blocks.external* columns (kept
-- as the "primary" pointer every existing UI binding already reads), and
-- every push beyond the first lives only here.
CREATE UNIQUE INDEX IF NOT EXISTS time_blocks_owner_id_id_idx ON time_blocks (owner_id, id);

CREATE TABLE IF NOT EXISTS calendar_pushes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  time_block_id uuid NOT NULL,
  integration_id uuid NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  provider varchar(32) NOT NULL,
  external_event_id varchar(255),
  external_url text,
  external_title varchar(160),
  sync_state varchar(20) NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT calendar_pushes_time_block_owner_fkey FOREIGN KEY (owner_id, time_block_id)
    REFERENCES time_blocks (owner_id, id) ON DELETE CASCADE,
  CONSTRAINT calendar_pushes_sync_state_check CHECK (sync_state IN ('pending', 'synced', 'error'))
);

-- One push per (time block, connected account) - re-adding the same calendar
-- account is a retry/no-op, not a second row.
CREATE UNIQUE INDEX IF NOT EXISTS calendar_pushes_block_integration_idx
  ON calendar_pushes (time_block_id, integration_id) WHERE deleted_at IS NULL;

-- Mirrors time_blocks_owner_provider_event_idx (migration 0017): dedups
-- against the provider's own event id per account, so autonomous sync reading
-- a pushed event back can't create a duplicate push row.
CREATE UNIQUE INDEX IF NOT EXISTS calendar_pushes_owner_provider_event_idx
  ON calendar_pushes (owner_id, provider, external_event_id)
  WHERE deleted_at IS NULL AND external_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS calendar_pushes_time_block_idx ON calendar_pushes (time_block_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS calendar_pushes_integration_idx ON calendar_pushes (integration_id) WHERE deleted_at IS NULL;
