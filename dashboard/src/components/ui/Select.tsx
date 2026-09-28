import { ChevronDown } from 'lucide-react';
import { useId } from 'react';

interface SelectProps {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  hideLabel?: boolean;
  className?: string;
}

export function Select({ label, value, options, onChange, hideLabel, className = '' }: SelectProps) {
  const id = useId();
  return (
    <div className={`min-w-0 ${className}`}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'label'}>
        {label}
      </label>
      <div className="relative">
        <select id={id} className="input appearance-none pr-8" value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 top-2 h-4 w-4 text-text-3" />
      </div>
    </div>
  );
}
