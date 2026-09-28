import { Link } from 'react-router-dom';
import { useIsDark } from '../../hooks/useMediaQuery';
import { inkOnSequential, sequentialToken } from '../../lib/scale';
import { color } from '../../lib/tokens';

export interface HeatCell {
  slug: string;
  name: string;
  score: number | null;
  label: string | null;
}

/** All metros as tiles ordered hottest → coolest, colored by the one-hue heat ramp. */
export function HeatGrid({ cells }: { cells: readonly HeatCell[] }) {
  const dark = useIsDark();
  return (
    <ol className="grid grid-cols-3 gap-1 sm:grid-cols-4 sm:gap-1.5 md:grid-cols-5 xl:grid-cols-10">
      {cells.map((c) => {
        const token = sequentialToken(c.score);
        const light = token ? inkOnSequential(token, dark) === 'light' : false;
        // Ink from tokens: in light theme dark ink = text, light ink = surface; in dark theme the reverse.
        const ink = !token ? 'text-text-2' : light === dark ? 'text-text' : dark ? 'text-bg' : 'text-surface';
        return (
          <li key={c.slug}>
            <Link
              to={`/metro/${c.slug}`}
              title={`${c.name}: ${c.score ?? '—'} (${c.label ?? 'no score'})`}
              className={`flex h-14 flex-col justify-between rounded-md px-2 py-1.5 no-underline ring-1 ring-inset ring-black/5 transition-transform duration-1 hover:-translate-y-px hover:shadow-2 ${ink} ${token ? '' : 'bg-surface-3'}`}
              // Tile color encodes the score: data-driven.
              style={token ? { background: color(token) } : undefined}
            >
              <span className="truncate text-2xs font-medium">{c.name.replace(/, [A-Z]{2}$/, '')}</span>
              <span className="num text-sm font-semibold leading-none">
                {c.score ?? '—'}
                <span className="sr-only"> out of 100, {c.label}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

/** Legend for the heat ramp (0 → 100). */
export function HeatLegend() {
  const steps = ['seq-1', 'seq-2', 'seq-3', 'seq-4', 'seq-5', 'seq-6'] as const;
  return (
    <div className="flex items-center gap-2 text-2xs text-text-3">
      <span>Cold</span>
      <span className="flex overflow-hidden rounded-sm" aria-hidden="true">
        {steps.map((s) => (
          <span key={s} className="h-2 w-5" style={{ background: color(s) }} />
        ))}
      </span>
      <span>Hot</span>
    </div>
  );
}
