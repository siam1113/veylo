import { useEffect, useState } from 'react';
import { connectionProviderId, type ConnectionCatalog, type ConnectionEntries, type ConnectionStatus, type ConnectionProvider, type ConnectionEntry, type SyncClient } from '../lib/sync.client';
import { UiIcon } from './UiIcon';

const providers: Array<{ id: ConnectionProvider; name: string; group: 'Calendars' | 'Tasks & workspaces' | 'Messages'; logo: string; description: string; permissions: string[]; refresh: string; note: string }> = [
  { id: 'google', name: 'Google Calendar', group: 'Calendars', logo: 'google-calendar', description: 'Find a little room in your week.', permissions: ['Free/busy availability', 'Approved event creation'], refresh: 'Check this week’s availability', note: 'Event titles stay private. Veylo only creates a calendar event when you approve a time block.' },
  { id: 'outlook', name: 'Outlook Calendar', group: 'Calendars', logo: 'outlook', description: 'See what’s ahead in your Microsoft calendar.', permissions: ['Upcoming 30 days', 'Read-only'], refresh: 'Refresh upcoming events', note: 'View upcoming events from your default Outlook calendar. Your events stay unchanged.' },
  { id: 'icloud', name: 'iCloud Calendar', group: 'Calendars', logo: 'icloud', description: 'Bring your Apple calendars into view.', permissions: ['Upcoming 30 days', 'Veylo reads only'], refresh: 'Refresh upcoming events', note: 'Connect with an Apple app-specific password. Your credentials are stored encrypted on the server.' },
  { id: 'clickup', name: 'ClickUp', group: 'Tasks & workspaces', logo: 'clickup', description: 'Keep assigned tasks and due dates in view.', permissions: ['Assigned tasks', 'Due dates'], refresh: 'Refresh assigned tasks', note: 'Veylo reads tasks from the workspaces you authorize. It does not create or update tasks.' },
  { id: 'asana', name: 'Asana', group: 'Tasks & workspaces', logo: 'asana', description: 'Make space for the work assigned to you.', permissions: ['Assigned tasks', 'Read-only'], refresh: 'Refresh assigned tasks', note: 'View open tasks and due dates across your Asana workspaces.' },
  { id: 'trello', name: 'Trello', group: 'Tasks & workspaces', logo: 'trello', description: 'Bring your cards and deadlines into focus.', permissions: ['Assigned cards', 'Read-only'], refresh: 'Refresh assigned cards', note: 'View your open cards and their due dates. Your boards stay unchanged.' },
  { id: 'jira', name: 'Jira Cloud', group: 'Tasks & workspaces', logo: 'jira', description: 'A clearer view of your assigned issues.', permissions: ['Assigned issues', 'Read-only'], refresh: 'Refresh assigned issues', note: 'Issue details are read when you refresh and remain owned by your Jira site.' },
  { id: 'notion', name: 'Notion', group: 'Tasks & workspaces', logo: 'notion', description: 'Keep useful pages close to your intentions.', permissions: ['Selected page & database references', 'Read-only'], refresh: 'Refresh pages & databases', note: 'Notion’s page picker controls access. Page contents stay in Notion.' },
  { id: 'todoist', name: 'Todoist', group: 'Tasks & workspaces', logo: 'todoist', description: 'See your next steps and due dates.', permissions: ['Open tasks', 'Read-only'], refresh: 'Refresh open tasks', note: 'Includes tasks in your shared projects. Veylo does not change your tasks.' },
  { id: 'microsoft_todo', name: 'Microsoft To Do', group: 'Tasks & workspaces', logo: 'microsoft-todo', description: 'A little perspective on your daily lists.', permissions: ['Open tasks', 'Read-only'], refresh: 'Refresh tasks', note: 'Preview open tasks from up to five lists, with their due dates.' },
  { id: 'linear', name: 'Linear', group: 'Tasks & workspaces', logo: 'linear', description: 'Keep your assigned issues in sight.', permissions: ['Assigned issues', 'Read-only'], refresh: 'Refresh assigned issues', note: 'See open assigned issues, teams, and due dates. Your workspace stays unchanged.' },
  { id: 'github', name: 'GitHub Issues', group: 'Tasks & workspaces', logo: 'github', description: 'Make room for your open issues.', permissions: ['Assigned issues', 'Selected repositories'], refresh: 'Refresh assigned issues', note: 'Install the Veylo GitHub App on the repositories you choose. Pull requests are excluded.' },
  { id: 'slack', name: 'Slack', group: 'Messages', logo: 'slack', description: 'Give a useful message room to become a thought.', permissions: ['Your recent messages', 'Choose what to keep'], refresh: 'Refresh my messages', note: 'Veylo searches messages you sent. Choose Keep as thought to save a message and its source link. Nothing is posted to Slack.' },
];

