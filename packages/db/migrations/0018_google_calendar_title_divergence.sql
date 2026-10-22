-- Tracks the title Google last reported for a synced event, so the autonomous
-- sync can tell "the user hasn't touched this title since we applied Google's
-- copy" (safe to refresh again) from "the user renamed this inside ClearHead"
-- (ClearHead's edit must win and stop being overwritten by Google's stale copy).
ALTER TABLE time_blocks ADD COLUMN IF NOT EXISTS external_title varchar(160);
