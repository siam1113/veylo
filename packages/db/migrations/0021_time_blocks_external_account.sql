-- Multi-account support means external_provider alone (e.g. "google_calendar") no longer
-- identifies which of a user's possibly-several connected accounts of that provider a
-- synced/pushed event belongs to. Stores the connected account's label (e.g. an email)
-- alongside the title Google/Outlook last reported, so the thoughts/time UI can show a
-- provider icon + account badge together.
ALTER TABLE time_blocks ADD COLUMN IF NOT EXISTS external_account_label varchar(160);
