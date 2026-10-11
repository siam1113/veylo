CREATE TABLE alignment_anchors (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind varchar(24) NOT NULL CHECK (kind IN ('reason','goal','direction','value')),
  title varchar(160) NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 4000),
  intention_client_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  archived boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  mutation_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alignment_anchors_owner_recent_idx ON alignment_anchors(owner_id, updated_at);
-- Only the authenticated, owner-scoped API writes product data.
ALTER TABLE alignment_anchors ENABLE ROW LEVEL SECURITY;

-- Preserve existing purposes as standalone Reasons, gathering their thoughts.
INSERT INTO alignment_anchors (id, owner_id, kind, title, note, intention_client_ids, mutation_id)
SELECT gen_random_uuid(), owner_id, 'reason', left(btrim(purpose), 160),
  CASE WHEN char_length(btrim(purpose)) > 160 THEN btrim(purpose) ELSE '' END,
  array_agg(client_id ORDER BY created_at), gen_random_uuid()
FROM intentions
WHERE deleted_at IS NULL AND status <> 'archived' AND btrim(coalesce(purpose, '')) <> ''
GROUP BY owner_id, btrim(purpose);
