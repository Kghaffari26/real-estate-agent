import { formatDelta, type Scale } from '../../lib/format';
import { sentiment } from '../../lib/metrics';

interface DeltaProps {
  value: number | null | undefined;
  format: string;
  scale?: Scale;
  goodDirection?: string;
  /** Visible suffix, e.g. "YoY". */
  suffix?: string;
}

const SENTIMENT_CLASS = { 1: 'text-positive', 0: 'text-text-muted', [-1]: 'text-negative' } as const;

/** A signed change. Color only encodes good/bad when the metric has a good direction. */
export function Delta({ value, format, scale, goodDirection, suffix }: DeltaProps) {
  const text = formatDelta(value, format, { scale });
  const tone = SENTIMENT_CLASS[sentiment(goodDirection, value)];
  const arrow = value === null || value === undefined || value === 0 ? '' : value > 0 ? '▲' : '▼';
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-sm ${tone}`}>
      {arrow && <span aria-hidden="true">{arrow}</span>}
      <span>{text}</span>
      {suffix && <span className="muted">{suffix}</span>}
    </span>
  );
}
