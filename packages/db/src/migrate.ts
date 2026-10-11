import { config } from 'dotenv';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), override: false });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');
const client = postgres(connectionString, { max: 1, prepare: false, ssl: process.env.NODE_ENV === 'production' ? 'require' : undefined });
const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));

try {
  await client`CREATE TABLE IF NOT EXISTS veylo_schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const applied = new Set((await client`SELECT name FROM veylo_schema_migrations`).map((row) => row.name as string));
  const names = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
  for (const name of names) {
    if (applied.has(name)) continue;
    const sql = await readFile(path.join(migrationsDir, name), 'utf8');
    await client.begin(async (transaction) => {
      // Migration files are trusted repository SQL. Execute the whole file as
      // one simple query so quoted strings, comments, and procedural blocks
      // may safely contain semicolons.
      await transaction.unsafe(sql);
      await transaction`INSERT INTO veylo_schema_migrations (name) VALUES (${name})`;
    });
    console.info(`Applied database migration ${name}`);
  }
} finally {
  await client.end({ timeout: 5 });
}
