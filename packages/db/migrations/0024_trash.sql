-- Delete (distinct from Archive): a thought can be moved to 'trashed' and later
-- restored or purged. trashed_at drives the trash-retention countdown and the
-- worker's auto-purge job.
ALTER TABLE intentions DROP CONSTRAINT IF EXISTS intentions_status_check;
ALTER TABLE intentions ADD CONSTRAINT intentions_status_check CHECK (status IN ('captured','exploring','ready','planned','active','completed','archived','trashed'));
ALTER TABLE intentions ADD COLUMN IF NOT EXISTS trashed_at timestamptz;
