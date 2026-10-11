ALTER TABLE push_preferences
  ADD COLUMN IF NOT EXISTS reduce_motion boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suggestions_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS suggestion_limit integer NOT NULL DEFAULT 2;

ALTER TABLE push_preferences
  ADD CONSTRAINT push_preferences_suggestion_limit_check CHECK (suggestion_limit BETWEEN 0 AND 20);
