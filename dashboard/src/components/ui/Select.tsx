import { useId } from 'react';

interface SelectProps {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  /** Hide the label visually (still read by screen readers). */
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
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
