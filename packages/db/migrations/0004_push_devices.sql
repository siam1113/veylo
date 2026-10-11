CREATE TABLE IF NOT EXISTS push_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expo_push_token varchar(255) NOT NULL,
  platform varchar(16) NOT NULL CHECK (platform IN ('ios', 'android')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS push_devices_token_idx ON push_devices (expo_push_token);
CREATE INDEX IF NOT EXISTS push_devices_owner_idx ON push_devices (owner_id);
