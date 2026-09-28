import { temperatureBand, type TemperatureBand } from '../lib/metrics';

const BAND_CLASS: Record<TemperatureBand, string> = {
  hot: 'text-temp-hot',
  warm: 'text-temp-warm',
  balanced: 'text-temp-balanced',
  cool: 'text-temp-cool',
  cold: 'text-temp-cold',
  unknown: 'text-text-muted',
};

interface TemperatureGaugeProps {
  score: number | null | undefined;
  label: string | null | undefined;
  basis?: string | null;
  size?: 'sm' | 'md';
}

/** A 0–100 semicircle gauge (SPEC §5.3). The arc uses currentColor from the band token. */
export function TemperatureGauge({ score, label, basis, size = 'md' }: TemperatureGaugeProps) {
  const band = temperatureBand(label);
  const pct = typeof score === 'number' ? Math.min(Math.max(score, 0), 100) / 100 : 0;
  const r = 40;
  const circumference = Math.PI * r;
  const description =
    typeof score === 'number' ? `Market temperature ${score} out of 100, ${label ?? 'unlabeled'}` : 'Market temperature unavailable';
  const width = size === 'sm' ? 'w-28' : 'w-40';
  return (
    <figure className="flex flex-col items-center gap-1">
      <svg viewBox="0 0 100 58" className={`${width} ${BAND_CLASS[band]}`} role="img" aria-label={description}>
        <path d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke="rgb(var(--color-border))" strokeWidth="10" strokeLinecap="round" />
        <path
          d="M10 50 A40 40 0 0 1 90 50"
          fill="none"
          stroke="currentColor"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${circumference * pct} ${circumference}`}
        />
        <text x="50" y="48" textAnchor="middle" className="fill-text text-[18px] font-semibold">
          {typeof score === 'number' ? score : '—'}
        </text>
      </svg>
      <figcaption className="text-center">
        <span className={`font-semibold ${BAND_CLASS[band]}`}>{label ?? 'No score'}</span>
        {basis && <span className="block text-xs muted">{basis}</span>}
      </figcaption>
    </figure>
  );
}
