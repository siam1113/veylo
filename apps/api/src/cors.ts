export function parseCorsOrigins(webOrigin: string, configuredOrigins: string): Set<string> {
  return new Set([webOrigin, ...configuredOrigins.split(',').map((origin) => origin.trim()).filter(Boolean)]);
}

export function isCorsOriginAllowed(origin: string | undefined, allowedOrigins: Set<string>, allowLocalDevelopment = false): boolean {
  // Requests without an Origin header are non-browser clients and do not need CORS headers.
  if (!origin || allowedOrigins.has(origin)) return true;
  if (!allowLocalDevelopment) return false;

  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
      && parsed.origin === origin;
  } catch {
    return false;
  }
}
