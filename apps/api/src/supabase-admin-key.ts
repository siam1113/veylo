/** Prefer Supabase's current server-only secret key while accepting the legacy service_role key during migration. */
export function resolveSupabaseAdminKey(secretKey?: string, legacyServiceRoleKey?: string): string | null {
  return secretKey || legacyServiceRoleKey || null;
}
