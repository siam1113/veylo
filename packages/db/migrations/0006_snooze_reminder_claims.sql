ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS reminder_claimed_at timestamptz;
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS reminder_claim_key varchar(255);
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS reminder_handled_at timestamptz;
