interface Option<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  label: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** A labeled group of toggle buttons (aria-pressed), keyboard-accessible by default. */
export function SegmentedControl<T extends string>({ label, options, value, onChange }: SegmentedControlProps<T>) {
  return (
    <div role="group" aria-label={label} className="inline-flex overflow-hidden rounded-md border border-border">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`px-3 py-1 text-sm ${active ? 'bg-accent text-accent-contrast' : 'bg-surface text-text hover:bg-surface-muted'}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
