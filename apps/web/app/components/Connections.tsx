import { useEffect, useState } from 'react';
import { connectionProviderId, type ConnectionCatalog, type ConnectionEntries, type ConnectionStatus, type ConnectionProvider, type ConnectionEntry, type SyncClient } from '../lib/sync.client';
import { humanizeScope } from '../lib/provider-logos';
import { UiIcon } from './UiIcon';
import { SegmentedTabs } from './SegmentedTabs';
import { ProviderBadge } from './ProviderBadge';
import { AccountBadge } from './AccountBadge';

const connectionFilters = ['All', 'Calendars', 'Tasks & workspaces', 'Messages'] as const;

const providers: Array<{ id: ConnectionProvider; name: string; group: 'Calendars' | 'Tasks & workspaces' | 'Messages'; logo: string; description: string; permissions: string[]; refresh: string; note: string }> = [
  { id: 'google', name: 'Google Calendar', group: 'Calendars', logo: 'google-calendar', description: 'Find a little room in your week.', permissions: ['Free/busy availability', 'Autonomous import, read-only', 'Approved event creation'], refresh: 'Sync now', note: 'Events you create directly in Google Calendar appear automatically in Explore and your schedule. ClearHead only writes to your calendar when you approve a time block.' },
  { id: 'outlook', name: 'Outlook Calendar', group: 'Calendars', logo: 'outlook', description: 'See what’s ahead in your Microsoft calendar.', permissions: ['Autonomous import, read-only', 'Approved event creation'], refresh: 'Sync now', note: 'Events you create directly in Outlook appear automatically in Explore and your schedule. ClearHead only writes to your calendar when you approve a time block.' },
  { id: 'icloud', name: 'iCloud Calendar', group: 'Calendars', logo: 'icloud', description: 'Bring your Apple calendars into view.', permissions: ['Upcoming 30 days', 'ClearHead reads only'], refresh: 'Refresh upcoming events', note: 'Connect with an Apple app-specific password. Your credentials are stored encrypted on the server.' },
  { id: 'clickup', name: 'ClickUp', group: 'Tasks & workspaces', logo: 'clickup', description: 'Keep assigned tasks and due dates in view.', permissions: ['Assigned tasks', 'Due dates'], refresh: 'Refresh assigned tasks', note: 'ClearHead reads tasks from the workspaces you authorize. It does not create or update tasks.' },
  { id: 'asana', name: 'Asana', group: 'Tasks & workspaces', logo: 'asana', description: 'Make space for the work assigned to you.', permissions: ['Assigned tasks', 'Read-only'], refresh: 'Refresh assigned tasks', note: 'View open tasks and due dates across your Asana workspaces.' },
  { id: 'trello', name: 'Trello', group: 'Tasks & workspaces', logo: 'trello', description: 'Bring your cards and deadlines into focus.', permissions: ['Assigned cards', 'Read-only'], refresh: 'Refresh assigned cards', note: 'View your open cards and their due dates. Your boards stay unchanged.' },
  { id: 'jira', name: 'Jira Cloud', group: 'Tasks & workspaces', logo: 'jira', description: 'A clearer view of your assigned issues.', permissions: ['Assigned issues', 'Read-only'], refresh: 'Refresh assigned issues', note: 'Issue details are read when you refresh and remain owned by your Jira site.' },
  { id: 'notion', name: 'Notion', group: 'Tasks & workspaces', logo: 'notion', description: 'Keep useful pages close to your intentions.', permissions: ['Selected page & database references', 'Read-only'], refresh: 'Refresh pages & databases', note: 'Notion’s page picker controls access. Page contents stay in Notion.' },
  { id: 'todoist', name: 'Todoist', group: 'Tasks & workspaces', logo: 'todoist', description: 'See your next steps and due dates.', permissions: ['Open tasks', 'Read-only'], refresh: 'Refresh open tasks', note: 'Includes tasks in your shared projects. ClearHead does not change your tasks.' },
  { id: 'microsoft_todo', name: 'Microsoft To Do', group: 'Tasks & workspaces', logo: 'microsoft-todo', description: 'A little perspective on your daily lists.', permissions: ['Open tasks', 'Read-only'], refresh: 'Refresh tasks', note: 'Preview open tasks from up to five lists, with their due dates.' },
  { id: 'linear', name: 'Linear', group: 'Tasks & workspaces', logo: 'linear', description: 'Keep your assigned issues in sight.', permissions: ['Assigned issues', 'Read-only'], refresh: 'Refresh assigned issues', note: 'See open assigned issues, teams, and due dates. Your workspace stays unchanged.' },
  { id: 'github', name: 'GitHub Issues', group: 'Tasks & workspaces', logo: 'github', description: 'Make room for your open issues.', permissions: ['Assigned issues', 'Selected repositories'], refresh: 'Refresh assigned issues', note: 'Install the ClearHead GitHub App on the repositories you choose. Pull requests are excluded.' },
  { id: 'slack', name: 'Slack', group: 'Messages', logo: 'slack', description: 'Give a useful message room to become a thought.', permissions: ['Your recent messages', 'Choose what to keep'], refresh: 'Refresh my messages', note: 'ClearHead searches messages you sent. Choose Keep as thought to save a message and its source link. Nothing is posted to Slack.' },
];

