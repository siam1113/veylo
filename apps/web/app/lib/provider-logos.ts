// Maps a provider id (either a time block's externalProvider, e.g. 'google_calendar', or
// a connection's full provider id, e.g. 'jira_cloud') to the logo slug already vendored
// under /assets/integrations/*.svg.
const providerLogoSlugs: Record<string, string> = {
  google_calendar: 'google-calendar',
  outlook: 'outlook',
  icloud: 'icloud',
  clickup: 'clickup',
  asana: 'asana',
  trello: 'trello',
  jira_cloud: 'jira',
  notion: 'notion',
  todoist: 'todoist',
  microsoft_todo: 'microsoft-todo',
  linear: 'linear',
  github: 'github',
  slack: 'slack',
};

export function providerLogoSrc(externalProvider?: string | null): string | null {
  if (!externalProvider) return null;
  const slug = providerLogoSlugs[externalProvider];
  return slug ? `/assets/integrations/${slug}.svg` : null;
}

const providerDisplayNames: Record<string, string> = {
  google_calendar: 'Google Calendar',
  outlook: 'Outlook Calendar',
  icloud: 'iCloud Calendar',
  clickup: 'ClickUp',
  asana: 'Asana',
  trello: 'Trello',
  jira_cloud: 'Jira Cloud',
  notion: 'Notion',
  todoist: 'Todoist',
  microsoft_todo: 'Microsoft To Do',
  linear: 'Linear',
  github: 'GitHub Issues',
  slack: 'Slack',
};

export function providerDisplayName(externalProvider?: string | null): string {
  if (!externalProvider) return 'your calendar';
  return providerDisplayNames[externalProvider] ?? externalProvider;
}

// Every distinct OAuth scope token ClearHead requests across its 13 providers, in plain
// language. A scope not in this map (a provider API change, or a custom literal we
// haven't labeled yet) falls back to a de-slugged version of the raw token rather than
// an unreadable fragment.
const scopeLabels: Record<string, string> = {
  openid: 'Sign-in verification',
  email: 'Email address',
  offline_access: 'Stay connected in the background',
  'https://www.googleapis.com/auth/calendar.freebusy': 'Free/busy availability',
  'https://www.googleapis.com/auth/calendar.events.owned': 'Create & manage events ClearHead creates',
  'https://www.googleapis.com/auth/calendar.events.readonly': 'Read upcoming event titles',
  'Calendars.ReadWrite': 'Read & create calendar events',
  'Calendars.ReadBasic': 'Read calendar events',
  'Tasks.Read': 'Read tasks',
  'tasks:read': 'Read tasks',
  'workspaces:read': 'Read workspaces',
  'users:read': 'Read your profile',
  'read:member:trello': 'Read your Trello profile',
  'read:board:trello': 'Read boards',
  'read:card:trello': 'Read cards',
  'data:read': 'Read tasks',
  read: 'Read assigned issues',
  'read:jira-work': 'Read assigned issues',
  'search:read': 'Search your messages',
  'calendar:read': 'Read calendar events',
};

export function humanizeScope(scope: string): string {
  if (scopeLabels[scope]) return scopeLabels[scope];
  const tail = scope.split(/[/:]/).pop() ?? scope;
  const words = tail.replace(/\./g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : scope;
}
