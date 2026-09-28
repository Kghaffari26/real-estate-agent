import type { ReactNode } from 'react';
import type { Tone } from './tones';

export type { Tone };

// Full class strings (not interpolated) so Tailwind's content scan keeps them.
const TONES: Record<Tone, string> = {
  neutral: 'border-border text-text-muted',
  accent: 'border-accent/40 text-accent',
  positive: 'border-positive/40 text-positive',
  negative: 'border-negative/40 text-negative',
  warning: 'border-warning/40 text-warning',
  info: 'border-info/40 text-info',
  'severity-info': 'border-severity-info/40 text-severity-info',
  'severity-notable': 'border-severity-notable/40 text-severity-notable',
  'severity-major': 'border-severity-major/40 text-severity-major',
  'temp-hot': 'border-temp-hot/40 text-temp-hot',
  'temp-warm': 'border-temp-warm/40 text-temp-warm',
  'temp-balanced': 'border-temp-balanced/40 text-temp-balanced',
  'temp-cool': 'border-temp-cool/40 text-temp-cool',
  'temp-cold': 'border-temp-cold/40 text-temp-cold',
};

export function Badge({ tone = 'neutral', title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return (
    <span className={`chip ${TONES[tone]}`} title={title}>
      {children}
    </span>
  );
}
