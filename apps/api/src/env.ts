import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
config({ path: path.resolve(rootEnv), override: false });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4100),
  HOST: z.string().default('0.0.0.0'),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().default(''),
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().optional(),
  // Compatibility for projects that have not yet moved from Supabase's legacy API keys.
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  JIRA_CLIENT_ID: z.string().optional(),
  JIRA_CLIENT_SECRET: z.string().optional(),
  JIRA_REDIRECT_URI: z.string().url().optional(),
  NOTION_CLIENT_ID: z.string().optional(),
  NOTION_CLIENT_SECRET: z.string().optional(),
  NOTION_REDIRECT_URI: z.string().url().optional(),
  OUTLOOK_CLIENT_ID: z.string().optional(),
  OUTLOOK_CLIENT_SECRET: z.string().optional(),
  OUTLOOK_REDIRECT_URI: z.string().url().optional(),
  CLICKUP_CLIENT_ID: z.string().optional(),
  CLICKUP_CLIENT_SECRET: z.string().optional(),
  CLICKUP_REDIRECT_URI: z.string().url().optional(),
  ASANA_CLIENT_ID: z.string().optional(),
  ASANA_CLIENT_SECRET: z.string().optional(),
  ASANA_REDIRECT_URI: z.string().url().optional(),
  TRELLO_CLIENT_ID: z.string().optional(),
  TRELLO_CLIENT_SECRET: z.string().optional(),
  TRELLO_REDIRECT_URI: z.string().url().optional(),
  TODOIST_CLIENT_ID: z.string().optional(),
  TODOIST_CLIENT_SECRET: z.string().optional(),
  TODOIST_REDIRECT_URI: z.string().url().optional(),
  MICROSOFT_TODO_CLIENT_ID: z.string().optional(),
  MICROSOFT_TODO_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_TODO_REDIRECT_URI: z.string().url().optional(),
  LINEAR_CLIENT_ID: z.string().optional(),
  LINEAR_CLIENT_SECRET: z.string().optional(),
  LINEAR_REDIRECT_URI: z.string().url().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_REDIRECT_URI: z.string().url().optional(),
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SLACK_REDIRECT_URI: z.string().url().optional(),
  MOBILE_REDIRECT_URI: z.string().default('veylo:///'),
  OAUTH_STATE_SECRET: z.string().min(32).optional(),
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  PUSH_SUBSCRIPTION_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
  METRICS_TOKEN: z.string().min(32).optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  OPENAI_REALTIME_MODEL: z.string().default('gpt-realtime'),
});

const parsedEnv = envSchema.safeParse(process.env);
if (!parsedEnv.success) {
  const issues = parsedEnv.error.issues
    .map(({ path, message }) => `  - ${path.join('.') || 'environment'}: ${message}`)
    .join('\n');
  throw new Error(
    `ClearHead API environment is incomplete or invalid:\n${issues}\n`
    + 'For local setup, configure these values in the repository root .env '
    + '(copy .env.example first if needed).',
  );
}

export const env = parsedEnv.data;
