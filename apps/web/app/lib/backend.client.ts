import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

export const API = (import.meta.env?.VITE_API_URL as string | undefined) ?? 'http://localhost:4100';
const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

const AUTH_REQUEST_TIMEOUT_MS = 20_000;
const authFetch: typeof fetch = (input, init = {}) => {
  const timeout = AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
};

export const authClient: SupabaseClient | null = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { global: { fetch: authFetch } })
  : null;

export async function reportClientRenderError(error: unknown, componentStack = ''): Promise<void> {
  if (!authClient || !globalThis.crypto?.subtle) return;
  try {
    const { data } = await authClient.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const errorType = error instanceof Error && ['TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError'].includes(error.name)
      ? error.name : error instanceof Error ? 'Error' : 'unknown';
    const fingerprintInput = `${errorType}:${componentStack.slice(0, 2000)}`;
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprintInput));
    const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    await fetch(`${API.replace(/\/$/, '')}/v1/telemetry/client-errors`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'web', errorType, fingerprint }),
      keepalive: true,
    });
  } catch { /* Diagnostics must never interrupt the recovery screen. */ }
}
