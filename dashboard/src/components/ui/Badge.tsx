import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'accent' | 'outline';

const TONES: Record<BadgeTone, string> = {
  neutral: 'border-transparent bg-surface-3 text-text-2',
  accent: 'border-transparent bg-accent-soft text-accent',
  outline: 'border-border bg-surface text-text-2',
};

export function Badge({ tone = 'neutral', title, children, className = '' }: { tone?: BadgeTone; title?: string; children: ReactNode; className?: string }) {
  return (
    <span className={`chip ${TONES[tone]} ${className}`} title={title}>
      {children}
    </span>
  );
}
