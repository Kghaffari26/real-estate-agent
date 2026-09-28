import { Link } from 'react-router-dom';
import { formatDate, formatMonth } from '../../lib/format';

interface FreshnessChipProps {
  dataThrough: string | null;
  ratesAsOf: string | null;
  /** The agent flagged the market data as older than its usual lag. */
  stale: boolean;
  sample: boolean;
}

/** "Redfin through May 2026 · Rates Sep 24" — links to the run details. */
export function FreshnessChip({ dataThrough, ratesAsOf, stale, sample }: FreshnessChipProps) {
  const rates = ratesAsOf ? formatDate(ratesAsOf).replace(/, \d{4}$/, '') : null;
  const title = [
    stale ? "Redfin hasn't published newer months yet" : 'Latest data',
    sample ? 'Showing the committed sample snapshot (a real agent run)' : null,
  ]
    .filter(Boolean)
    .join('. ');
  return (
    <Link
      to="/about?section=run"
      title={title}
      className={`chip h-7 gap-1.5 border-border bg-surface px-2.5 text-text-2 no-underline shadow-1 hover:bg-surface-3 ${stale ? 'border-warning/50' : ''}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${stale ? 'bg-warning' : 'bg-good'}`} aria-hidden="true" />
      <span className="num">
        <span className="hidden sm:inline">Redfin through </span>
        {formatMonth(dataThrough)}
        {rates && <span className="hidden md:inline"> · Rates {rates}</span>}
      </span>
      {stale && <span className="sr-only">(older than usual)</span>}
      {sample && <span className="rounded bg-accent-soft px-1 text-2xs font-semibold text-accent">Sample</span>}
    </Link>
  );
}
