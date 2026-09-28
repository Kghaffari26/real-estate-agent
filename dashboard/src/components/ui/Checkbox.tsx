import { useId } from 'react';

/** A labeled switch-style checkbox (native input, so it's accessible by default). */
export function Checkbox({ label, checked, onChange, variant = 'switch' }: { label: string; checked: boolean; onChange: (checked: boolean) => void; variant?: 'switch' | 'box' }) {
  const id = useId();
  if (variant === 'box') {
    return (
      <div className="inline-flex items-center gap-2 text-sm">
        <input id={id} type="checkbox" className="h-4 w-4 rounded accent-accent" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <label htmlFor={id} className="text-text-2">
          {label}
        </label>
      </div>
    );
  }
  return (
    <div className="inline-flex h-8 items-center gap-2 text-sm">
      <input id={id} type="checkbox" role="switch" aria-checked={checked} className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id} className="flex cursor-pointer items-center gap-2 text-text-2 peer-focus-visible:[&>span:first-child]:outline peer-focus-visible:[&>span:first-child]:outline-2 peer-focus-visible:[&>span:first-child]:outline-offset-2 peer-focus-visible:[&>span:first-child]:outline-focus">
        <span className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-2 ${checked ? 'bg-accent' : 'bg-border-strong'}`} aria-hidden="true">
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow-1 transition-transform duration-2 ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
        </span>
        {label}
      </label>
    </div>
  );
}
