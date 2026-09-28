import { Link } from 'react-router-dom';
import { EmptyState } from './ui/StateViews';

export interface MoverRow {
  slug: string;
  name: string;
  value: string;
}

export function MoversList({ title, rows }: { title: string; rows: readonly MoverRow[] }) {
  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <EmptyState>No metros.</EmptyState>
      ) : (
        <ol className="space-y-1 text-sm">
          {rows.map((row, i) => (
            <li key={row.slug} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate">
                <span className="muted tabular-nums">{i + 1}.</span> <Link to={`/metro/${row.slug}`}>{row.name}</Link>
              </span>
              <span className="tabular-nums">{row.value}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