export function Connections({ client, statuses, callbackMessage, onCapture, syncingAccounts, onMarkSyncing }: {
  client: SyncClient | null; statuses: ConnectionStatus[]; callbackMessage: string; onCapture: (entry: ConnectionEntry) => Promise<void>;
  // Lifted into Home rather than kept here: this component unmounts whenever the user
  // leaves the Connections tab, which would otherwise drop "still syncing" the instant
  // they switch away and back while a background job is still running.
  syncingAccounts: Record<string, string>; onMarkSyncing: (accountIds: string[]) => void;
}) {
  const [catalog, setCatalog] = useState<ConnectionCatalog[] | null>(null);
  const [error, setError] = useState(''); const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<'All' | 'Calendars' | 'Tasks & workspaces' | 'Messages'>('All');
  // Keyed by either a provider id (connect/refresh, which stay provider-wide) or a
  // specific account's integration id (disconnect/sync-now, which are per-account now
  // that a provider can have more than one connected account).
  const [busy, setBusy] = useState<Record<string, string | undefined>>({});
  const [messages, setMessages] = useState<Record<string, string | undefined>>({});
  const [results, setResults] = useState<Partial<Record<ConnectionProvider, ConnectionEntries>>>({});
  const [icloudForm, setIcloudForm] = useState(false);
  const [appleId, setAppleId] = useState(''); const [appPassword, setAppPassword] = useState('');
  const [capturing, setCapturing] = useState<string | null>(null);
  const [savedMessages, setSavedMessages] = useState<Set<string>>(new Set());
  const [notionCursor, setNotionCursor] = useState<string | null>(null);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState(''); const [editIcon, setEditIcon] = useState('');
  useEffect(() => {
    if (!client) return;
    let active = true; setError(''); setCatalog(null);
    void Promise.all([client.connectionCatalog(), client.refreshConnections()]).then(([catalog]) => {
      if (active) setCatalog(catalog);
    }).catch(() => { if (active) setError('We couldn’t load your connections. Check your connection and try again.'); });
    return () => { active = false; };
  }, [client, attempt]);

  async function fetchEntries(provider: ConnectionProvider, more: boolean): Promise<ConnectionEntries> {
    if (provider === 'jira') {
      const data = await client!.getJiraIssues();
      return { entries: data.issues.map((issue) => ({ id: issue.id, title: `${issue.key} · ${issue.summary}`, date: issue.dueDate, url: issue.url ?? undefined, context: [issue.project, issue.status].filter(Boolean).join(' · ') })), hasMore: false };
    }
    if (provider === 'notion') {
      const data = await client!.getNotionPages(more ? notionCursor ?? undefined : undefined);
      setNotionCursor(data.nextCursor);
      const entries = data.pages.map((page) => ({ id: page.id, title: page.title, url: page.url, context: page.kind === 'database' ? 'Database' : 'Page' }));
      return { entries: more ? Array.from(new Map([...(results.notion?.entries ?? []), ...entries].map((entry) => [entry.id, entry])).values()) : entries, hasMore: data.hasMore };
    }
    return client!.connectionEntries(provider as Exclude<ConnectionProvider, 'google' | 'jira' | 'notion'>);
  }

  async function run(provider: ConnectionProvider, action: 'connect' | 'refresh' | 'more') {
    if (!client || busy[provider]) return;
    if (provider === 'icloud' && action === 'connect') { setIcloudForm(true); return; }
    setBusy((current) => ({ ...current, [provider]: action }));
    setMessages((current) => ({ ...current, [provider]: '' }));
    try {
      if (action === 'connect') { if (provider !== 'icloud') await client.connectProvider(provider); return; }
      if (provider === 'google' || provider === 'outlook') return; // Both sync autonomously - no manual entries preview to review.
      const result = await fetchEntries(provider, action === 'more');
      setResults((current) => ({ ...current, [provider]: result }));
      if (!result.entries.length) setMessages((current) => ({ ...current, [provider]: 'Nothing to show right now. You’re up to date.' }));
    } catch (error) { setMessages((current) => ({ ...current, [provider]: error instanceof Error ? error.message : 'That didn’t work. Please try again.' })); }
    finally { setBusy((current) => ({ ...current, [provider]: undefined })); }
  }

  // The provider-level entries preview isn't per-account (it always reflects whichever
  // account the API treats as primary), but the button lives on this specific account's
  // row - so busy/message state is keyed by accountId even though the fetch itself isn't.
  async function refreshAccount(provider: ConnectionProvider, accountId: string) {
    if (!client || busy[accountId] || provider === 'google' || provider === 'outlook') return;
    setBusy((current) => ({ ...current, [accountId]: 'refresh' }));
    setMessages((current) => ({ ...current, [accountId]: '' }));
    try {
      const result = await fetchEntries(provider, false);
      setResults((current) => ({ ...current, [provider]: result }));
      if (!result.entries.length) setMessages((current) => ({ ...current, [accountId]: 'Nothing to show right now. You’re up to date.' }));
    } catch (error) { setMessages((current) => ({ ...current, [accountId]: error instanceof Error ? error.message : 'That didn’t work. Please try again.' })); }
    finally { setBusy((current) => ({ ...current, [accountId]: undefined })); }
  }

  // There's no way to scope an OAuth redirect to one specific existing account - if the
  // user picks the same account again in the provider's consent screen, the server updates
  // this row in place; a different account becomes a new one. Busy/message state is still
  // keyed per-account so only this row shows "Reconnecting…".
  async function reconnectAccount(provider: ConnectionProvider, accountId: string) {
    if (!client || busy[accountId]) return;
    if (provider === 'icloud') { setIcloudForm(true); return; }
    setBusy((current) => ({ ...current, [accountId]: 'connect' }));
    setMessages((current) => ({ ...current, [accountId]: '' }));
    try { await client.connectProvider(provider); }
    catch (error) {
      setMessages((current) => ({ ...current, [accountId]: error instanceof Error ? error.message : 'That didn’t work. Please try again.' }));
      setBusy((current) => ({ ...current, [accountId]: undefined }));
    }
  }

  async function disconnectAccount(provider: ConnectionProvider, accountId: string) {
    if (!client || busy[accountId]) return;
    setBusy((current) => ({ ...current, [accountId]: 'disconnect' }));
    setMessages((current) => ({ ...current, [accountId]: '' }));
    try {
      const result = await client.disconnectIntegration(accountId);
      setResults((current) => ({ ...current, [provider]: undefined }));
      if (provider === 'notion') setNotionCursor(null);
      setMessages((current) => ({ ...current, [accountId]: result.revocationWarning ?? 'Disconnected from ClearHead.' }));
    } catch (error) { setMessages((current) => ({ ...current, [accountId]: error instanceof Error ? error.message : 'That didn’t work. Please try again.' })); }
    finally { setBusy((current) => ({ ...current, [accountId]: undefined })); }
  }

  function startEditingAccount(account: ConnectionStatus) {
    setEditingAccountId(account.id);
    setEditLabel(account.customLabel ?? '');
    setEditIcon(account.customIcon ?? '');
  }
  function cancelEditingAccount() { setEditingAccountId(null); }
  async function saveAccountEdit(accountId: string) {
    if (!client || busy[accountId]) return;
    setBusy((current) => ({ ...current, [accountId]: 'edit' }));
    try {
      await client.updateIntegration(accountId, { customLabel: editLabel.trim() || null, customIcon: editIcon.trim() || null });
      setEditingAccountId(null);
    } catch (error) { setMessages((current) => ({ ...current, [accountId]: error instanceof Error ? error.message : 'Could not save your changes. Try again.' })); }
    finally { setBusy((current) => ({ ...current, [accountId]: undefined })); }
  }

  // Bulk sync only exists for calendar providers (Google/Outlook), since syncCalendarNow is
  // a per-account background job trigger; non-calendar providers have no per-account sync
  // concept (their preview reflects a single shared account), so they only get Reconnect all.
  async function syncAllAccounts(provider: ConnectionProvider, accountIds: string[]) {
    if (!client || busy[provider] || !accountIds.length) return;
    setBusy((current) => ({ ...current, [provider]: 'sync-all' }));
    setMessages((current) => ({ ...current, [provider]: '' }));
    try {
      const outcomes = await Promise.all(accountIds.map((id) => client.syncCalendarNow(id).then((result) => result.queued).catch(() => false)));
      const queuedIds = accountIds.filter((_, index) => outcomes[index]);
      onMarkSyncing(queuedIds);
      setMessages((current) => ({ ...current, [provider]: queuedIds.length ? '' : 'Could not start sync. Try again.' }));
    } finally { setBusy((current) => ({ ...current, [provider]: undefined })); }
  }

  async function syncAccountNow(accountId: string) {
    if (!client || busy[accountId]) return;
    setBusy((current) => ({ ...current, [accountId]: 'sync' }));
    setMessages((current) => ({ ...current, [accountId]: '' }));
    try {
      const result = await client.syncCalendarNow(accountId);
      if (result.queued) onMarkSyncing([accountId]);
      setMessages((current) => ({ ...current, [accountId]: result.queued ? '' : 'Could not start sync. Try again.' }));
    } catch (error) { setMessages((current) => ({ ...current, [accountId]: error instanceof Error ? error.message : 'That didn’t work. Please try again.' })); }
    finally { setBusy((current) => ({ ...current, [accountId]: undefined })); }
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
    <div className="connections-toolbar"><SegmentedTabs ariaLabel="Connection categories" value={filter} onChange={(next) => setFilter(next as typeof filter)} items={connectionFilters.map((value) => ({ value, label: value }))} /><span>{connectedCount} connected</span></div>
    {callbackMessage && <p className="connection-notice" role="status">{callbackMessage}</p>}
    {error ? <div className="connection-notice" role="alert">{error} <button className="outline-button" onClick={() => setAttempt((value) => value + 1)}>Retry</button></div> : !catalog ? <p className="connection-notice" role="status">Loading your connections…</p> : null}
    {(['Calendars', 'Tasks & workspaces', 'Messages'] as const).filter((group) => filter === 'All' || filter === group).map((group) => <section className="connection-group" key={group} aria-label={group}>
      <h2 className="connection-group-title">{group}<span>{group === 'Calendars' ? 'A little more room for what matters.' : group === 'Messages' ? 'Keep the words that matter.' : 'Your work, with a wider perspective.'}</span></h2>
      <div className="connections-grid">{providers.filter((provider) => provider.group === group).map((provider) => {
        const accounts = statuses.filter((status) => status.provider === connectionProviderId(provider.id));
        const configured = catalog?.find((item) => item.provider === connectionProviderId(provider.id))?.configured;
        const connected = accounts.length > 0; const pending = busy[provider.id]; const result = results[provider.id];
        const canSyncNow = provider.id === 'google' || provider.id === 'outlook';
        return <article className="integration-card" key={provider.id} aria-label={provider.name}>
          <div className="integration-head"><div className="integration-logo"><img src={`/assets/integrations/${provider.logo}.svg`} alt="" width="28" height="28" /></div><div className="integration-title"><h3>{provider.name}</h3><p>{provider.description}</p></div></div>
          <div className="integration-permissions-preview">
            <h4 className="integration-accounts-heading">Permissions requested</h4>
            <div className="integration-permissions">{provider.permissions.map((permission) => <span key={permission}>{permission}</span>)}</div>
          </div>
          {connected ? <div className="integration-accounts-block">
            <div className="integration-accounts-header">
              <h4 className="integration-accounts-heading">Connected accounts</h4>
              <div className="integration-accounts-bulk-actions">
                {canSyncNow && (() => { const syncingAny = accounts.some((account) => syncingAccounts[account.id]); return <button className={`outline-button connection-refresh icon-only ${syncingAny ? 'is-syncing' : ''}`} disabled={!client || Boolean(pending) || syncingAny} title="Sync all now" aria-label="Sync all now" onClick={() => void syncAllAccounts(provider.id, accounts.map((account) => account.id))}>{syncingAny ? <span className="sync-progress-dot" aria-hidden="true" /> : null}<UiIcon name="refresh" className={pending === 'sync-all' || syncingAny ? 'is-spinning' : ''} /></button>; })()}
                <button className="outline-button" disabled={!client || !configured || Boolean(pending)} onClick={() => void run(provider.id, 'connect')}>{pending === 'connect' ? 'Reconnecting…' : 'Reconnect all'}</button>
              </div>
            </div>
            <ul className="integration-accounts">{accounts.map((account) => {
              const identity = account.customLabel || account.accountLabel || account.email || account.siteName || account.workspaceName;
              const connectedLabel = relativeTime(account.connectedAt);
              const label = identity || (connectedLabel ? `Connected ${connectedLabel}` : 'Connected account');
              const syncing = Boolean(syncingAccounts[account.id]);
              const summary = accountSummary(account, syncing);
              const scopeLabels = (account.scopes ?? []).filter((scope) => scope !== 'openid').map(humanizeScope);
              const editing = editingAccountId === account.id;
              return <li key={account.id} className="integration-account">
                <div className="integration-account-identity">
                  <span className="integration-account-avatar">{account.customIcon ? <span className="account-badge account-badge-lg account-badge-emoji" aria-hidden="true">{account.customIcon}</span> : <AccountBadge accountLabel={label} size="lg" />}<ProviderBadge provider={connectionProviderId(provider.id)} /></span>
                  <div className="integration-account-meta">
                    <span className="integration-account-name-row"><strong>{label}</strong><button type="button" className="integration-account-edit" title="Name this calendar or give it an icon" aria-label="Edit name and icon" onClick={() => startEditingAccount(account)}><UiIcon name="edit" /></button></span>
                    {account.email && account.email !== label ? <small>{account.email}</small> : null}
                    {syncing && <small className="integration-account-syncing"><UiIcon name="refresh" className="is-spinning" />Syncing…</small>}
                    {summary ? <small>{summary}</small> : null}
                    {scopeLabels.length > 0 && <ul className="integration-account-scopes">{scopeLabels.map((scopeLabel) => <li key={scopeLabel}>{scopeLabel}</li>)}</ul>}
                  </div>
                </div>
                <div className="integration-account-actions">
                  <button className={`outline-button connection-refresh icon-only ${syncing ? 'is-syncing' : ''}`} disabled={Boolean(busy[account.id]) || syncing || (!canSyncNow && !catalog)} title={`Refresh ${provider.name}`} aria-label={`Refresh ${provider.name}`} onClick={() => void (canSyncNow ? syncAccountNow(account.id) : refreshAccount(provider.id, account.id))}>{syncing ? <span className="sync-progress-dot" aria-hidden="true" /> : null}<UiIcon name="refresh" className={busy[account.id] === 'sync' || busy[account.id] === 'refresh' || syncing ? 'is-spinning' : ''} /></button>
                  <button className="outline-button" disabled={Boolean(busy[account.id]) || !client || !configured} onClick={() => void reconnectAccount(provider.id, account.id)}>{busy[account.id] === 'connect' ? 'Reconnecting…' : 'Reconnect'}</button>
                  <button className="outline-button" disabled={Boolean(busy[account.id])} onClick={() => void disconnectAccount(provider.id, account.id)}>{busy[account.id] === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}</button>
                </div>
                {editing && <form className="integration-account-edit-form" onSubmit={(event) => { event.preventDefault(); void saveAccountEdit(account.id); }}>
                  <label htmlFor={`account-nickname-${account.id}`}>Nickname</label>
                  <input id={`account-nickname-${account.id}`} type="text" maxLength={60} placeholder={identity || 'e.g. Work calendar'} value={editLabel} onChange={(event) => setEditLabel(event.target.value)} />
                  <label htmlFor={`account-icon-${account.id}`}>Icon</label>
                  <input id={`account-icon-${account.id}`} type="text" maxLength={8} placeholder="e.g. 📅" value={editIcon} onChange={(event) => setEditIcon(event.target.value)} />
                  <div className="integration-account-edit-actions">
                    <button type="submit" className="outline-button" disabled={Boolean(busy[account.id])}>{busy[account.id] === 'edit' ? 'Saving…' : 'Save'}</button>
                    <button type="button" className="outline-button" disabled={Boolean(busy[account.id])} onClick={cancelEditingAccount}>Cancel</button>
                  </div>
                </form>}
                {messages[account.id] && <div className="availability-result integration-account-message" role="status">{messages[account.id]}</div>}
              </li>;
            })}</ul>
            <button type="button" className="integration-add-account" disabled={!client || !configured || Boolean(pending)} onClick={() => void run(provider.id, 'connect')}>
              <span aria-hidden="true">+</span><span>{pending === 'connect' ? 'Connecting…' : `Connect another ${provider.name} account`}</span>
            </button>
          </div>
            : <div className={`integration-status ${configured === false ? 'state-pending' : catalog ? 'state-neutral' : 'state-pending'}`}><i />{configured === false ? <UiIcon name="time" /> : <UiIcon name="cloud" />}{configured === false ? 'Coming soon' : catalog ? 'Not connected' : 'Checking connection…'}</div>}
          {configured === false && <p className="connection-setup-note">{provider.name} isn’t available yet — we’re still working on it.</p>}
          {!connected && <div className="integration-actions"><button className="capture-button" disabled={!client || !configured || Boolean(pending)} onClick={() => void run(provider.id, 'connect')}><span>{configured === false ? 'Coming soon' : pending === 'connect' ? 'Connecting…' : `Connect ${provider.name}`}</span>{configured !== false && <span aria-hidden="true">↗</span>}</button></div>}
          {provider.id === 'icloud' && icloudForm && <form className="icloud-connect-form" onSubmit={(event) => { event.preventDefault(); void connectIcloud(); }}>
            <label htmlFor="icloud-email">Apple Account email</label><input id="icloud-email" type="email" autoComplete="username" required value={appleId} onChange={(event) => setAppleId(event.target.value)} disabled={Boolean(pending)} />
            <label htmlFor="icloud-password">App-specific password</label><input id="icloud-password" type="password" autoComplete="new-password" required pattern="[A-Za-z]{4}(-[A-Za-z]{4}){3}" placeholder="xxxx-xxxx-xxxx-xxxx" value={appPassword} onChange={(event) => setAppPassword(event.target.value)} disabled={Boolean(pending)} aria-describedby="icloud-password-help" />
            <p id="icloud-password-help" className="connection-setup-note">Use an <a href="https://support.apple.com/en-us/102654" target="_blank" rel="noreferrer">Apple app-specific password</a>, not your main account password. ClearHead stores it encrypted to read your calendars.</p>
            <div className="integration-actions"><button type="submit" className="capture-button" disabled={Boolean(pending)}>{pending === 'connect' ? 'Connecting…' : 'Connect calendar'}</button><button type="button" className="outline-button" disabled={Boolean(pending)} onClick={() => { setIcloudForm(false); setAppPassword(''); setAppleId(''); }}>Cancel</button></div>
          </form>}
          {connected && provider.id !== 'google' && provider.id !== 'outlook' && <div className="integration-preview-toolbar">
            <span>Preview</span>
            <button className="outline-button connection-refresh icon-only" disabled={Boolean(pending) || !catalog} title={provider.refresh} aria-label={provider.refresh} onClick={() => void run(provider.id, 'refresh')}><UiIcon name="refresh" className={pending === 'refresh' ? 'is-spinning' : ''} /></button>
          </div>}
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
function relativeTime(iso?: string | null): string | null {
  if (!iso) return null;
  const then = Date.parse(iso); if (Number.isNaN(then)) return null;
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(then).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}
function accountSummary(account: ConnectionStatus, syncing: boolean): string {
  const connected = relativeTime(account.connectedAt);
  const synced = syncing ? null : relativeTime(account.lastSyncedAt);
  return [connected ? `Connected ${connected}` : null, synced ? `Synced ${synced}` : null].filter(Boolean).join(' · ');
}
