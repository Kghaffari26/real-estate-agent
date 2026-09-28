import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumbs({ items }: { items: readonly Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-text-3" />}
              {last || !c.to ? (
                <span aria-current={last ? 'page' : undefined} className="truncate font-medium text-text">
                  {c.label}
                </span>
              ) : (
                <Link to={c.to} className="truncate text-text-3 no-underline hover:text-text">
                  {c.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
