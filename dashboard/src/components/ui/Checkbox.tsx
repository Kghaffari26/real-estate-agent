import { useId } from 'react';

export function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const id = useId();
  return (
    <div className="inline-flex items-center gap-2 text-sm">
      <input id={id} type="checkbox" className="h-4 w-4 accent-accent" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}
