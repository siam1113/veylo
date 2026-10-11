import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { UiIcon } from './UiIcon';

export const accountTabs = ['profile', 'personalization', 'preferences', 'sync-backup'] as const;
export type AccountTab = typeof accountTabs[number];
const labels: Record<AccountTab, string> = { profile: 'Profile', personalization: 'Personalization', preferences: 'Preferences', 'sync-backup': 'Sync & backup' };

export function parseAccountTab(value: string | null): AccountTab | null {
  return accountTabs.find((tab) => tab === value) ?? null;
}

export function AccountSettingsPage({ activeTab, onTabChange, profile, personalization, preferences, syncBackup }: {
  activeTab: AccountTab;
  onTabChange(tab: AccountTab): void;
  profile: ReactNode;
  personalization: ReactNode;
  preferences: ReactNode;
  syncBackup: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const tabList = useRef<HTMLDivElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const panels = { profile, personalization, preferences, 'sync-backup': syncBackup };

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % accountTabs.length;
    else if (event.key === 'ArrowLeft') next = (index + accountTabs.length - 1) % accountTabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = accountTabs.length - 1;
    else return;
    event.preventDefault();
    onTabChange(accountTabs[next]);
    tabList.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  return <section className="account-settings-page" aria-labelledby="account-settings-heading">
    <header className="account-settings-heading"><h1 ref={heading} id="account-settings-heading" tabIndex={-1}>Settings</h1><p>Your account, your preferences, your space.</p></header>
    <div ref={tabList} className="account-settings-tabs" role="tablist" aria-label="Account settings">
      {accountTabs.map((tab, index) => <button type="button" key={tab} id={`account-tab-${tab}`} role="tab" aria-selected={activeTab === tab} aria-controls={`account-panel-${tab}`} tabIndex={activeTab === tab ? 0 : -1} onClick={() => onTabChange(tab)} onKeyDown={(event) => navigateTabs(event, index)}><UiIcon name={tab} />{labels[tab]}</button>)}
    </div>
    {accountTabs.map((tab) => <div key={tab} className="account-tab-panel" id={`account-panel-${tab}`} role="tabpanel" aria-labelledby={`account-tab-${tab}`} hidden={activeTab !== tab} tabIndex={0}>{panels[tab]}</div>)}
  </section>;
}
