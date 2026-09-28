import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { matchMetros, type SearchItem } from '../../lib/search';

export type { SearchItem };

interface MetroSearchProps {
  items: readonly SearchItem[];
  onSelect: (slug: string) => void;
  label?: string;
  placeholder?: string;
  /** Slugs to leave out (e.g. metros already being compared). */
  exclude?: readonly string[];
  maxResults?: number;
}

/** ARIA 1.2 combobox with a listbox popup: type, ↑/↓ to move, Enter to open, Esc to close. */
export function MetroSearch({ items, onSelect, label = 'Find a metro', placeholder = 'Search metros…', exclude, maxResults }: MetroSearchProps) {
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const results = useMemo(() => matchMetros(items, query, exclude, maxResults), [items, query, exclude, maxResults]);
  const expanded = open && query.trim().length > 0;

  const choose = (item: SearchItem | undefined) => {
    if (!item) return;
    onSelect(item.slug);
    setQuery('');
    setOpen(false);
    setActive(0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (results.length ? (a + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (results.length ? (a - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      if (expanded && results.length) {
        e.preventDefault();
        choose(results[active]);
      }
    } else if (e.key === 'Escape') {
      if (expanded) e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="relative w-full min-w-0">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && results.length ? `${id}-opt-${active}` : undefined}
        autoComplete="off"
        className="input"
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
        onFocus={() => setOpen(true)}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label={`${label} results`}
        hidden={!expanded}
        className="absolute left-0 right-0 z-[1100] mt-1 max-h-72 overflow-auto rounded-md border border-border bg-surface py-1 shadow-card"
      >
        {results.length === 0 ? (
          <li role="option" aria-selected={false} aria-disabled="true" className="px-3 py-1.5 text-sm muted">
            No matching metros
          </li>
        ) : (
          results.map((item, i) => (
            <li
              key={item.slug}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className={`cursor-pointer px-3 py-1.5 text-sm ${i === active ? 'bg-accent text-accent-contrast' : 'text-text'}`}
              // mousedown (not click) so the input's blur doesn't close the list first
              onMouseDown={(e) => {
                e.preventDefault();
                choose(item);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {item.name}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
