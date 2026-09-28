import { useId } from 'react';
import { color, type ColorToken } from '../../lib/tokens';

interface SparklineProps {
  values: readonly (number | null)[];
  tone?: ColorToken;
  className?: string;
  /** Draw a soft area under the line. */
  area?: boolean;
}

/** A tiny, dependency-free trend line (decorative: the adjacent text carries the value). */
export function Sparkline({ values, tone = 'cat-1', className = 'h-8 w-full', area = true }: SparklineProps) {
  const gid = useId();
  const pts = values.map((v, i) => ({ i, v })).filter((p): p is { i: number; v: number } => p.v !== null && Number.isFinite(p.v));
  if (pts.length < 2) return <div className={className} aria-hidden="true" />;
  const W = 100;
  const H = 32;
  const pad = 3;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const span = max - min || 1;
  const x = (i: number) => (i / Math.max(values.length - 1, 1)) * W;
  const y = (v: number) => pad + (H - pad * 2) * (1 - (v - min) / span);
  const line = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(2)},${y(p.v).toFixed(2)}`).join('');
  const last = pts[pts.length - 1]!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={`${className} overflow-visible`} aria-hidden="true" focusable="false">
      {area && (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: color(tone), stopOpacity: 0.22 }} />
              <stop offset="100%" style={{ stopColor: color(tone), stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          <path d={`${line}L${x(last.i)},${H}L${x(pts[0]!.i)},${H}Z`} fill={`url(#${gid})`} />
        </>
      )}
      <path d={line} fill="none" stroke={color(tone)} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r="2.2" fill={color(tone)} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
