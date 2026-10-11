type IntegrationExportSource = {
  provider: string;
  providerAccountId: string | null;
  scopes: string[];
  connectedAt: Date;
  lastSyncedAt: Date | null;
  revokedAt: Date | null;
  metadata: unknown;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function shapeAccountExportConnection(row: IntegrationExportSource) {
  const metadata = record(row.metadata);
  const safeMetadata = row.provider === 'jira_cloud'
    ? { siteName: optionalText(metadata.siteName), siteUrl: optionalText(metadata.siteUrl) }
    : row.provider === 'notion' ? { workspaceName: optionalText(metadata.workspaceName) } : {};
  return {
    provider: row.provider, providerAccountId: row.providerAccountId, scopes: row.scopes,
    connectedAt: row.connectedAt, lastSyncedAt: row.lastSyncedAt, revokedAt: row.revokedAt,
    metadata: safeMetadata,
  };
}
