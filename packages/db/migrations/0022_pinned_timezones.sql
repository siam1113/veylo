-- Lets a user pin a short list of other timezones to see alongside their own
-- in the day timeline, instead of only ever viewing one timezone at a time.
ALTER TABLE push_preferences ADD COLUMN IF NOT EXISTS pinned_timezones text[] NOT NULL DEFAULT ARRAY[]::text[];
