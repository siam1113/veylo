import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4100';
const AUTH_REQUEST_TIMEOUT_MS = 20_000;

const authFetch: typeof fetch = async (input, init = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) abortFromCaller();
  else init.signal?.addEventListener('abort', abortFromCaller, { once: true });
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearTimeout(timeout);
    init.signal?.removeEventListener('abort', abortFromCaller);
  };
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const bodyReaders = new Set<PropertyKey>(['arrayBuffer', 'blob', 'formData', 'json', 'text']);
    return new Proxy(response, {
      get(target, property) {
        const value = Reflect.get(target, property, target) as unknown;
        if (bodyReaders.has(property) && typeof value === 'function') {
          return async (...args: unknown[]) => {
            try { return await value.apply(target, args); }
            finally { cleanup(); }
          };
        }
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  } catch (error) {
    cleanup();
    throw error;
  }
};

const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const auth = url && key ? createClient(url, key, {
  auth: { storage: secureStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
  global: { fetch: authFetch },
}) : null;

export async function apiRequest<T>(path: string, init: RequestInit = {}, expectedUserId: string | null): Promise<T> {
  const session = (await auth?.auth.getSession())?.data.session;
  if (!session) throw new Error('Sign in to sync this intention.');
  if (session.user.id !== expectedUserId) throw new Error('The signed-in account changed. Refresh ClearHead before syncing.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  const abortFromCaller = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) abortFromCaller();
  else init.signal?.addEventListener('abort', abortFromCaller, { once: true });
  try {
    const response = await fetch(`${apiUrl}/v1${path}`, {
      ...init, signal: controller.signal,
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw Object.assign(new Error(error.message ?? `Sync failed (${response.status})`), { statusCode: response.status });
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  } catch (error) {
    if (controller.signal.aborted && !init.signal?.aborted) throw new Error('ClearHead server request timed out. Check your connection and try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener('abort', abortFromCaller);
  }
}
