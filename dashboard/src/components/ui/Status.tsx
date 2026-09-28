import { AlertOctagon, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { ReactNode } from 'react';

/** Status colors are reserved for state and always ship with an icon + label. */
export type Status = 'good' | 'warning' | 'bad' | 'info';

const STYLE: Record<Status, { cls: string; Icon: typeof Info }> = {
  good: { cls: 'border-good/30 bg-good/10 text-good-text', Icon: CheckCircle2 },
  warning: { cls: 'border-warning/40 bg-warning/10 text-warning-text', Icon: AlertTriangle },
  bad: { cls: 'border-bad/30 bg-bad/10 text-bad-text', Icon: AlertOctagon },
  info: { cls: 'border-border bg-surface-2 text-text-2', Icon: Info },
};

export function StatusBadge({ status, children, title }: { status: Status; children: ReactNode; title?: string }) {
  const { cls, Icon } = STYLE[status];
  return (
    <span className={`chip ${cls}`} title={title}>
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      {children}
    </span>
  );
}

export function StatusIcon({ status, className = 'h-4 w-4' }: { status: Status; className?: string }) {
  const { Icon, cls } = STYLE[status];
  return <Icon aria-hidden="true" className={`${className} ${cls.split(' ').find((c) => c.startsWith('text-'))}`} />;
}
