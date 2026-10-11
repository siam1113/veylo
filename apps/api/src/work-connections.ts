import { providerJson, safeLink, type ConnectionEntries } from './connection-providers.js';

export type WorkProvider = 'todoist' | 'microsoft_todo' | 'linear' | 'github' | 'slack';
export function isWorkProvider(provider: string): provider is WorkProvider {
  return ['todoist', 'microsoft_todo', 'linear', 'github', 'slack'].includes(provider);
}
const problem = (message: string) => Object.assign(new Error(message), { statusCode: 409 });

export async function readWorkEntries(provider: WorkProvider, token: string): Promise<ConnectionEntries> {
  const read = <T>(url: string, init: RequestInit = {}) => providerJson<T>(url, {
    ...init, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...init.headers },
  });
  if (provider === 'todoist') {
    const result = await read<{ results: Array<{ id: string; content: string; is_completed?: boolean; checked?: boolean; due?: { date: string; datetime?: string } | null; url?: string }>; next_cursor?: string | null }>('https://api.todoist.com/api/v1/tasks?limit=100');
    return { entries: result.results.filter((task) => !task.is_completed && !task.checked).map((task) => ({
      id: task.id, title: task.content, date: task.due?.datetime ?? task.due?.date,
      url: safeLink(task.url, 'todoist.com') ?? `https://app.todoist.com/app/task/${encodeURIComponent(task.id)}`, context: 'Todoist task',
    })), hasMore: Boolean(result.next_cursor), notice: 'Open tasks from your Todoist account, including shared projects.' };
  }
  if (provider === 'microsoft_todo') {
    const lists = await read<{ value: Array<{ id: string; displayName: string }>; '@odata.nextLink'?: string }>('https://graph.microsoft.com/v1.0/me/todo/lists?$top=5');
    const pages = await Promise.all(lists.value.slice(0, 5).map(async (list) => {
      const query = new URLSearchParams({ '$filter': "status ne 'completed'", '$top': '100' });
      const page = await read<{ value: Array<{ id: string; title: string; status: string; dueDateTime?: { dateTime: string } | null }>; '@odata.nextLink'?: string }>(`https://graph.microsoft.com/v1.0/me/todo/lists/${encodeURIComponent(list.id)}/tasks?${query}`);
      return { entries: page.value.filter((task) => task.status !== 'completed').map((task) => ({
        id: `${list.id}:${task.id}`, title: task.title, date: task.dueDateTime?.dateTime.slice(0, 10), context: list.displayName,
      })), hasMore: Boolean(page['@odata.nextLink']) };
    }));
    const entries = pages.flatMap((page) => page.entries);
    return { entries: entries.slice(0, 100), hasMore: Boolean(lists['@odata.nextLink']) || lists.value.length > 5 || entries.length > 100 || pages.some((page) => page.hasMore), notice: 'Open tasks from up to five Microsoft To Do lists.' };
  }
  if (provider === 'linear') {
    const result = await read<{
      data?: { viewer: { assignedIssues: { nodes: Array<{ id: string; identifier: string; title: string; dueDate: string | null; url: string; team: { name: string }; state: { type: string } }>; pageInfo: { hasNextPage: boolean } } } }; errors?: unknown[];
    }>('https://api.linear.app/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      query: 'query VeyloAssignedIssues { viewer { assignedIssues(first: 100, filter: { state: { type: { nin: ["completed", "canceled"] } } }) { nodes { id identifier title dueDate url team { name } state { type } } pageInfo { hasNextPage } } } }',
    }) });
    if (result.errors?.length || !result.data?.viewer?.assignedIssues) throw problem('Linear could not load your assigned issues. Check access and try again.');
    const issues = result.data.viewer.assignedIssues;
    return { entries: issues.nodes.filter((issue) => !['completed', 'canceled'].includes(issue.state.type)).map((issue) => ({ id: issue.id, title: `${issue.identifier} · ${issue.title}`, date: issue.dueDate, url: safeLink(issue.url, 'linear.app'), context: issue.team.name })), hasMore: issues.pageInfo.hasNextPage };
  }
  if (provider === 'github') {
    // GitHub App permissions are selected at registration/installation, not broad OAuth repo scopes.
    const issues = await read<Array<{ id: number; number: number; title: string; html_url: string; pull_request?: unknown; repository?: { full_name: string }; milestone?: { due_on?: string | null } | null }>>('https://api.github.com/issues?filter=assigned&state=open&per_page=100&sort=updated', { headers: { 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Veylo' } });
    return { entries: issues.filter((issue) => !issue.pull_request).map((issue) => ({ id: String(issue.id), title: `#${issue.number} · ${issue.title}`, url: safeLink(issue.html_url, 'github.com'), context: issue.repository?.full_name ?? 'GitHub issue', date: issue.milestone?.due_on })), hasMore: issues.length >= 100, notice: 'Assigned open issues in repositories where the GitHub App is installed. Dates refer to milestone deadlines.' };
  }
  const query = new URLSearchParams({ query: 'from:me', count: '50', sort: 'timestamp', sort_dir: 'desc', highlight: 'false' });
  const result = await read<{ ok: boolean; messages?: { matches: Array<{ ts: string; text: string; permalink?: string; channel: { id: string; name?: string } }>; paging?: { pages?: number }; pagination?: { page_count?: number }; total?: number }; error?: string }>(`https://slack.com/api/search.messages?${query}`);
  if (!result.ok || !result.messages) throw problem('Slack could not load messages. Reconnect with message search access or check your workspace’s app policy.');
  return { entries: result.messages.matches.map((message) => {
    const title = slackText(message.text); const url = safeLink(message.permalink, 'slack.com');
    return { id: `${message.channel.id}:${message.ts}`, title, url,
      date: Number.isFinite(Number(message.ts)) ? new Date(Number(message.ts) * 1000).toISOString() : null,
      context: message.channel.name ? `#${message.channel.name}` : 'Slack message', captureText: title,
    };
  }), hasMore: (result.messages.paging?.pages ?? result.messages.pagination?.page_count ?? 1) > 1 || (result.messages.total ?? 0) > result.messages.matches.length, notice: 'Your 50 most recent searchable messages. Only messages you choose to keep become Veylo thoughts.' };
}

export function slackText(value: string) {
  return value.replace(/<(https?:\/\/[^>|]+)\|([^>]+)>/g, '$2 ($1)').replace(/<(https?:\/\/[^>]+)>/g, '$1')
    .replace(/<[@#]([^>|]+)(?:\|([^>]+))?>/g, (_match, id: string, label: string | undefined) => label ?? id)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
