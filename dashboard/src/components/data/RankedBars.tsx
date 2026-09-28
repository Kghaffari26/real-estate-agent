import { Link } from 'react-router-dom';
import { color, type ColorToken } from '../../lib/tokens';
import { EmptyState } from '../ui/StateViews';

export interface RankedRow {
  slug: string;
  name: string;
  value: number | null;
  text: string;
}

/**
 * A ranked horizontal bar list. Bars share one hue (they're one series: the title
 * names the measure); length is |value| relative to the list's largest.
 */
export function RankedBars({ title, rows, tone = 'cat-1' }: { title: string; rows: readonly RankedRow[]; tone?: ColorToken }) {
  const max = Math.max(...rows.map((r) => Math.abs(r.value ?? 0)), 0) || 1;
  return (
    <div className="min-w-0">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <EmptyState compact>No metros.</EmptyState>
      ) : (
        <ol className="space-y-2.5">
          {rows.map((r, i) => (
            <li key={r.slug}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="num w-4 shrink-0 text-xs text-text-3">{i + 1}</span>
                  <Link to={`/metro/${r.slug}`} className="truncate text-text no-underline hover:underline">
                    {r.name}
                  </Link>
                </span>
                <span className="num shrink-0 font-medium">{r.text}</span>
              </div>
              <div className="ml-6 mt-1 h-1.5 rounded-full bg-surface-3" aria-hidden="true">
                <div className="h-full rounded-full" style={{ width: `${(Math.abs(r.value ?? 0) / max) * 100}%`, background: color(tone) }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
