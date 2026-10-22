import postgres from 'postgres';

if (process.env.CLEARHEAD_DB_TESTS !== '1') throw new Error('Set CLEARHEAD_DB_TESTS=1 to initialize the disposable migration test database.');
if (process.env.NODE_ENV === 'production') throw new Error('Database contract tests cannot run in production.');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must point to a disposable Postgres test database.');

const client = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
try {
  await client`CREATE SCHEMA IF NOT EXISTS auth`;
  await client`CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY)`;
} finally {
  await client.end({ timeout: 5 });
}
