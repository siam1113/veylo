import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

export type AccountAction = 'preferences' | 'profile' | 'personalization' | 'sync-backup' | 'sign-out';

const entries: Array<{ action: AccountAction; label: string; path: string }> = [
  { action: 'preferences', label: 'Preferences', path: 'M4 7h16M4 17h16M8 4v6m8 4v6' },
  { action: 'profile', label: 'Profile', path: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2' },
  { action: 'personalization', label: 'Personalization', path: 'm14 4 6 6M4 20l4-1L21 6a2.8 2.8 0 0 0-4-4L4 15l-1 6 5-2' },
  { action: 'sync-backup', label: 'Sync & backup', path: 'M20 7v5h-5M4 17v-5h5M5.6 9a7 7 0 0 1 11.8-2L20 12M4 12l2.6 5a7 7 0 0 0 11.8-2' },
  { action: 'sign-out', label: 'Sign out', path: 'M9 4H4v16h5m5-12 4 4-4 4m-6-4h12' },
];

export function AccountMenu({ name, email, onSelect }: { name: string; email: string; onSelect(action: AccountAction): void }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const initialFocus = useRef(0);
  const menuId = useId();
  const buttons = () => Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);

  useEffect(() => {
    if (!open) return;
    buttons()[initialFocus.current]?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    const items = buttons();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    } else if (event.key === 'Tab') {
      // Restore the trigger before the browser advances to the next tab stop.
      trigger.current?.focus(); setOpen(false);
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const next = [...items.slice(index + 1), ...items.slice(0, index + 1)].find((item) => item.textContent?.toLowerCase().startsWith(event.key.toLowerCase()));
      if (next) { event.preventDefault(); next.focus(); }
    }
  }

  return <div ref={container} className="account-menu-container" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    {open && <div ref={menu} id={menuId} className="account-menu" role="menu" aria-label="Account" onKeyDown={handleKeys}>
      {entries.map(({ action, label, path }) => <button key={action} type="button" role="menuitem" tabIndex={-1} className={action === 'sign-out' ? 'account-sign-out' : undefined} onClick={() => {
        setOpen(false); trigger.current?.focus(); onSelect(action);
      }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg><span>{label}</span></button>)}
    </div>}
    <button ref={trigger} className="profile-button" type="button" aria-label="Account menu" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => { initialFocus.current = 0; setOpen((value) => !value); }} onKeyDown={(event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault(); initialFocus.current = event.key === 'ArrowUp' ? entries.length - 1 : 0; setOpen(true);
    }}><span className="avatar" aria-hidden="true">{(name || email || 'V')[0].toUpperCase()}</span><span className="profile-copy"><b>{name || 'Your space'}</b><small>Private by default</small></span><span className="more" aria-hidden="true">···</span></button>
  </div>;
}
