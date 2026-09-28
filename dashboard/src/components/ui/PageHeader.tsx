import type { ReactNode } from 'react';

export function PageHeader({ title, eyebrow, subtitle, actions, children }: { title: ReactNode; eyebrow?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-2">{eyebrow}</div>}
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-text-3">{subtitle}</div>}
        {children}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2" data-no-print>
          {actions}
        </div>
      )}
    </div>
  );
}
