import type { ReactNode } from 'react';

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
