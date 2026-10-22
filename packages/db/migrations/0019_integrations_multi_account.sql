-- Multi-account support: a user can now connect more than one account of the
-- same provider (e.g. two Google accounts). The old (owner, provider) unique
-- index only ever allowed one connection per provider per owner, so it has to
-- be replaced by (owner, provider, provider_account_id).
--
-- Every existing row predates account-identity fetching, so provider_account_id
-- is NULL for Google/Outlook/etc. rows today. Backfill a synthetic id derived
-- from the row's own primary key before swapping the index, so no two existing
-- rows can collide under the new constraint (Postgres unique indexes don't
-- treat NULL as equal to NULL, so leaving them NULL would silently stop
-- deduping going forward too - application code must never write NULL for
-- provider_account_id from here on).
UPDATE integrations SET provider_account_id = 'legacy-' || id::text WHERE provider_account_id IS NULL;

DROP INDEX IF EXISTS integrations_owner_provider_idx;

CREATE UNIQUE INDEX IF NOT EXISTS integrations_owner_provider_account_idx
  ON integrations (owner_id, provider, provider_account_id);
