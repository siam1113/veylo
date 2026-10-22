import type { ComponentType } from 'react';
import { Sparkle, FileText, History, Plus, CheckCircle2, HelpCircle, MessageSquareText, Layers, type LucideProps } from 'lucide-react';

export type ThoughtIconName = 'polished' | 'original' | 'timeline' | 'added' | 'synced' | 'asked' | 'clarified' | 'version';

const icons = {
  polished: Sparkle,
  original: FileText,
  timeline: History,
  added: Plus,
  synced: CheckCircle2,
  asked: HelpCircle,
  clarified: MessageSquareText,
  version: Layers,
} satisfies Record<ThoughtIconName, ComponentType<LucideProps>>;

export function ThoughtIcon({ name }: { name: ThoughtIconName }) {
  const Icon = icons[name] as ComponentType<any>;
  return <Icon className="thought-icon" strokeWidth={1.6} aria-hidden="true" focusable="false" />;
}
