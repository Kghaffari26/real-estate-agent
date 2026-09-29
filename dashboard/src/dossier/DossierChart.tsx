/**
 * The dossier's main chart (spec §7.3.4): one metric over time, annotated (range
 * high/low, latest), scrubbable (pointer or arrow keys move a shared crosshair), with
 * the 30-year rate as a separate strip on the same time axis (never a dual axis).
 * The line draws left to right on first view, unless motion is reduced.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { usePrefersReducedMotion } from '../hooks/useMediaQuery';
import { DUR } from '../motion/presets';

interface DossierChartProps {
  dates: string[];
  metro: Array<number | null>;
  national: Array<number | null> | null;
  /** Weekly 30-yr rate (all available weeks); drawn where it overlaps `dates`. */
  rateDates: string[];
  rates: Array<number | null>;
  fmt: (v: number | null | undefined) => string;
  fmtRate: (v: number | null | undefined) => string;
  fmtDate: (iso: string) => string;
  zeroLine: boolean;
  label: string;
  metroName: string;
}

const t = (d: string) => Date.parse(`${d}T12:00:00Z`);

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function DossierChart({ dates, metro, national, rateDates, rates, fmt, fmtRate, fmtDate, zeroLine, label, metroName }: DossierChartProps) {
  const [ref, width] = useWidth();
  const reduce = usePrefersReducedMotion();
  const [drawn, setDrawn] = useState(reduce);
  const [at, setAt] = useState<number | null>(null); // month index under the crosshair
  const drawKey = `${dates[0]}|${dates.length}|${label}`;

  useEffect(() => {
    if (reduce) return setDrawn(true);
    setDrawn(false);
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setDrawn(true)));
    return () => cancelAnimationFrame(id);
  }, [drawKey, reduce]);

  if (dates.length < 2) return <p className="text-sm text-mp-ink-2">Not enough history for this metric.</p>;
  const L = 64;
  const R = 20;
  const MH = 230;
  const GAP = 26;
  const SH = 64;
  const t0 = t(dates[0]!);
  const t1 = t(dates[dates.length - 1]!);
  const x = (ms: number) => L + ((ms - t0) / (t1 - t0 || 1)) * (width - L - R);
  const all = [...metro, ...(national ?? [])].filter((v): v is number => v != null);
  if (zeroLine) all.push(0);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = (hi - lo) * 0.1 || Math.abs(hi) * 0.1 || 1;
  const y = (v: number) => 12 + MH - 12 - ((v - (lo - pad)) / (hi + pad - (lo - pad))) * (MH - 24);
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
  const valid = metro.map((v, i) => [v, i] as const).filter((p): p is readonly [number, number] => p[0] != null);
  const hiP = valid.reduce((a, b) => (b[0] > a[0] ? b : a), valid[0]!);
  const loP = valid.reduce((a, b) => (b[0] < a[0] ? b : a), valid[0]!);
  const lastP = valid[valid.length - 1]!;

  // The rate strip: weekly points inside the range.
  const inRange = rateDates.map((d, i) => ({ ms: t(d), v: rates[i] ?? null })).filter((p) => p.ms >= t0 - 7 * 864e5 && p.ms <= t1 + 31 * 864e5 && p.v != null) as Array<{ ms: number; v: number }>;
  const rLo = Math.min(...inRange.map((p) => p.v));
  const rHi = Math.max(...inRange.map((p) => p.v));
  const ry = (v: number) => MH + GAP + SH - 8 - ((v - rLo) / (rHi - rLo || 1)) * (SH - 16);
  const rPath = inRange.map((p, i) => `${i ? 'L' : 'M'}${x(Math.max(t0, Math.min(t1, p.ms))).toFixed(1)},${ry(p.v).toFixed(1)}`).join('');
  const rateAt = (ms: number) => {
    let best: { ms: number; v: number } | null = null;
    // The last weekly rate on or before the month end (same rule as the v1 overlay).
    for (const p of inRange) if (p.ms <= ms) best = p;
    return best;
  };

  const i = at ?? lastP[1];
  const cross = x(t(dates[i]!));
  const rate = rateAt(t(dates[i]!));
  const years = [...new Set(dates.map((d) => d.slice(0, 4)))];
  const yearStep = years.length > 9 ? 2 : 1;
  const total = MH + GAP + SH + 22;

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const cur = at ?? lastP[1];
    if (e.key === 'ArrowLeft') setAt(Math.max(0, cur - 1));
    else if (e.key === 'ArrowRight') setAt(Math.min(dates.length - 1, cur + 1));
    else if (e.key === 'Home') setAt(0);
    else if (e.key === 'End') setAt(dates.length - 1);
    else return;
    e.preventDefault();
  };

  const line = (d: string, style: string, width2 = 2, dash?: string) => (
    <path
      d={d}
      fill="none"
      style={{ stroke: style, strokeDasharray: dash ?? 6000, strokeDashoffset: dash ? 0 : drawn ? 0 : 6000, transition: reduce || dash ? undefined : `stroke-dashoffset ${DUR.draw * 1.6}s cubic-bezier(.2,.8,.2,1)` }}
      strokeWidth={width2}
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  );

  return (
    <div ref={ref}>
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-1" aria-live="polite">
        <div>
          <div className="mp-label">{fmtDate(dates[i]!)}</div>
          <div className="mp-num-hero text-[30px]" data-testid="chart-readout">
            {fmt(metro[i])}
          </div>
        </div>
        {national && (
          <div>
            <div className="mp-label">U.S.</div>
            <div className="mp-num text-[20px] text-mp-ink-2">{fmt(national[i])}</div>
          </div>
        )}
        <div>
          <div className="mp-label">30-yr rate</div>
          <div className="mp-num text-[20px] text-mp-accent">{rate ? fmtRate(rate.v) : '—'}</div>
        </div>
      </div>
      <svg
        width={width}
        height={total}
        className="mt-3 block touch-none select-none overflow-visible focus-visible:outline-none"
        tabIndex={0}
        role="img"
        aria-label={`${label} for ${metroName}, ${fmtDate(dates[0]!)} to ${fmtDate(dates[dates.length - 1]!)}; high ${fmt(hiP[0])} in ${fmtDate(dates[hiP[1]]!)}, low ${fmt(loP[0])} in ${fmtDate(dates[loP[1]]!)}, latest ${fmt(lastP[0])}. Arrow keys move through the months.`}
        onKeyDown={onKey}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const ms = t0 + ((e.clientX - r.left - L) / (width - L - R)) * (t1 - t0);
          let best = 0;
          dates.forEach((d, k) => {
            if (Math.abs(t(d) - ms) < Math.abs(t(dates[best]!) - ms)) best = k;
          });
          setAt(best);
        }}
        onPointerLeave={() => setAt(null)}
      >
        <rect x={L} y="0" width={width - L - R} height={MH} rx="12" style={{ fill: 'rgb(var(--mp-ink) / .03)' }} />
        <rect x={L} y={MH + GAP} width={width - L - R} height={SH} rx="10" style={{ fill: 'rgb(var(--mp-ink) / .03)' }} />
        {[hi, lo].map((v, k) => (
          <text key={k} x={L - 10} y={k ? MH - 10 : 20} textAnchor="end" className="fill-mp-ink-3 font-figure text-[11px]">
            {fmt(v)}
          </text>
        ))}
        {years.map((yr) => {
          if ((Number(yr) - Number(years[0])) % yearStep) return null;
          const ms = t(`${yr}-01-01`);
          if (ms < t0 || ms > t1) return null;
          return (
            <g key={yr}>
              <line x1={x(ms)} x2={x(ms)} y1="0" y2={MH + GAP + SH} style={{ stroke: 'rgb(var(--mp-ink) / .07)' }} />
              <text x={x(ms) + 4} y={total - 4} className="fill-mp-ink-3 font-figure text-[11px]">
                {yr}
              </text>
            </g>
          );
        })}
        {zeroLine && <line x1={L} x2={width - R} y1={y(0)} y2={y(0)} style={{ stroke: 'rgb(var(--mp-ink) / .35)' }} strokeDasharray="3 4" />}
        {national && line(path(national), 'rgb(var(--mp-ink-3))', 1.6, '5 4')}
        <path d={`${path(metro)}`} fill="none" />
        {line(path(metro), 'rgb(var(--mp-accent))', 2.2)}
        {[
          [hiP, zeroLine ? 'high' : 'high', -12],
          [loP, 'low', 20],
        ].map(([p, word, dy]) => {
          const [v, k] = p as readonly [number, number];
          const px = x(t(dates[k]!));
          return (
            <g key={word as string}>
              <circle cx={px} cy={y(v)} r="4" style={{ fill: 'rgb(var(--mp-bg))', stroke: 'rgb(var(--mp-ink))' }} strokeWidth="1.6" />
              <text x={Math.min(Math.max(px, L + 40), width - R - 60)} y={y(v) + (dy as number)} textAnchor="middle" className="fill-mp-ink-2 font-figure text-[11px]">
                {word as string} {fmt(v)}
              </text>
            </g>
          );
        })}
        <circle cx={x(t(dates[lastP[1]]!))} cy={y(lastP[0])} r="5" style={{ fill: 'rgb(var(--mp-accent))' }} />
        {rPath && line(rPath, 'rgb(var(--mp-accent) / .8)', 1.6)}
        <text x={L - 10} y={MH + GAP + 14} textAnchor="end" className="fill-mp-ink-3 font-figure text-[10px]">
          {inRange.length ? fmtRate(rHi) : ''}
        </text>
        <text x={L - 10} y={MH + GAP + SH - 4} textAnchor="end" className="fill-mp-ink-3 font-figure text-[10px]">
          {inRange.length ? fmtRate(rLo) : ''}
        </text>
        {inRange.length > 0 && inRange[0]!.ms > t0 + 60 * 864e5 && (
          <text x={x(inRange[0]!.ms) - 6} y={MH + GAP + SH / 2 + 4} textAnchor="end" className="fill-mp-ink-3 text-[11px]">
            weekly rate series starts {fmtDate(rateDates.find((d) => rates[rateDates.indexOf(d)] != null) ?? rateDates[0]!)}
          </text>
        )}
        <g pointerEvents="none">
          <line x1={cross} x2={cross} y1="0" y2={MH + GAP + SH} style={{ stroke: 'rgb(var(--mp-ink) / .45)' }} strokeDasharray="3 3" />
          {metro[i] != null && <circle cx={cross} cy={y(metro[i]!)} r="4.5" style={{ fill: 'rgb(var(--mp-accent))', stroke: 'rgb(var(--mp-bg))' }} strokeWidth="2" />}
          {rate && <circle cx={x(Math.max(t0, Math.min(t1, rate.ms)))} cy={ry(rate.v)} r="3.5" style={{ fill: 'rgb(var(--mp-accent))' }} />}
        </g>
      </svg>
    </div>
  );
}
