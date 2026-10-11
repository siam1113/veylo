CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint_hash varchar(64) NOT NULL,
  encrypted_subscription text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS web_push_subscriptions_endpoint_idx ON web_push_subscriptions (endpoint_hash);
CREATE INDEX IF NOT EXISTS web_push_subscriptions_owner_idx ON web_push_subscriptions (owner_id);
