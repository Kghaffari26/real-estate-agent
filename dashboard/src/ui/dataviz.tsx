import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { useId } from 'react';

/** The diverging YoY scale's CSS gradient (cool → neutral → hot), the same everywhere. */
export const DIVERGING_GRADIENT = 'linear-gradient(90deg, rgb(var(--mp-cool-2)), rgb(var(--mp-cool-1)), rgb(var(--mp-mid)), rgb(var(--mp-hot-1)), rgb(var(--mp-hot-2)))';

export function DivergingLegend({ min, max, label = 'YoY' }: { min: string; max: string; label?: string }) {
  return (
    <figure className="m-0">
      <figcaption className="sr-only">
        {label} color scale from {min} (cool) through 0 (neutral) to {max} (hot)
      </figcaption>
      <div className="h-2 rounded-full" style={{ background: DIVERGING_GRADIENT }} aria-hidden="true" />
      <div className="mp-num mt-1 flex justify-between text-[11px] text-mp-ink-3" aria-hidden="true">
        <span>{min}</span>
        <span>0</span>
        <span>{max}</span>
      </div>
    </figure>
  );
}

/** A 0–100 temperature on a cool→hot arc. The number is always shown beside it. */
export function ThermalArc({ score, label, size = 120 }: { score: number | null; label: string; size?: number }) {
  const gid = useId();
  const r = size / 2 - 8;
  const cx = size / 2;
  const cy = r + 8;
  const at = (t: number) => [cx + r * Math.cos(Math.PI + t * Math.PI), cy + r * Math.sin(Math.PI + t * Math.PI)] as const;
  const [sx, sy] = at(0);
  const [ex, ey] = at(1);
  const t = score == null ? null : Math.min(100, Math.max(0, score)) / 100;
  const marker = t == null ? null : at(t);
  return (
    <svg width={size} height={r + 18} viewBox={`0 0 ${size} ${r + 18}`} role="img" aria-label={score == null ? 'Temperature unavailable' : `Temperature ${score} of 100, ${label}`}>
      <defs>
        <linearGradient id={gid} x1="0" x2="1">
          <stop offset="0" style={{ stopColor: 'rgb(var(--mp-cool-2))' }} />
          <stop offset=".5" style={{ stopColor: 'rgb(var(--mp-mid))' }} />
          <stop offset="1" style={{ stopColor: 'rgb(var(--mp-hot-2))' }} />
        </linearGradient>
      </defs>
      <path d={`M${sx},${sy} A${r},${r} 0 0 1 ${ex},${ey}`} fill="none" stroke={`url(#${gid})`} strokeWidth="6" strokeLinecap="round" opacity={score == null ? 0.3 : 0.95} />
      {marker && <circle cx={marker[0]} cy={marker[1]} r="7" style={{ fill: 'rgb(var(--mp-bg))', stroke: 'rgb(var(--mp-ink))' }} strokeWidth="2" />}
    </svg>
  );
}

export function TrendGlyph({ trend, className = '' }: { trend: string | null | undefined; className?: string }) {
  const Icon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const label = trend === 'up' ? '3-month trend up' : trend === 'down' ? '3-month trend down' : '3-month trend flat';
  return <Icon size={14} strokeWidth={1.5} className={`text-mp-ink-3 ${className}`} role="img" aria-label={label} />;
}

interface MiniSparkProps {
  values: readonly (number | null)[];
  width: number;
  height?: number;
  /** Mark the 36-month high and low and the latest point. */
  marks?: boolean;
  stroke?: string;
}

/** A small trend line with high/low/latest marks (decorative: the adjacent text carries the value). */
export function MiniSpark({ values, width, height = 30, marks = true, stroke = 'rgb(var(--mp-ink-2))' }: MiniSparkProps) {
  const pts = values.map((v, i) => ({ i, v })).filter((p): p is { i: number; v: number } => p.v != null && Number.isFinite(p.v));
  if (pts.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const lo = Math.min(...pts.map((p) => p.v));
  const hi = Math.max(...pts.map((p) => p.v));
  const x = (i: number) => (i / Math.max(values.length - 1, 1)) * (width - 4) + 2;
  const y = (v: number) => 3 + (height - 6) * (1 - (v - lo) / (hi - lo || 1));
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const hiP = pts.find((p) => p.v === hi)!;
  const loP = pts.find((p) => p.v === lo)!;
  const last = pts[pts.length - 1]!;
  return (
    <svg width={width} height={height} className="block overflow-visible" aria-hidden="true" focusable="false">
      <path d={d} fill="none" style={{ stroke }} strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
      {marks && (
        <>
          <circle cx={x(hiP.i)} cy={y(hiP.v)} r="2.2" style={{ fill: 'rgb(var(--mp-hot-2))' }} />
          <circle cx={x(loP.i)} cy={y(loP.v)} r="2.2" style={{ fill: 'rgb(var(--mp-cool-2))' }} />
          <circle cx={x(last.i)} cy={y(last.v)} r="2.8" style={{ fill: 'rgb(var(--mp-accent))' }} />
        </>
      )}
    </svg>
  );
}
