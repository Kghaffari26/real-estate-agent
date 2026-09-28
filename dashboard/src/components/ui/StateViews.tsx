import type { ReactNode } from 'react';
import { EmptyIllustration, ErrorIllustration } from './Illustrations';

export function ErrorState({ title = "Couldn't load data", error, onRetry }: { title?: string; error?: Error; onRetry?: () => void }) {
  return (
    <div role="alert" className="card card-pad flex flex-col items-center gap-3 py-10 text-center">
      <ErrorIllustration />
      <div>
        <p className="text-md font-semibold">{title}</p>
        {error && <p className="mt-1 max-w-md text-sm text-text-3">{error.message}</p>}
      </div>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children, compact = false }: { title?: string; children?: ReactNode; compact?: boolean }) {
  return (
    <div className={`well flex flex-col items-center gap-2 text-center ${compact ? 'px-4 py-5' : 'px-6 py-8'}`}>
      {!compact && <EmptyIllustration />}
      {title && <p className="text-sm font-semibold text-text">{title}</p>}
      {children && <div className="max-w-sm text-sm text-text-3">{children}</div>}
    </div>
  );
}
