import type { ReactNode } from 'react';
import type { Scale } from '../../lib/format';
import type { ColorToken } from '../../lib/tokens';
import { AnimatedNumber } from '../charts/AnimatedNumber';
import { Sparkline } from '../charts/Sparkline';
import { Delta } from '../ui/Delta';

export interface KpiDelta {
  value: number | null | undefined;
  format: string;
  label: string;
}

export interface KpiCardProps {
  label: string;
  value: number | null | undefined;
  formatValue: (v: number | null | undefined) => string;
  deltas?: readonly KpiDelta[];
  scale?: Scale;
  goodDirection?: string;
  spark?: readonly (number | null)[];
  sparkTone?: ColorToken;
  badges?: ReactNode;
  note?: string | null;
  /** Visually linked to a hovered citation chip. */
  highlighted?: boolean;
  metricKey?: string;
  size?: 'md' | 'lg';
}

/** A headline number with its changes and a 3-year sparkline. Presentational. */
export function KpiCard({ label, value, formatValue, deltas = [], scale, goodDirection, spark, sparkTone = 'cat-1', badges, note, highlighted, metricKey, size = 'md' }: KpiCardProps) {
  return (
    <div
      data-metric={metricKey}
      className={`card flex min-w-0 flex-col gap-2 p-3 sm:p-4 transition-shadow duration-2 ${highlighted ? 'shadow-2 ring-2 ring-accent' : ''}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <p className="text-xs font-medium text-text-3">{label}</p>
        {badges && <div className="flex flex-wrap justify-end gap-1">{badges}</div>}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
        <p className={`font-semibold leading-none tracking-tight text-text ${size === 'lg' ? 'text-2xl' : 'text-lg sm:text-xl'}`}>
          <AnimatedNumber value={value} format={formatValue} />
        </p>
        {spark && <Sparkline values={spark} tone={sparkTone} className="h-6 w-full shrink-0 sm:h-8 sm:w-24" />}
      </div>
      {deltas.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          {deltas.map((d) => (
            <li key={d.label}>
              <Delta value={d.value} format={d.format} scale={scale} goodDirection={goodDirection} suffix={d.label} size="xs" />
            </li>
          ))}
        </ul>
      )}
      {note && <p className="text-2xs text-text-3">{note}</p>}
    </div>
  );
}
