import { CornerDownLeft, MapPin, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { paletteResults, type PaletteItem } from '../../lib/palette';
import type { SearchItem } from '../../lib/search';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  metros: readonly SearchItem[];
  onNavigate: (to: string) => void;
}

/** ⌘K / Ctrl+K: jump to any metro or page. A modal dialog with an ARIA combobox. */
export function CommandPalette({ open, onClose, metros, onNavigate }: CommandPaletteProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const results = useMemo(() => paletteResults(query, metros), [query, metros]);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    setQuery('');
    setActive(0);
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => restoreRef.current?.focus?.();
  }, [open]);

  if (!open) return null;

  const choose = (item: PaletteItem | undefined) => {
    if (!item) return;
    onClose();
    onNavigate(item.to);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (results.length ? (a + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (results.length ? (a - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Tab') {
      e.preventDefault(); // focus stays in the dialog
    }
  };

  let lastGroup = '';
  return createPortal(
    <div className="fixed inset-0 z-[2500] flex items-start justify-center bg-text/30 px-4 pt-[12vh] backdrop-blur-[2px]" onMouseDown={onClose} data-no-print>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-lg overflow-hidden rounded-lg border border-border bg-surface shadow-3"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search aria-hidden="true" className="h-4 w-4 text-text-3" />
          <label htmlFor={id} className="sr-only">
            Search metros and pages
          </label>
          <input
            ref={inputRef}
            id={id}
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={results.length ? `${id}-opt-${active}` : undefined}
            autoComplete="off"
            className="h-12 flex-1 bg-transparent text-md text-text outline-none placeholder:text-text-3"
            placeholder="Search metros, pages…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <ul id={`${id}-list`} role="listbox" aria-label="Results" className="max-h-80 overflow-auto p-1.5">
          {results.length === 0 && (
            <li role="option" aria-selected={false} aria-disabled="true" className="px-3 py-6 text-center text-sm text-text-3">
              No results for “{query}”
            </li>
          )}
          {results.map((item, i) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <li key={item.id} role="presentation">
                {header && <div className="eyebrow px-2.5 pb-1 pt-2" aria-hidden="true">{header}</div>}
                <div
                  id={`${id}-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(item);
                  }}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm ${i === active ? 'bg-accent-soft text-text' : 'text-text-2'}`}
                >
                  {item.group !== 'Go to' ? <MapPin aria-hidden="true" className="h-4 w-4 text-text-3" /> : <CornerDownLeft aria-hidden="true" className="h-4 w-4 text-text-3" />}
                  <span className="flex-1 truncate">{item.label}</span>
                  {i === active && <CornerDownLeft aria-hidden="true" className="h-3.5 w-3.5 text-text-3" />}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
