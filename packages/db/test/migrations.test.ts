import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;

test('migrations enable private tables and enforce same-owner relationships and schedules', { skip: !databaseUrl }, async () => {
  const client = postgres(databaseUrl!, { max: 1, prepare: false });
  const ownerA = randomUUID(); const ownerB = randomUUID();
  const intentionA = randomUUID(); const intentionB = randomUUID();
  try {
    const applied = await client`SELECT name FROM veylo_schema_migrations ORDER BY name`;
    assert.deepEqual(applied.map((row) => row.name), [
      '0001_initial.sql', '0002_user_preferences.sql', '0003_suggestion_feedback.sql',
      '0004_push_devices.sql', '0005_web_push_subscriptions.sql', '0006_snooze_reminder_claims.sql',
      '0007_enable_row_level_security.sql', '0008_enforce_intention_ownership.sql', '0009_brainstorm_messages.sql',
      '0010_reject_blank_captures.sql', '0011_intention_revision_history.sql', '0012_one_time_oauth_states.sql',
      '0013_expand_raw_capture_limit.sql', '0014_more_connection_providers.sql', '0015_original_versions.sql', '0016_alignment_anchors.sql',
    ]);

    const protectedTables = [
      'intentions', 'intention_relationships', 'time_blocks', 'integrations', 'idempotency_keys',
      'suggestions', 'push_preferences', 'push_devices', 'web_push_subscriptions', 'oauth_states',
      'veylo_schema_migrations', 'brainstorm_messages', 'intention_revisions', 'alignment_anchors',
    ];
    const rls = await client`
      SELECT c.relname, c.relrowsecurity
      FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname IN (
        'intentions', 'intention_relationships', 'time_blocks', 'integrations', 'idempotency_keys',
        'suggestions', 'push_preferences', 'push_devices', 'web_push_subscriptions',
        'veylo_schema_migrations', 'brainstorm_messages', 'intention_revisions', 'alignment_anchors', 'oauth_states'
      )
    `;
    assert.equal(rls.length, protectedTables.length, 'all application tables should exist');
    assert.ok(rls.every((table) => table.relrowsecurity), 'RLS must be enabled on every application table');
    const policies = await client`SELECT count(*)::int AS count FROM pg_policies WHERE schemaname = 'public'`;
    assert.equal(policies[0]?.count, 0, 'browser Supabase roles must not have direct application table policies');

    await client`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'CREATE ROLE anon NOLOGIN'; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'CREATE ROLE authenticated NOLOGIN'; END IF;
    END $$`;
    await client`GRANT USAGE ON SCHEMA public TO anon, authenticated`;
    await client`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated`;

    await client`INSERT INTO auth.users (id) VALUES (${ownerA}), (${ownerB})`;
    await client`
      INSERT INTO intentions (id, owner_id, client_id, raw_capture, title)
      VALUES
        (${intentionA}, ${ownerA}, ${randomUUID()}, 'Private intention A', 'A'),
        (${intentionB}, ${ownerB}, ${randomUUID()}, 'Private intention B', 'B')
    `;
    const [createdRevision] = await client`
      SELECT action, changed_fields FROM intention_revisions
      WHERE owner_id = ${ownerA} AND intention_id = ${intentionA} AND version = 1
    `;
    assert.equal(createdRevision?.action, 'created', 'a new intention should receive a baseline history row');
    assert.ok(createdRevision?.changed_fields.includes('title'));
    await client`UPDATE intentions SET title = 'A revised title', version = version + 1, updated_at = now() WHERE id = ${intentionA}`;
    const [updatedRevision] = await client`
      SELECT action, changed_fields FROM intention_revisions
      WHERE owner_id = ${ownerA} AND intention_id = ${intentionA} AND version = 2
    `;
    assert.equal(updatedRevision?.action, 'updated');
    assert.deepEqual(updatedRevision?.changed_fields, ['title'], 'history keeps field names without storing old values');
    const privateHistory = await client`SELECT count(*)::int AS count FROM intention_revisions WHERE owner_id = ${ownerB} AND intention_id = ${intentionA}`;
    assert.equal(privateHistory[0]?.count, 0, 'revision history cannot cross account ownership');
    const whitespaceCapture = ' \t\n ';
    await assert.rejects(client`
      INSERT INTO intentions (owner_id, client_id, raw_capture, title)
      VALUES (${ownerA}, ${randomUUID()}, ${whitespaceCapture}, 'Blank capture')
    `, (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === '23514');
    const exactCapture = '  Keep the original wording.  ';
    const intentionA2 = randomUUID();
    const [preserved] = await client`
      INSERT INTO intentions (id, owner_id, client_id, raw_capture, title)
      VALUES (${intentionA2}, ${ownerA}, ${randomUUID()}, ${exactCapture}, 'A preserved capture')
      RETURNING raw_capture
    `;
    assert.equal(preserved?.raw_capture, exactCapture, 'the nonblank capture must not be trimmed by the database');
    const longCapture = 'a'.repeat(1201);
    const [longPreserved] = await client`
      INSERT INTO intentions (owner_id, client_id, raw_capture, title)
      VALUES (${ownerA}, ${randomUUID()}, ${longCapture}, 'A longer capture')
      RETURNING raw_capture
    `;
    assert.equal(longPreserved?.raw_capture, longCapture, 'long voice captures remain intact above the previous limit');
    const maximumCapture = 'b'.repeat(8000);
    const [maximumPreserved] = await client`
      INSERT INTO intentions (owner_id, client_id, raw_capture, title)
      VALUES (${ownerA}, ${randomUUID()}, ${maximumCapture}, 'A maximum-length capture')
      RETURNING raw_capture
    `;
    assert.equal(maximumPreserved?.raw_capture, maximumCapture, 'the full configured capture limit is accepted');
    await assert.rejects(client`
      INSERT INTO intentions (owner_id, client_id, raw_capture, title)
      VALUES (${ownerA}, ${randomUUID()}, ${'a'.repeat(8001)}, 'An oversized capture')
    `, (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === '23514');
    await client`INSERT INTO intention_relationships (owner_id, from_intention_id, to_intention_id) VALUES (${ownerA}, ${intentionA}, ${intentionA2})`;
    await client`
      INSERT INTO time_blocks (owner_id, intention_id, client_id, starts_at, ends_at, timezone)
      VALUES (${ownerA}, ${intentionA}, ${randomUUID()}, now(), now() + interval '30 minutes', 'UTC')
    `;

    for (const role of ['anon', 'authenticated']) {
      await client.unsafe(`SET ROLE "${role}"`);
      try {
        const visible = await client`SELECT count(*)::int AS count FROM intentions`;
        assert.equal(visible[0]?.count, 0, `${role} must not read owner records through the browser database API`);
        const visibleHistory = await client`SELECT count(*)::int AS count FROM intention_revisions`;
        assert.equal(visibleHistory[0]?.count, 0, `${role} must not read intention history through the browser database API`);
        await assert.rejects(client`
          INSERT INTO intentions (owner_id, client_id, raw_capture, title)
          VALUES (${ownerA}, ${randomUUID()}, 'Direct database write', 'Blocked')
        `, (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === '42501');
      } finally {
        await client`RESET ROLE`;
      }
    }

    await assert.rejects(client`
      INSERT INTO intention_relationships (owner_id, from_intention_id, to_intention_id)
      VALUES (${ownerA}, ${intentionA}, ${intentionB})
    `, (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === '23503');
    await assert.rejects(client`
      INSERT INTO time_blocks (owner_id, intention_id, client_id, starts_at, ends_at, timezone)
      VALUES (${ownerA}, ${intentionB}, ${randomUUID()}, now(), now() + interval '30 minutes', 'UTC')
    `, (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === '23503');

    const messageB = randomUUID();
    await client`
      INSERT INTO brainstorm_messages (id, owner_id, intention_id, client_request_id, role, status, content)
      VALUES (${messageB}, ${ownerB}, ${intentionB}, ${randomUUID()}, 'user', 'complete', 'Private prompt from B')
    `;
    await assert.rejects(client`
      INSERT INTO brainstorm_messages (owner_id, intention_id, client_request_id, parent_message_id, role, status)
      VALUES (${ownerA}, ${intentionA}, ${randomUUID()}, ${messageB}, 'assistant', 'pending')
    `, (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === '23503');

    await client`DELETE FROM auth.users WHERE id = ${ownerA}`;
    const remaining = await client`SELECT count(*)::int AS count FROM intentions WHERE owner_id = ${ownerA}`;
    assert.equal(remaining[0]?.count, 0, 'deleting an auth user should cascade to owned intentions');
  } finally {
    await client`DELETE FROM auth.users WHERE id IN (${ownerA}, ${ownerB})`.catch(() => undefined);
    await client.end({ timeout: 5 });
  }
});
