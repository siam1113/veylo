import type { CSSProperties } from 'react';

// Pairs with ProviderBadge to disambiguate which of a user's possibly-several connected
// accounts of that provider a synced/pushed item belongs to. Renders nothing when there's
// no label to show, so it's safe to always render next to ProviderBadge.
function initials(label: string): string {
  const atIndex = label.indexOf('@');
  const base = atIndex > 0 ? label.slice(0, atIndex) : label;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return label.slice(0, 2).toUpperCase();
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

// No real profile photo is ever fetched from a provider (no broad profile scopes, no
// binary photo proxying) - a deterministic color keeps the same account's initials circle
// visually consistent across reloads without needing to store anything extra.
function hue(label: string): number {
  let hash = 0;
  for (let index = 0; index < label.length; index++) hash = (hash * 31 + label.charCodeAt(index)) >>> 0;
  return hash % 360;
}

export function AccountBadge({ accountLabel, size = 'sm', className = '' }: { accountLabel?: string | null; size?: 'sm' | 'lg'; className?: string }) {
  if (!accountLabel) return null;
  const style = size === 'lg' ? ({ '--account-hue': hue(accountLabel) } as CSSProperties) : undefined;
  return <span className={`account-badge account-badge-${size} ${className}`} style={style} title={accountLabel}>{initials(accountLabel)}</span>;
}
