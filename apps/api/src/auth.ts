import type { FastifyRequest } from 'fastify';
import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

const authFetch: typeof fetch = (input, init = {}) => {
  const timeout = AbortSignal.timeout(20_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
};

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
  global: { fetch: authFetch },
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

declare module 'fastify' {
  interface FastifyRequest { ownerId: string | null }
}

export async function authenticate(request: FastifyRequest): Promise<void> {
  request.ownerId = null;
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return;
  const token = header.slice(7).trim();
  if (!token) return;
  const { data, error } = await supabase.auth.getUser(token);
  if (!error && data.user) request.ownerId = data.user.id;
}

export function requireOwner(request: FastifyRequest): string {
  if (!request.ownerId) {
    const error = new Error('Sign in to continue') as Error & { statusCode: number };
    error.statusCode = 401;
    throw error;
  }
  return request.ownerId;
}
