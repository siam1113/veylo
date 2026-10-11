-- Private, intention-scoped AI conversation history. Client request IDs make
-- retries after ambiguous responses idempotent, and new messages require a connection.
CREATE TABLE brainstorm_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  intention_id uuid NOT NULL,
  client_request_id uuid NOT NULL,
  parent_message_id uuid,
  role varchar(12) NOT NULL CHECK (role IN ('user', 'assistant')),
  status varchar(12) NOT NULL CHECK (status IN ('pending', 'complete', 'failed')),
  content text NOT NULL DEFAULT '' CHECK (char_length(content) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brainstorm_messages_owner_intention_id_key UNIQUE (owner_id, intention_id, id),
  CONSTRAINT brainstorm_messages_request_role_key UNIQUE (owner_id, client_request_id, role),
  CONSTRAINT brainstorm_messages_user_content_check CHECK (role <> 'user' OR char_length(content) BETWEEN 1 AND 2000),
  CONSTRAINT brainstorm_messages_role_state_check CHECK (
    (role = 'user' AND parent_message_id IS NULL AND status = 'complete') OR
    (role = 'assistant' AND parent_message_id IS NOT NULL)
  ),
  CONSTRAINT brainstorm_messages_intention_owner_fkey
    FOREIGN KEY (owner_id, intention_id) REFERENCES intentions (owner_id, id) ON DELETE CASCADE,
  CONSTRAINT brainstorm_messages_parent_owner_fkey
    FOREIGN KEY (owner_id, intention_id, parent_message_id)
    REFERENCES brainstorm_messages (owner_id, intention_id, id) ON DELETE CASCADE
);
CREATE INDEX brainstorm_messages_owner_intention_created_idx
  ON brainstorm_messages (owner_id, intention_id, created_at DESC);
ALTER TABLE brainstorm_messages ENABLE ROW LEVEL SECURITY;
