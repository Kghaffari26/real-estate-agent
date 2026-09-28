import { m } from 'framer-motion';
import { temperatureBand, type TemperatureBand } from '../../lib/metrics';
import { sequentialToken } from '../../lib/scale';
import { color } from '../../lib/tokens';

const BAND_TEXT: Record<TemperatureBand, string> = {
  hot: 'Hot', warm: 'Warm', balanced: 'Balanced', cool: 'Cool', cold: 'Cold', unknown: 'No score',
};

interface Props {
  score: number | null | undefined;
  label: string | null | undefined;
  basis?: string | null;
  size?: 'sm' | 'md';
}

/** 0–100 arc gauge; the arc draws in on mount and is colored from the heat ramp. */
export function TemperatureGauge({ score, label, basis, size = 'md' }: Props) {
  const has = typeof score === 'number' && Number.isFinite(score);
  const pct = has ? Math.min(Math.max(score, 0), 100) / 100 : 0;
  const tone = sequentialToken(has ? score : null) ?? 'text-3';
  const description = has ? `Market temperature ${score} out of 100, ${label ?? 'unlabeled'}` : 'Market temperature unavailable';
  const band = temperatureBand(label);
  const w = size === 'sm' ? 'w-32' : 'w-44';
  return (
    <figure className="flex flex-col items-center">
      <svg viewBox="0 0 120 70" className={w} role="img" aria-label={description}>
        <path d="M12 62 A48 48 0 0 1 108 62" fill="none" stroke={color('surface-3')} strokeWidth="10" strokeLinecap="round" />
        <m.path
          d="M12 62 A48 48 0 0 1 108 62"
          fill="none"
          stroke={color(tone as Parameters<typeof color>[0])}
          strokeWidth="10"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: pct }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        />
        <text x="60" y="56" textAnchor="middle" fontSize="26" fontWeight="650" fill={color('text')} className="num">
          {has ? score : '—'}
        </text>
      </svg>
      <figcaption className="-mt-1 text-center">
        <span className="text-sm font-semibold text-text">{label ?? BAND_TEXT[band]}</span>
        {basis && <span className="block text-2xs text-text-3">{basis}</span>}
      </figcaption>
    </figure>
  );
}
