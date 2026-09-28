import type { ThemePreference } from '../../lib/theme';
import { Select } from '../ui/Select';

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System theme' },
  { value: 'light', label: 'Light theme' },
  { value: 'dark', label: 'Dark theme' },
];

export function ThemeToggle({ value, onChange }: { value: ThemePreference; onChange: (value: ThemePreference) => void }) {
  return <Select label="Color theme" hideLabel value={value} options={OPTIONS} onChange={(v) => onChange(v as ThemePreference)} />;
}
