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

/** A labeled group of toggle buttons (aria-pressed). */
export function SegmentedControl<T extends string>({ label, options, value, onChange }: SegmentedControlProps<T>) {
  return (
    <div role="group" aria-label={label} className="inline-flex h-8 items-center rounded-md bg-surface-3 p-0.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`h-7 rounded-[5px] px-2.5 text-xs font-medium transition-colors duration-1 ${active ? 'bg-surface text-text shadow-1' : 'text-text-2 hover:text-text'}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
