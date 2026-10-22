-- Google Calendar's autonomous sync (and the existing ClearHead->Google push) both
-- identify a time block by (owner, provider, external event id). Without a
-- unique constraint, a retried sync tick or an overlap with the push flow's
-- own write-back could create two time blocks for one Google event. The
-- predicate excludes soft-deleted rows and rows never tied to a provider, so
-- archiving a cancelled event, or a purely local block, can never collide
-- with a future identically-keyed row.
CREATE UNIQUE INDEX IF NOT EXISTS time_blocks_owner_provider_event_idx
  ON time_blocks (owner_id, external_provider, external_event_id)
  WHERE deleted_at IS NULL AND external_provider IS NOT NULL AND external_event_id IS NOT NULL;

-- The sync tick fans out per connected Google account every few minutes;
-- this keeps that lookup index-only as the integrations table grows.
CREATE INDEX IF NOT EXISTS integrations_provider_active_idx
  ON integrations (provider) WHERE revoked_at IS NULL;
