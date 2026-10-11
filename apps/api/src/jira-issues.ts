export const jiraAssignedIssuesQuery = {
  jql: 'assignee = currentUser() ORDER BY updated DESC',
  maxResults: 30,
  fields: ['summary', 'status', 'duedate', 'updated', 'project', 'issuetype', 'priority'],
} as const;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function nestedName(value: unknown, fallback = ''): string {
  const name = record(value)?.name;
  return typeof name === 'string' ? name : fallback;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function jiraSiteBase(siteUrl: string): string | null {
  try {
    const url = new URL(siteUrl);
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** Keep Jira imports to small, read-only references and tolerate partial provider fields. */
export function jiraIssueReferences(value: unknown, siteUrl: string) {
  const issues = record(value)?.issues;
  if (!Array.isArray(issues)) return [];
  const base = jiraSiteBase(siteUrl);

  return issues.slice(0, jiraAssignedIssuesQuery.maxResults).flatMap((entry) => {
    const issue = record(entry);
    const fields = record(issue?.fields);
    const id = optionalString(issue?.id);
    const key = optionalString(issue?.key);
    if (!id || !key) return [];

    return [{
      id,
      key,
      summary: optionalString(fields?.summary) ?? 'Untitled issue',
      status: nestedName(fields?.status, 'Unknown'),
      project: nestedName(fields?.project),
      issueType: nestedName(fields?.issuetype),
      priority: optionalString(record(fields?.priority)?.name),
      dueDate: optionalString(fields?.duedate),
      updatedAt: optionalString(fields?.updated),
      url: base ? `${base}/browse/${encodeURIComponent(key)}` : null,
    }];
  });
}
