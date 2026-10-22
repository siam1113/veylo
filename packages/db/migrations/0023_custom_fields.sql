-- Lets a user add their own labeled fields to a thought, instead of being limited
-- to the fixed set of AI-evaluation field keys.
ALTER TABLE intentions ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '[]'::jsonb;
