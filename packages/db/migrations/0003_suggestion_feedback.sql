-- Keep the most recently updated suggestion row for each linked intention/type
-- before adding the key used by idempotent feedback updates.
WITH ranked AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY owner_id, intention_id, type
      ORDER BY updated_at DESC, created_at DESC, id DESC
    ) AS row_num
  FROM suggestions
  WHERE intention_id IS NOT NULL
)
DELETE FROM suggestions
WHERE id IN (SELECT id FROM ranked WHERE row_num > 1);

CREATE UNIQUE INDEX IF NOT EXISTS suggestions_owner_intention_type_idx
  ON suggestions(owner_id, intention_id, type);
