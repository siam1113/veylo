import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Modal } from './Modal';
import { UiIcon } from './UiIcon';
import type { SyncIntention } from '../lib/sync.client';

export type PaletteDestination = 'space' | 'explore' | 'align' | 'time' | 'suggestions' | 'connections';

type Command = { id: string; keys: string[]; label: string; hint: string; glyph: string; view: PaletteDestination; filter?: string };

const kindOrder = ['goal', 'action', 'idea', 'commitment', 'question', 'meeting', 'note'] as const;

export function CommandPalette({ items, kindNames, kindGlyphs, onOpenItem, onNavigate, onClose }: {
  items: SyncIntention[];
  kindNames: Record<string, string>;
  kindGlyphs: Record<string, string>;
  onOpenItem: (id: string) => void;
  onNavigate: (view: PaletteDestination, filter?: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setActiveIndex(0); }, [query]);

  const commands: Command[] = [
    { id: 'intentions', keys: ['intentions', 'all', 'thoughts'], label: 'All intentions', hint: 'Everything you’ve captured', glyph: '✳', view: 'explore' },
    ...kindOrder.map((kind): Command => ({
      id: kind, keys: [`${kind}s`, kind], label: `${kindNames[kind] ?? kind}s`,
      hint: `Intentions marked as ${(kindNames[kind] ?? kind).toLowerCase()}`, glyph: kindGlyphs[kind] ?? '✳', view: 'explore', filter: kind,
    })),
    { id: 'archived', keys: ['archived', 'archive'], label: 'Archived', hint: 'Thoughts you’ve put away', glyph: '◻', view: 'explore', filter: 'archived' },
    { id: 'align', keys: ['align'], label: 'Align', hint: 'Your reasons, directions, and values', glyph: '◎', view: 'align' },
    { id: 'time', keys: ['time', 'schedule', 'calendar'], label: 'Time', hint: 'See what’s planned', glyph: '◷', view: 'time' },
    { id: 'suggestions', keys: ['suggestions', 'nudges'], label: 'Suggestions', hint: 'Quiet nudges based on your space', glyph: '✧', view: 'suggestions' },
    { id: 'connections', keys: ['connections', 'integrations'], label: 'Connections', hint: 'Calendar, Slack, and more', glyph: '↔', view: 'connections' },
    { id: 'space', keys: ['space', 'home'], label: 'Space', hint: 'Back to your home view', glyph: '⌂', view: 'space' },
  ];

  const trimmed = query.trim();
  const isEmpty = trimmed === '';
  const isCommand = trimmed.startsWith('/');

  let mode: 'commands' | 'items' = 'items';
  let matchedCommands: Command[] = [];
  let itemResults: SyncIntention[] = [];
  let textQuery = '';
  let scopedCommand: Command | null = null;
  let token = '';

  if (isEmpty) {
    mode = 'commands'; matchedCommands = commands;
  } else if (isCommand) {
    const slashBody = trimmed.slice(1);
    const splitIndex = slashBody.search(/\s/);
    token = (splitIndex === -1 ? slashBody : slashBody.slice(0, splitIndex)).toLowerCase();
    const rest = splitIndex === -1 ? '' : slashBody.slice(splitIndex + 1).trim();
    const candidates = commands.filter((command) => token === '' || command.keys.some((key) => key.startsWith(token)));
    scopedCommand = candidates.length === 1 ? candidates[0]! : null;
    if (scopedCommand && rest) { mode = 'items'; textQuery = rest; } else { mode = 'commands'; matchedCommands = candidates; }
  } else {
    mode = 'items'; textQuery = trimmed;
  }

  if (mode === 'items') {
    const scopedKind = scopedCommand?.filter;
    itemResults = items
      .filter((item) => item.status !== 'archived')
      .filter((item) => !scopedKind || item.kind === scopedKind)
      .filter((item) => !textQuery || `${item.title} ${item.rawCapture} ${item.purpose ?? ''}`.toLowerCase().includes(textQuery.toLowerCase()))
      .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt))
      .slice(0, 8);
  }

  const resultCount = mode === 'commands' ? matchedCommands.length : itemResults.length;

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => (resultCount ? (index + 1) % resultCount : 0)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => (resultCount ? (index - 1 + resultCount) % resultCount : 0)); }
    else if (event.key === 'Enter') {
      event.preventDefault();
      if (mode === 'commands') { const command = matchedCommands[activeIndex]; if (command) onNavigate(command.view, command.filter); }
      else { const item = itemResults[activeIndex]; if (item) onOpenItem(item.id); }
    }
  }

  return (
    <Modal label="Search ClearHead" onClose={onClose} className="command-palette">
      <div className="command-palette-field">
        <UiIcon name="search" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search your thoughts, or type / for commands…"
          aria-label="Search your thoughts, or type / for commands"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="command-palette-results" role="listbox">
        {mode === 'commands' && matchedCommands.map((command, index) => (
          <button type="button" key={command.id} role="option" aria-selected={index === activeIndex}
            className={`command-palette-row ${index === activeIndex ? 'active' : ''}`}
            onMouseEnter={() => setActiveIndex(index)} onClick={() => onNavigate(command.view, command.filter)}>
            <span className="command-palette-glyph">{command.glyph}</span>
            <span className="command-palette-copy"><b>{command.label}</b><small>/{command.keys[0]} · {command.hint}</small></span>
          </button>
        ))}
        {mode === 'commands' && !matchedCommands.length && <p className="command-palette-empty">No commands match “/{token}”.</p>}
        {mode === 'items' && itemResults.map((item, index) => (
          <button type="button" key={item.id} role="option" aria-selected={index === activeIndex}
            className={`command-palette-row ${index === activeIndex ? 'active' : ''}`}
            onMouseEnter={() => setActiveIndex(index)} onClick={() => onOpenItem(item.id)}>
            <span className="command-palette-glyph">{kindGlyphs[item.kind] ?? '✳'}</span>
            <span className="command-palette-copy"><b>{item.title}</b><small>{kindNames[item.kind] ?? 'Thought'} · {item.rawCapture}</small></span>
          </button>
        ))}
        {mode === 'items' && !itemResults.length && <p className="command-palette-empty">{textQuery ? 'Nothing matches that yet.' : 'Nothing here yet.'}</p>}
      </div>
      <div className="command-palette-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>↵</kbd> select</span>
        <span><kbd>/</kbd> commands</span>
        <span><kbd>esc</kbd> close</span>
      </div>
    </Modal>
  );
}
