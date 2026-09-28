import { Columns3 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

export interface PickerGroup {
  label: string;
  options: readonly { id: string; label: string }[];
}

/** A popover of checkboxes choosing which table columns are shown. */
export function ColumnPicker({ groups, selected, onChange, onReset }: { groups: readonly PickerGroup[]; selected: readonly string[]; onChange: (ids: string[]) => void; onReset: () => void }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const toggle = (id: string, on: boolean) => onChange(on ? [...selected, id] : selected.filter((s) => s !== id));
  return (
    <div ref={root} className="relative">
      <button type="button" className="btn" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
        <Columns3 aria-hidden="true" className="h-3.5 w-3.5" />
        Columns <span className="num text-text-3">{selected.length}</span>
      </button>
      <div id={panelId} hidden={!open} role="group" aria-label="Visible columns" className="fixed inset-x-4 top-24 z-50 max-h-[60vh] overflow-auto rounded-lg border border-border bg-surface p-3 shadow-3 sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-1 sm:w-72">
        {groups.map((g) => (
          <fieldset key={g.label} className="mb-3 last:mb-0">
            <legend className="eyebrow mb-1.5">{g.label}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {g.options.map((o) => (
                <label key={o.id} className="inline-flex items-center gap-1.5 text-sm text-text-2">
                  <input type="checkbox" className="h-4 w-4 accent-accent" checked={selected.includes(o.id)} onChange={(e) => toggle(o.id, e.target.checked)} />
                  {o.label}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <button type="button" className="btn btn-ghost mt-2 w-full" onClick={onReset}>
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
