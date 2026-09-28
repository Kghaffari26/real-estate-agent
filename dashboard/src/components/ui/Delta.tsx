import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { formatDelta, type Scale } from '../../lib/format';
import { sentiment } from '../../lib/metrics';

interface DeltaProps {
  value: number | null | undefined;
  format: string;
  scale?: Scale;
  goodDirection?: string;
  suffix?: string;
  size?: 'sm' | 'xs';
}

/**
 * A signed change with a direction icon. Status color only when the metric has a
 * good direction (e.g. homes sold); neutral metrics stay in text ink.
 */
export function Delta({ value, format, scale, goodDirection, suffix, size = 'sm' }: DeltaProps) {
  const text = formatDelta(value, format, { scale });
  const s = sentiment(goodDirection, value);
  const tone = s === 1 ? 'text-good-text' : s === -1 ? 'text-bad-text' : 'text-text-2';
  const Icon = value === null || value === undefined || value === 0 ? ArrowRight : value > 0 ? ArrowUpRight : ArrowDownRight;
  const hasValue = typeof value === 'number' && Number.isFinite(value);
  return (
    <span className={`num inline-flex items-center gap-0.5 whitespace-nowrap ${size === 'xs' ? 'text-xs' : 'text-sm'} ${hasValue ? tone : 'text-text-3'}`}>
      {hasValue && <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
      <span className="font-medium">{text}</span>
      {suffix && <span className="ml-1 font-normal text-text-3">{suffix}</span>}
    </span>
  );
}
