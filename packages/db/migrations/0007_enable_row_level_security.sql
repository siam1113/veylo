-- Product records are accessed through the owner-scoped Fastify API. The
-- browser and native clients use Supabase only for authentication, so there
-- are intentionally no anon/authenticated policies granting direct table access.
ALTER TABLE intentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE intention_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE veylo_schema_migrations ENABLE ROW LEVEL SECURITY;
