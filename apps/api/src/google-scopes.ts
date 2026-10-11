export function hasRequiredScopes(grantedScope: string, requiredScopes: readonly string[]): boolean {
  const granted = new Set(grantedScope.trim().split(/\s+/).filter(Boolean));
  return requiredScopes.every((scope) => granted.has(scope));
}
