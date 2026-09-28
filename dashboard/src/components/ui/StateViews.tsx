import type { ReactNode } from 'react';

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="card flex items-center gap-2 muted">
      <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-accent" aria-hidden="true" />
      {label}
    </div>
  );
}

export function ErrorState({ title = "Couldn't load data", error, onRetry }: { title?: string; error?: Error; onRetry?: () => void }) {
  return (
    <div role="alert" className="card border-negative/40">
      <p className="font-semibold text-negative">{title}</p>
      {error && <p className="mt-1 text-sm muted">{error.message}</p>}
      {onRetry && (
        <button type="button" className="btn mt-3" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-border p-4 text-sm muted">{children}</p>;
}
