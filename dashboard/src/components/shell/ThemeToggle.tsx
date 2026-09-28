import { Monitor, Moon, Sun } from 'lucide-react';
import type { ThemePreference } from '../../lib/theme';

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light theme', Icon: Sun },
  { value: 'dark', label: 'Dark theme', Icon: Moon },
  { value: 'system', label: 'System theme', Icon: Monitor },
];

export function ThemeToggle({ value, onChange }: { value: ThemePreference; onChange: (value: ThemePreference) => void }) {
  return (
    <div role="group" aria-label="Color theme" className="inline-flex h-8 items-center rounded-md bg-surface-3 p-0.5">
      {OPTIONS.map(({ value: v, label, Icon }) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          aria-label={label}
          title={label}
          onClick={() => onChange(v)}
          className={`inline-flex h-7 w-7 items-center justify-center rounded-[5px] transition-colors duration-1 ${value === v ? 'bg-surface text-text shadow-1' : 'text-text-3 hover:text-text'}`}
        >
          <Icon aria-hidden="true" className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}
