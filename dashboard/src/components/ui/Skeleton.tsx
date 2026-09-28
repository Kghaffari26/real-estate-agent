export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

/** Page-shaped placeholder: a title, a KPI row and two panels. */
export function PageSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" aria-label={label} className="space-y-6">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 lg:col-span-2" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}

export function ChartSkeleton({ height = 280 }: { height?: number }) {
  // Inline height: data-driven geometry, not styling.
  return <div className="skeleton w-full" style={{ height }} aria-hidden="true" />;
}