export function Connections({ client, statuses, callbackMessage, onCapture }: { client: SyncClient | null; statuses: ConnectionStatus[]; callbackMessage: string; onCapture: (entry: ConnectionEntry) => Promise<void> }) {
  const [catalog, setCatalog] = useState<ConnectionCatalog[] | null>(null);
  const [error, setError] = useState(''); const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<'All' | 'Calendars' | 'Tasks & workspaces' | 'Messages'>('All');
  const [busy, setBusy] = useState<Partial<Record<ConnectionProvider, string>>>({});
  const [messages, setMessages] = useState<Partial<Record<ConnectionProvider, string>>>({});
  const [results, setResults] = useState<Partial<Record<ConnectionProvider, ConnectionEntries>>>({});
  const [icloudForm, setIcloudForm] = useState(false);
  const [appleId, setAppleId] = useState(''); const [appPassword, setAppPassword] = useState('');
  const [capturing, setCapturing] = useState<string | null>(null);
  const [savedMessages, setSavedMessages] = useState<Set<string>>(new Set());
  const [notionCursor, setNotionCursor] = useState<string | null>(null);
  useEffect(() => {
    if (!client) return;
    let active = true; setError(''); setCatalog(null);
    void Promise.all([client.connectionCatalog(), client.refreshConnections()]).then(([catalog]) => {
      if (active) setCatalog(catalog);
    }).catch(() => { if (active) setError('We couldn’t load your connections. Check your connection and try again.'); });
    return () => { active = false; };
  }, [client, attempt]);

  async function run(provider: ConnectionProvider, action: 'connect' | 'disconnect' | 'refresh' | 'more') {
    if (!client || busy[provider]) return;
    if (provider === 'icloud' && action === 'connect') { setIcloudForm(true); return; }
    setBusy((current) => ({ ...current, [provider]: action }));
    setMessages((current) => ({ ...current, [provider]: '' }));
    try {
      if (action === 'connect') { if (provider !== 'icloud') await client.connectProvider(provider); return; }
      if (action === 'disconnect') {
        const result = await client.disconnectProvider(provider);
        setResults((current) => ({ ...current, [provider]: undefined }));
        if (provider === 'notion') setNotionCursor(null);
        setMessages((current) => ({ ...current, [provider]: result.revocationWarning ?? 'Disconnected from Veylo.' })); return;
      }
      let result: ConnectionEntries;
      if (provider === 'google') {
        const start = new Date(); start.setDate(start.getDate() - start.getDay()); start.setHours(0, 0, 0, 0);
        const end = new Date(start); end.setDate(end.getDate() + 7);
        const data = await client.calendarAvailability(start.toISOString(), end.toISOString(), Intl.DateTimeFormat().resolvedOptions().timeZone);
        result = { entries: data.busy.map((window, index) => ({ id: `${window.start}:${index}`, title: 'Busy', date: window.start, context: `Until ${new Date(window.end).toLocaleString()}` })), hasMore: false };
      } else if (provider === 'jira') {
        const data = await client.getJiraIssues();
        result = { entries: data.issues.map((issue) => ({ id: issue.id, title: `${issue.key} · ${issue.summary}`, date: issue.dueDate, url: issue.url ?? undefined, context: [issue.project, issue.status].filter(Boolean).join(' · ') })), hasMore: false };
      } else if (provider === 'notion') {
        const data = await client.getNotionPages(action === 'more' ? notionCursor ?? undefined : undefined);
        setNotionCursor(data.nextCursor);
        const entries = data.pages.map((page) => ({ id: page.id, title: page.title, url: page.url, context: page.kind === 'database' ? 'Database' : 'Page' }));
        result = { entries: action === 'more' ? Array.from(new Map([...(results.notion?.entries ?? []), ...entries].map((entry) => [entry.id, entry])).values()) : entries, hasMore: data.hasMore };
      } else result = await client.connectionEntries(provider);
      setResults((current) => ({ ...current, [provider]: result }));
      if (!result.entries.length) setMessages((current) => ({ ...current, [provider]: provider === 'google' ? 'No busy times found this week.' : 'Nothing to show right now. You’re up to date.' }));
    } catch (error) { setMessages((current) => ({ ...current, [provider]: error instanceof Error ? error.message : 'That didn’t work. Please try again.' })); }
    finally { setBusy((current) => ({ ...current, [provider]: undefined })); }
  }

  async function connectIcloud() {
    if (!client || busy.icloud) return;
    setBusy((current) => ({ ...current, icloud: 'connect' }));
    setMessages((current) => ({ ...current, icloud: '' }));
    try {
      await client.connectIcloud({ appleId, appPassword }); setIcloudForm(false); setAppleId('');
      setResults((current) => ({ ...current, icloud: undefined }));
      setMessages((current) => ({ ...current, icloud: 'Connected. Refresh to see your upcoming events.' }));
    } catch (error) { setMessages((current) => ({ ...current, icloud: error instanceof Error ? error.message : 'Could not connect to iCloud.' })); }
    finally { setAppPassword(''); setBusy((current) => ({ ...current, icloud: undefined })); }
  }
  async function keepMessage(entry: ConnectionEntry) {
    if (capturing || savedMessages.has(entry.id)) return;
    setCapturing(entry.id);
    try { await onCapture(entry); setSavedMessages((current) => new Set([...current, entry.id])); }
    catch (error) { setMessages((current) => ({ ...current, slack: error instanceof Error ? error.message : 'Could not keep this message. Try again.' })); }
    finally { setCapturing(null); }
  }

  const connectedCount = statuses.filter((status) => status.connected).length;
  return <div className="connections-content">
    <div className="connections-toolbar"><div className="connection-filters" aria-label="Connection categories">{(['All', 'Calendars', 'Tasks & workspaces', 'Messages'] as const).map((value) => <button key={value} className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}</button>)}</div><span>{connectedCount} connected</span></div>
    {callbackMessage && <p className="connection-notice" role="status">{callbackMessage}</p>}
    {error ? <div className="connection-notice" role="alert">{error} <button className="outline-button" onClick={() => setAttempt((value) => value + 1)}>Retry</button></div> : !catalog ? <p className="connection-notice" role="status">Loading your connections…</p> : null}
    {(['Calendars', 'Tasks & workspaces', 'Messages'] as const).filter((group) => filter === 'All' || filter === group).map((group) => <section className="connection-group" key={group} aria-label={group}>
      <h2 className="connection-group-title">{group}<span>{group === 'Calendars' ? 'A little more room for what matters.' : group === 'Messages' ? 'Keep the words that matter.' : 'Your work, with a wider perspective.'}</span></h2>
      <div className="connections-grid">{providers.filter((provider) => provider.group === group).map((provider) => {
        const status = statuses.find((status) => status.provider === connectionProviderId(provider.id));
        const configured = catalog?.find((item) => item.provider === connectionProviderId(provider.id))?.configured;
        const connected = Boolean(status?.connected); const pending = busy[provider.id]; const result = results[provider.id];
        return <article className="integration-card" key={provider.id} aria-label={provider.name}>
          <div className="integration-head"><div className="integration-logo"><img src={`/assets/integrations/${provider.logo}.svg`} alt="" width="28" height="28" /></div><div className="integration-title"><h3>{provider.name}</h3><p>{provider.description}</p></div></div>
          <div className={`integration-status ${connected ? 'state-success' : configured === false ? 'state-warning' : catalog ? 'state-neutral' : 'state-pending'}`}><i />{connected ? <UiIcon name="check" /> : configured === false ? <UiIcon name="alert" /> : <UiIcon name="cloud" />}{connected ? `Connected${status?.siteName || status?.workspaceName ? ` · ${status.siteName || status.workspaceName}` : ''}` : configured === false ? 'Setup required' : catalog ? 'Not connected' : 'Checking connection…'}</div>
          <div className="integration-permissions">{provider.permissions.map((permission) => <span key={permission}>{permission}</span>)}</div>
          {configured === false && <p className="connection-setup-note">This connection isn’t available in Veylo yet. Your administrator needs to finish setup before you can connect.</p>}
          <div className="integration-actions"><button className="capture-button" disabled={!client || !configured || Boolean(pending)} onClick={() => void run(provider.id, 'connect')}><span>{pending === 'connect' ? 'Connecting…' : connected ? 'Reconnect' : `Connect ${provider.name}`}</span><span aria-hidden="true">↗</span></button>{connected && <button className="outline-button" disabled={Boolean(pending)} onClick={() => void run(provider.id, 'disconnect')}>{pending === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}</button>}</div>
          {provider.id === 'icloud' && icloudForm && <form className="icloud-connect-form" onSubmit={(event) => { event.preventDefault(); void connectIcloud(); }}>
            <label htmlFor="icloud-email">Apple Account email</label><input id="icloud-email" type="email" autoComplete="username" required value={appleId} onChange={(event) => setAppleId(event.target.value)} disabled={Boolean(pending)} />
            <label htmlFor="icloud-password">App-specific password</label><input id="icloud-password" type="password" autoComplete="new-password" required pattern="[A-Za-z]{4}(-[A-Za-z]{4}){3}" placeholder="xxxx-xxxx-xxxx-xxxx" value={appPassword} onChange={(event) => setAppPassword(event.target.value)} disabled={Boolean(pending)} aria-describedby="icloud-password-help" />
            <p id="icloud-password-help" className="connection-setup-note">Use an <a href="https://support.apple.com/en-us/102654" target="_blank" rel="noreferrer">Apple app-specific password</a>, not your main account password. Veylo stores it encrypted to read your calendars.</p>
            <div className="integration-actions"><button type="submit" className="capture-button" disabled={Boolean(pending)}>{pending === 'connect' ? 'Connecting…' : 'Connect calendar'}</button><button type="button" className="outline-button" disabled={Boolean(pending)} onClick={() => { setIcloudForm(false); setAppPassword(''); setAppleId(''); }}>Cancel</button></div>
          </form>}
          {connected && <button className="outline-button connection-refresh" disabled={Boolean(pending) || !catalog} onClick={() => void run(provider.id, 'refresh')}>{pending === 'refresh' ? 'Refreshing…' : provider.refresh}</button>}
          {messages[provider.id] && <div className="availability-result" role="status">{messages[provider.id]}</div>}
          {result?.notice && <p className="connection-setup-note">{result.notice}</p>}
          {result?.entries.length ? <ul className="connection-entries">{result.entries.map((entry) => <li key={entry.id}><div>{entry.url ? <a href={entry.url} target="_blank" rel="noreferrer">{entry.title} <span aria-hidden="true">↗</span></a> : <b>{entry.title}</b>}<small>{[entry.context, entry.date ? formatDate(entry.date) : null].filter(Boolean).join(' · ')}</small></div>{provider.id === 'slack' && <button className="outline-button connection-keep" disabled={Boolean(capturing) || savedMessages.has(entry.id)} onClick={() => void keepMessage(entry)}>{savedMessages.has(entry.id) ? 'Kept as thought' : capturing === entry.id ? 'Keeping…' : 'Keep as thought'}</button>}</li>)}</ul> : null}
          {result?.hasMore && (provider.id === 'notion' ? <button className="outline-button" disabled={Boolean(pending)} onClick={() => void run('notion', 'more')}>{pending === 'more' ? 'Loading…' : 'Load more references'}</button> : <p className="connection-setup-note">This is a limited preview. Open {provider.name} to see everything.</p>)}
          <div className="integration-footnote"><span aria-hidden="true">⌑</span>{provider.note}</div>
        </article>;
      })}</div>
    </section>)}
  </div>;
}
function formatDate(date: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Date(`${date}T12:00:00`).toLocaleDateString();
  const value = new Date(date); return Number.isNaN(value.getTime()) ? date : value.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
