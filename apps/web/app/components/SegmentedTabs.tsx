import { useId, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useReducedMotionPref } from '../lib/motion-prefs.client';

export type SegmentedTabItem = {
  value: string;
  label?: string;
  ariaLabel?: string;
  icon?: ReactNode;
  count?: number;
  disabled?: boolean;
};

/** Shared pill-style tab control with a magnetic sliding highlight (framer-motion
 * `layoutId`) behind the active item. Used for the category/period/layout switches
 * across Explore, Align, and Time so they read as one consistent tab system. */
export function SegmentedTabs({ items, value, onChange, ariaLabel, size = 'md', iconOnly = false }: {
  items: SegmentedTabItem[]; value: string; onChange: (value: string) => void; ariaLabel: string; size?: 'sm' | 'md'; iconOnly?: boolean;
}) {
  const groupId = useId();
  const reduceMotion = useReducedMotionPref();
  return <div className={`segmented-tabs segmented-tabs-${size} ${iconOnly ? 'icon-only' : ''}`} role="group" aria-label={ariaLabel}>
    {items.map((item) => {
      const active = item.value === value;
      return <button key={item.value} type="button" className={`segmented-tab ${active ? 'active' : ''} ${item.disabled ? 'disabled' : ''}`} aria-pressed={active}
        disabled={item.disabled} aria-disabled={item.disabled}
        title={item.ariaLabel ?? item.label} aria-label={iconOnly ? (item.ariaLabel ?? item.label) : undefined}
        onClick={() => { if (!item.disabled) onChange(item.value); }}>
        {active && <motion.span className="segmented-thumb" layoutId={`segmented-thumb-${groupId}`} transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 38, mass: 0.7 }} />}
        <span className="segmented-tab-content">
          {item.icon}
          {!iconOnly && item.label ? <span>{item.label}</span> : null}
          {item.count !== undefined ? <span className="segmented-count">{item.count}</span> : null}
        </span>
      </button>;
    })}
  </div>;
}
