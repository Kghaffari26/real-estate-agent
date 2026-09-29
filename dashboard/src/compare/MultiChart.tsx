/**
 * A compare panel (spec §7.5): one metric, one line per metro in its entity color,
 * one y-axis, direct end labels, and a crosshair shared with the other panels (the
 * page owns the index). Pointer or arrow keys move it; the line draws on first view.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { usePrefersReducedMotion } from '../hooks/useMediaQuery';
import { DUR } from '../motion/presets';

export interface Line {
  slug: string;
  name: string;
  color: string;
  values: Array<number | null>;
}

interface MultiChartProps {
  title: string;
  dates: string[];
  lines: readonly Line[];
  fmt: (v: number | null | undefined) => string;
  fmtDate: (iso: string) => string;
  /** The shared crosshair, by date (panels may span different months). */
  at: string | null;
  onAt: (date: string | null) => void;
  height?: number;
}

const t = (d: string) => Date.parse(`${d}T12:00:00Z`);

export function MultiChart({ title, dates, lines, fmt, fmtDate, at, onAt, height = 220 }: MultiChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const reduce = usePrefersReducedMotion();
  const [drawn, setDrawn] = useState(reduce);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const key = `${dates[0]}|${dates.length}|${lines.map((l) => l.slug).join()}|${title}`;
  useEffect(() => {
    if (reduce) return setDrawn(true);
    setDrawn(false);
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setDrawn(true)));
    return () => cancelAnimationFrame(id);
  }, [key, reduce]);

  if (dates.length < 2) return null;
  if (!width) return <figure ref={ref} className="m-0" style={{ height: height + 60 }} />;
  const narrow = width < 560;
  const L = narrow ? 52 : 60;
  const R = narrow ? 70 : 150; // room for direct end labels (values only on phones)
  const t0 = t(dates[0]!);
  const t1 = t(dates[dates.length - 1]!);
  const x = (ms: number) => L + ((ms - t0) / (t1 - t0 || 1)) * (width - L - R);
  const all = lines.flatMap((l) => l.values).filter((v): v is number => v != null);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = (hi - lo) * 0.08 || 1;
  const y = (v: number) => 10 + (height - 30) * (1 - (v - (lo - pad)) / (hi + pad - (lo - pad)));
  const path = (vals: Array<number | null>) => {
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null) return void (pen = false);
      d += `${pen ? 'L' : 'M'}${x(t(dates[i]!)).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  // End labels, nudged apart so they never overlap.
  const ends = lines
    .map((l) => {
      let i = l.values.length - 1;
      while (i >= 0 && l.values[i] == null) i--;
      return { l, i, y: i >= 0 ? y(l.values[i]!) : NaN };
    })
    .filter((e) => e.i >= 0)
    .sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) if (ends[k]!.y - ends[k - 1]!.y < 16) ends[k]!.y = ends[k - 1]!.y + 16;
  const found = at == null ? -1 : dates.indexOf(at);
  const i = found >= 0 ? found : dates.length - 1;
  const cx = x(t(dates[i]!));
  const years = [...new Set(dates.map((d) => d.slice(0, 4)))];
  const step = years.length > 9 ? 2 : 1;

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const cur = i;
    const next = e.key === 'ArrowLeft' ? cur - 1 : e.key === 'ArrowRight' ? cur + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? dates.length - 1 : null;
    if (next == null) return;
    e.preventDefault();
    onAt(dates[Math.max(0, Math.min(dates.length - 1, next))]!);
  };

  return (
    <figure ref={ref} className="m-0">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="mp-display text-[24px]">{title}</span>
        <span className="text-xs text-mp-ink-3">{fmtDate(dates[i]!)}</span>
      </figcaption>
      <svg
        width={width}
        height={height + 16}
        className="mt-2 block touch-none select-none overflow-visible focus-visible:outline-none"
        tabIndex={0}
        role="img"
        aria-label={`${title}, ${fmtDate(dates[0]!)} to ${fmtDate(dates[dates.length - 1]!)}. ${lines.map((l) => `${l.name} ${fmt(l.values[i])}`).join('; ')}. Arrow keys move through the months.`}
        onKeyDown={onKey}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const ms = t0 + ((e.clientX - r.left - L) / (width - L - R)) * (t1 - t0);
          let best = 0;
          dates.forEach((d, k) => {
            if (Math.abs(t(d) - ms) < Math.abs(t(dates[best]!) - ms)) best = k;
          });
          onAt(dates[best]!);
        }}
        onPointerLeave={() => onAt(null)}
      >
        <rect x={L} y="0" width={width - L - R} height={height - 10} rx="12" style={{ fill: 'rgb(var(--mp-ink) / .03)' }} />
        <text x={L - 8} y="20" textAnchor="end" className="fill-mp-ink-3 font-figure text-[11px]">
          {fmt(hi)}
        </text>
        <text x={L - 8} y={height - 16} textAnchor="end" className="fill-mp-ink-3 font-figure text-[11px]">
          {fmt(lo)}
        </text>
        {years.map((yr) => {
          const ms = t(`${yr}-01-01`);
          if (ms < t0 || ms > t1 || (Number(yr) - Number(years[0])) % step) return null;
          return (
            <g key={yr}>
              <line x1={x(ms)} x2={x(ms)} y1="0" y2={height - 10} style={{ stroke: 'rgb(var(--mp-ink) / .07)' }} />
              <text x={x(ms) + 4} y={height + 12} className="fill-mp-ink-3 font-figure text-[11px]">
                {yr}
              </text>
            </g>
          );
        })}
        {lines.map((l) => (
          <path
            key={l.slug}
            d={path(l.values)}
            fill="none"
            style={{ stroke: l.color, strokeDasharray: 6000, strokeDashoffset: drawn ? 0 : 6000, transition: reduce ? undefined : `stroke-dashoffset ${DUR.draw * 1.6}s cubic-bezier(.2,.8,.2,1)` }}
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
        ))}
        {ends.map((e) => (
          <text key={e.l.slug} x={width - R + 8} y={e.y + 4} className="font-figure text-[11px]" style={{ fill: e.l.color }}>
            {narrow ? '' : `${e.l.name.replace(/,\s*[A-Z-]+$/, '')} `}
            {fmt(e.l.values[e.i])}
          </text>
        ))}
        <g pointerEvents="none">
          <line x1={cx} x2={cx} y1="0" y2={height - 10} style={{ stroke: 'rgb(var(--mp-ink) / .45)' }} strokeDasharray="3 3" />
          {lines.map((l) =>
            l.values[i] == null ? null : <circle key={l.slug} cx={cx} cy={y(l.values[i]!)} r="4" style={{ fill: l.color, stroke: 'rgb(var(--mp-bg))' }} strokeWidth="2" />,
          )}
        </g>
      </svg>
    </figure>
  );
}
