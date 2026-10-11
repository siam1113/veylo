-- OAuth authorization state is persisted by hash and atomically consumed in
-- the callback so its state and authorization code cannot be exchanged twice.
CREATE TABLE oauth_states (
  state_hash varchar(64) PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider varchar(32) NOT NULL CHECK (provider IN ('google_calendar', 'jira_cloud', 'notion')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oauth_states_expires_at_idx ON oauth_states (expires_at);
ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;
