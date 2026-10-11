-- Relationship and schedule records must belong to the same account as the
-- intentions they reference, even if a future API query omits an owner check.
ALTER TABLE intentions
  ADD CONSTRAINT intentions_owner_id_id_key UNIQUE (owner_id, id);

ALTER TABLE intention_relationships
  DROP CONSTRAINT IF EXISTS intention_relationships_from_intention_id_fkey,
  DROP CONSTRAINT IF EXISTS intention_relationships_to_intention_id_fkey;

ALTER TABLE intention_relationships
  ADD CONSTRAINT intention_relationships_from_owner_fkey
    FOREIGN KEY (owner_id, from_intention_id) REFERENCES intentions (owner_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT intention_relationships_to_owner_fkey
    FOREIGN KEY (owner_id, to_intention_id) REFERENCES intentions (owner_id, id) ON DELETE CASCADE;

ALTER TABLE time_blocks
  DROP CONSTRAINT IF EXISTS time_blocks_intention_id_fkey;

ALTER TABLE time_blocks
  ADD CONSTRAINT time_blocks_intention_owner_fkey
    FOREIGN KEY (owner_id, intention_id) REFERENCES intentions (owner_id, id) ON DELETE CASCADE;
