/**
 * Arrival scroll sections (spec §7.1.3). Each has one hero visual. Presentational:
 * every figure arrives formatted from the page, which reads the published index.
 */
import { m } from 'framer-motion';
import { AlertTriangle, ArrowRight, Info, MapPinned, OctagonAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { usePrefersReducedMotion } from '../hooks/useMediaQuery';
import { DUR, EASE, riseVariants, staggerVariants } from '../motion/presets';
import { Chip, Segmented } from '../ui/controls';
import { GlassPanel } from '../ui/Glass';
import { metroPath } from '../ui/atlasState';

// ---------- frame ----------
export function Section({ id, eyebrow, title, lede, children, wide = false }: { id: string; eyebrow: string; title: ReactNode; lede?: ReactNode; children: ReactNode; wide?: boolean }) {
  const reduce = usePrefersReducedMotion();
  return (
    <m.section
      id={id}
      aria-labelledby={`${id}-h`}
      className="relative mx-auto max-w-[1280px] px-4 py-20 sm:px-8 sm:py-28"
      initial={reduce ? false : 'hidden'}
      whileInView="shown"
      viewport={{ once: true, margin: '-12% 0px' }}
      variants={staggerVariants}
    >
      <m.div variants={riseVariants} className={wide ? 'max-w-3xl' : 'max-w-2xl'}>
        <div className="mp-label text-mp-accent">{eyebrow}</div>
        <h2 id={`${id}-h`} className="mp-display mt-3 text-[40px] sm:text-[56px]">
          {title}
        </h2>
        {lede && <p className="mt-4 text-[16px] text-mp-ink-2">{lede}</p>}
      </m.div>
      <m.div variants={riseVariants} className="mt-10">
        {children}
      </m.div>
    </m.section>
  );
}

// ---------- 1. the national picture ----------
export interface BriefStoryProps {
  sentences: string[];
  keyPoints: string[];
  citations: Array<{ name: string; url: string | null }>;
  narratedBy: string;
}

export function BriefStory({ sentences, keyPoints, citations, narratedBy }: BriefStoryProps) {
  return (
    <div className="grid gap-12 lg:grid-cols-[1fr_380px]">
      <div className="space-y-5 text-[18px] leading-[1.6] text-mp-ink">
        {sentences.map((s, i) => (
          <p key={i} className={i === 0 ? 'text-[22px] leading-[1.45]' : 'text-mp-ink-2'}>
            {s}
          </p>
        ))}
        <p className="flex flex-wrap items-center gap-2 pt-2 text-xs text-mp-ink-3">
          <Info size={13} strokeWidth={1.5} aria-hidden="true" /> {narratedBy}
          {citations.map((c) =>
            c.url ? (
              <a key={c.name} href={c.url} className="rounded-full border border-mp-line px-2.5 py-0.5 text-mp-ink-2 no-underline hover:text-mp-ink">
                {c.name}
              </a>
            ) : (
              <Chip key={c.name}>{c.name}</Chip>
            ),
          )}
        </p>
      </div>
      <ul className="space-y-6" aria-label="Key points">
        {keyPoints.map((k, i) => (
          <li key={i} className="border-l-2 border-mp-accent/60 pl-5">
            <span className="mp-display block text-[28px] italic leading-[1.15]">{k.replace(/\.$/, '')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- 2. the heat field ----------
export interface HeatBar {
  slug: string;
  name: string;
  short: string;
  /** Values by sort key: temperature 0–100, or a YoY ratio. */
  values: Record<'temperature' | 'price' | 'inventory', number | null>;
  text: Record<'temperature' | 'price' | 'inventory', string>;
  temperatureLabel: string | null;
}

export type HeatKey = 'temperature' | 'price' | 'inventory';

const tempFill = (score: number | null) => {
  if (score == null) return 'rgb(var(--mp-mid))';
  if (score >= 80) return 'rgb(var(--mp-hot-2))';
  if (score >= 60) return 'rgb(var(--mp-hot-1))';
  if (score > 40) return 'rgb(var(--mp-mid))';
  if (score > 20) return 'rgb(var(--mp-cool-1))';
  return 'rgb(var(--mp-cool-2))';
};

export function HeatField({ bars, labels }: { bars: readonly HeatBar[]; labels: Record<HeatKey, string> }) {
  const [key, setKey] = useState<HeatKey>('temperature');
  const [hover, setHover] = useState<string | null>(null);
  const reduce = usePrefersReducedMotion();
  const yoy = key !== 'temperature';
  const sorted = useMemo(() => [...bars].sort((a, b) => (b.values[key] ?? -Infinity) - (a.values[key] ?? -Infinity) || a.name.localeCompare(b.name)), [bars, key]);
  // Temperature: 0–100 from zero. YoY: centered on zero, full height = the largest |YoY|.
  const bound = yoy ? Math.max(...bars.map((b) => Math.abs(b.values[key] ?? 0)), 1e-9) : 100;
  const H = 240;
  const active = hover ? bars.find((b) => b.slug === hover) : sorted[0];
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Segmented
          label="Sort the heat field by"
          value={key}
          onChange={setKey}
          options={[
            { value: 'temperature', label: labels.temperature },
            { value: 'price', label: labels.price },
            { value: 'inventory', label: labels.inventory },
          ]}
        />
        {active && (
          <div className="text-right" aria-live="polite">
            <div className="mp-label">{active.name}</div>
            <div className="mp-num-hero text-[34px]">{active.text[key]}</div>
          </div>
        )}
      </div>
      <GlassPanel className="mt-5 overflow-x-auto px-4 pb-3 pt-6" role="group" aria-label={`50 metros ranked by ${labels[key].toLowerCase()}`} tabIndex={0}>
        <div className="relative flex min-w-[720px] items-end gap-[3px]" style={{ height: H }} onMouseLeave={() => setHover(null)}>
          {yoy && <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-mp-ink/25" style={{ top: H / 2 }} aria-hidden="true" />}
          {sorted.map((b) => {
            const v = b.values[key];
            const share = v == null ? 0 : Math.min(1, Math.abs(v) / bound);
            const h = yoy ? share * (H / 2) : Math.max(2, share * H);
            const up = !yoy || (v ?? 0) >= 0;
            const fill = yoy ? ((v ?? 0) >= 0 ? 'rgb(var(--mp-hot-1))' : 'rgb(var(--mp-cool-1))') : tempFill(v);
            return (
              <m.div key={b.slug} layout={!reduce} transition={{ duration: DUR.panel, ease: EASE }} className="relative h-full flex-1">
                <Link
                  to={`/explore?sel=${b.slug}`}
                  aria-label={`${b.name}: ${labels[key]} ${b.text[key]}`}
                  onMouseEnter={() => setHover(b.slug)}
                  onFocus={() => setHover(b.slug)}
                  className="absolute inset-x-0 block rounded-[3px] no-underline transition-[filter] duration-micro hover:brightness-125 focus-visible:outline-2"
                  style={{
                    height: h,
                    background: fill,
                    boxShadow: hover === b.slug ? '0 0 0 2px rgb(var(--mp-accent))' : undefined,
                    ...(yoy ? (up ? { bottom: H / 2 } : { top: H / 2 }) : { bottom: 0 }),
                  }}
                />
              </m.div>
            );
          })}
        </div>
        <div className="mt-2 flex min-w-[720px] justify-between text-[11px] text-mp-ink-3" aria-hidden="true">
          <span>{yoy ? 'largest rise' : 'hottest'}</span>
          <span>{yoy ? 'largest fall' : 'coldest'}</span>
        </div>
      </GlassPanel>
      <p className="mt-3 text-xs text-mp-ink-3">
        {yoy ? 'Bars from zero: up is a rise, down is a fall; the longest bar is the largest change.' : 'Temperature 0–100, bars from zero: how each market compares with its own 3-year history.'} Select a bar to open it on the atlas.
      </p>
    </div>
  );
}

// ---------- 3. rates vs prices ----------
export interface RatesPricesProps {
  rateDates: string[];
  rates: Array<number | null>;
  priceDates: string[];
  prices: Array<number | null>;
  events: Array<{ date: string; value: number; kind: 'high' | 'low'; label: string }>;
  fmtRate: (v: number | null | undefined) => string;
  fmtPrice: (v: number | null | undefined) => string;
  fmtDate: (iso: string) => string;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(960);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function RatesPrices({ rateDates, rates, priceDates, prices, events, fmtRate, fmtPrice, fmtDate }: RatesPricesProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const reduce = usePrefersReducedMotion();
  const [drawn, setDrawn] = useState(reduce);
  const [at, setAt] = useState<number | null>(null); // ms timestamp under the crosshair
  const t = (d: string) => Date.parse(`${d}T12:00:00Z`);
  const t0 = Math.min(t(rateDates[0]!), t(priceDates[0]!));
  const t1 = Math.max(t(rateDates[rateDates.length - 1]!), t(priceDates[priceDates.length - 1]!));
  const L = 56;
  const R = 16;
  const x = (ms: number) => L + ((ms - t0) / (t1 - t0)) * (width - L - R);
  const PH = 150;
  const GAP = 34;
  const panel = (vals: Array<number | null>, dates: string[], top: number) => {
    const nums = vals.filter((v): v is number => v != null);
    const lo = Math.min(...nums);
    const hi = Math.max(...nums);
    const pad = (hi - lo) * 0.12 || 1;
    const y = (v: number) => top + PH - ((v - (lo - pad)) / (hi + pad - (lo - pad))) * PH;
    let d = '';
    vals.forEach((v, i) => {
      if (v == null) return;
      d += `${d ? 'L' : 'M'}${x(t(dates[i]!)).toFixed(1)},${y(v).toFixed(1)}`;
    });
    return { d, y, lo, hi };
  };
  const rp = panel(rates, rateDates, 8);
  const pp = panel(prices, priceDates, 8 + PH + GAP);
  const near = (dates: string[], ms: number) => dates.reduce((best, d, i) => (Math.abs(t(d) - ms) < Math.abs(t(dates[best]!) - ms) ? i : best), 0);
  const ri = at == null ? rateDates.length - 1 : near(rateDates, at);
  const pi = at == null ? priceDates.length - 1 : near(priceDates, at);
  const years = [...new Set(priceDates.map((d) => d.slice(0, 4)))].map((y) => t(`${y}-01-01`)).filter((ms) => ms > t0 && ms < t1);
  const priceVals = prices.filter((v): v is number => v != null);
  const hiI = prices.indexOf(Math.max(...priceVals));
  const loI = prices.indexOf(Math.min(...priceVals));
  const total = 8 + PH * 2 + GAP + 26;

  useEffect(() => {
    if (reduce) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setDrawn(true), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, [reduce, ref]);

  const line = (d: string, color: string) => (
    <path d={d} fill="none" style={{ stroke: color, strokeDasharray: 4000, strokeDashoffset: drawn ? 0 : 4000, transition: reduce ? undefined : `stroke-dashoffset ${DUR.draw * 1.6}s cubic-bezier(.2,.8,.2,1)` }} strokeWidth="2" strokeLinejoin="round" />
  );

  return (
    <div ref={ref}>
      <div className="grid gap-4 sm:grid-cols-2" aria-live="polite">
        <div>
          <div className="mp-label">30-yr fixed rate · {fmtDate(rateDates[ri]!)}</div>
          <div className="mp-num-hero text-[34px] text-mp-accent">{fmtRate(rates[ri])}</div>
        </div>
        <div>
          <div className="mp-label">U.S. median sale price · {fmtDate(priceDates[pi]!)}</div>
          <div className="mp-num-hero text-[34px]">{fmtPrice(prices[pi])}</div>
        </div>
      </div>
      <svg
        width={width}
        height={total}
        className="mt-4 block touch-none select-none overflow-visible"
        role="img"
        aria-label={`Two panels sharing a time axis: the 30-year mortgage rate, ${fmtDate(rateDates[0]!)} to ${fmtDate(rateDates[rateDates.length - 1]!)}, and the U.S. median sale price. Move across to read both at a date.`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const ms = t0 + ((e.clientX - r.left - L) / (width - L - R)) * (t1 - t0);
          setAt(Math.max(t0, Math.min(t1, ms)));
        }}
        onPointerLeave={() => setAt(null)}
      >
        {[0, 1].map((k) => (
          <rect key={k} x={L} y={k ? 8 + PH + GAP : 8} width={width - L - R} height={PH} rx="10" style={{ fill: 'rgb(var(--mp-ink) / .03)' }} />
        ))}
        <text x={L - 8} y={8 + 14} textAnchor="end" className="fill-mp-ink-3 text-[11px]">
          {fmtRate(rp.hi)}
        </text>
        <text x={L - 8} y={8 + PH} textAnchor="end" className="fill-mp-ink-3 text-[11px]">
          {fmtRate(rp.lo)}
        </text>
        <text x={L - 8} y={8 + PH + GAP + 14} textAnchor="end" className="fill-mp-ink-3 text-[11px]">
          {fmtPrice(pp.hi)}
        </text>
        <text x={L - 8} y={8 + PH * 2 + GAP} textAnchor="end" className="fill-mp-ink-3 text-[11px]">
          {fmtPrice(pp.lo)}
        </text>
        {years.map((ms) => (
          <g key={ms}>
            <line x1={x(ms)} x2={x(ms)} y1={8} y2={8 + PH * 2 + GAP} style={{ stroke: 'rgb(var(--mp-ink) / .08)' }} />
            <text x={x(ms) + 4} y={total - 4} className="fill-mp-ink-3 font-figure text-[11px]">
              {new Date(ms).getUTCFullYear()}
            </text>
          </g>
        ))}
        {line(rp.d, 'rgb(var(--mp-accent))')}
        {line(pp.d, 'rgb(var(--mp-ink))')}
        {events.map((e) => {
          const ex = x(t(e.date));
          const ey = rp.y(e.value);
          return (
            <g key={e.date}>
              <circle cx={ex} cy={ey} r="4" style={{ fill: 'rgb(var(--mp-bg))', stroke: e.kind === 'high' ? 'rgb(var(--mp-hot-2))' : 'rgb(var(--mp-cool-2))' }} strokeWidth="2" />
              <text x={ex} y={e.kind === 'high' ? ey - 10 : ey + 18} textAnchor="middle" className="fill-mp-ink-2 font-figure text-[11px]">
                {e.label}
              </text>
            </g>
          );
        })}
        {[hiI, loI].map((i, k) => {
          const px = x(t(priceDates[i]!));
          const py = pp.y(prices[i]!);
          return (
            <g key={k}>
              <circle cx={px} cy={py} r="3.5" style={{ fill: 'rgb(var(--mp-bg))', stroke: 'rgb(var(--mp-ink))' }} strokeWidth="1.5" />
              <text x={px} y={k ? py + 18 : py - 10} textAnchor="middle" className="fill-mp-ink-2 font-figure text-[11px]">
                {k ? 'low' : '36-mo high'} {fmtPrice(prices[i])}
              </text>
            </g>
          );
        })}
        {at != null && (
          <g pointerEvents="none">
            <line x1={x(at)} x2={x(at)} y1={8} y2={8 + PH * 2 + GAP} style={{ stroke: 'rgb(var(--mp-ink) / .45)' }} strokeDasharray="3 3" />
            <circle cx={x(t(rateDates[ri]!))} cy={rp.y(rates[ri] ?? 0)} r="4" style={{ fill: 'rgb(var(--mp-accent))' }} />
            <circle cx={x(t(priceDates[pi]!))} cy={pp.y(prices[pi] ?? 0)} r="4" style={{ fill: 'rgb(var(--mp-ink))' }} />
          </g>
        )}
      </svg>
      <p className="mt-3 text-xs text-mp-ink-3">Two panels, one time axis: no dual y-axes. Rate moments are detected in code (peaks and troughs with at least 0.30 pp prominence, plus the window's high and low).</p>
    </div>
  );
}

// ---------- 4. movers and alerts ----------
export interface MoverRow {
  slug: string;
  name: string;
  value: number;
  text: string;
}

export function Podium({ gains, declines }: { gains: readonly MoverRow[]; declines: readonly MoverRow[] }) {
  const max = Math.max(...[...gains, ...declines].map((r) => Math.abs(r.value)), 1e-9);
  const reduce = usePrefersReducedMotion();
  const col = (title: string, rows: readonly MoverRow[], tone: 'hot' | 'cool') => (
    <div>
      <h3 className="mp-label">{title}</h3>
      <ol className="mt-3 space-y-2.5">
        {rows.map((r, i) => (
          <li key={r.slug}>
            <Link to={`/explore?sel=${r.slug}`} className="group block no-underline">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-mp-ink">
                  <span className="mp-num mr-2 text-mp-ink-3">{i + 1}</span>
                  {r.name}
                </span>
                <span className={`mp-num ${tone === 'hot' ? 'text-mp-hot-2' : 'text-mp-cool-2'}`}>{r.text}</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-mp-ink/[.06]">
                <m.div
                  className={`h-2 rounded-full ${tone === 'hot' ? 'bg-mp-hot-1' : 'bg-mp-cool-1'} group-hover:brightness-125`}
                  initial={reduce ? false : { width: 0 }}
                  whileInView={{ width: `${(Math.abs(r.value) / max) * 100}%` }}
                  style={reduce ? { width: `${(Math.abs(r.value) / max) * 100}%` } : undefined}
                  viewport={{ once: true }}
                  transition={{ duration: DUR.count, ease: EASE, delay: i * 0.04 }}
                />
              </div>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
  return (
    <div className="grid gap-10 md:grid-cols-2">
      {col('Biggest price gains, YoY', gains, 'hot')}
      {col('Biggest price declines, YoY', declines, 'cool')}
    </div>
  );
}

export interface AlertCard {
  flag: string;
  label: string;
  severity: string;
  metros: ReadonlyArray<{ slug: string; name: string; label: string; figure: string | null }>;
}

export function AlertCards({ alerts }: { alerts: readonly AlertCard[] }) {
  if (!alerts.length) return null;
  return (
    <div className="mt-12 grid gap-4 md:grid-cols-2">
      {alerts.map((a, i) => {
        const Icon = a.severity === 'major' ? OctagonAlert : a.severity === 'notable' ? AlertTriangle : Info;
        const tone = a.severity === 'major' ? 'text-mp-bad' : a.severity === 'notable' ? 'text-mp-warn' : 'text-mp-ink-3';
        const slugs = a.metros.slice(0, 12).map((x) => x.slug);
        return (
          <GlassPanel key={a.flag} className={`p-5 ${i === 0 ? 'md:col-span-2' : ''}`}>
            <div className="flex items-center gap-2 text-xs">
              <Icon size={15} strokeWidth={1.5} className={tone} aria-hidden="true" />
              <span className="mp-label">{a.severity === 'major' ? 'Major' : a.severity === 'notable' ? 'Notable' : 'Info'}</span>
              <span className="mp-num ml-auto text-mp-ink-3">
                {a.metros.length} {a.metros.length === 1 ? 'metro' : 'metros'}
              </span>
            </div>
            <h3 className={`mp-display mt-2 ${i === 0 ? 'text-[30px]' : 'text-[22px]'}`}>{a.label}</h3>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {a.metros.slice(0, i === 0 ? 14 : 4).map((x) => (
                <li key={x.slug}>
                  <Chip title={x.label || undefined}>
                    {x.name}
                    {x.figure && <span className="mp-num text-mp-ink-3">{x.figure}</span>}
                  </Chip>
                </li>
              ))}
              {a.metros.length > (i === 0 ? 14 : 4) && <li className="self-center text-xs text-mp-ink-3">+{a.metros.length - (i === 0 ? 14 : 4)} more</li>}
            </ul>
            <Link to={`/explore?sel=${slugs.join(',')}`} className="mt-4 inline-flex items-center gap-1.5 text-sm text-mp-accent no-underline hover:underline">
              <MapPinned size={15} strokeWidth={1.5} aria-hidden="true" /> Show on the atlas
            </Link>
          </GlassPanel>
        );
      })}
    </div>
  );
}

// ---------- 5. why these markets are moving ----------
export interface StoryCard {
  slug: string;
  name: string;
  trigger: string;
  text: string;
  cited: ReadonlyArray<{ key: string; label: string }>;
}

export function WhyMoving({ stories, empty }: { stories: readonly StoryCard[]; empty: string }) {
  if (!stories.length) return <p className="text-mp-ink-2">{empty}</p>;
  return (
    <div className={`grid gap-6 ${stories.length > 1 ? 'md:grid-cols-2' : ''}`}>
      {stories.map((s) => (
        <GlassPanel key={s.slug} as="article" className="p-6 sm:p-8">
          <Chip dot tone="accent">
            {s.trigger}
          </Chip>
          <h3 className="mp-display mt-4 text-[36px]">{s.name}</h3>
          <p className="mp-display mt-3 text-[22px] italic leading-[1.35] text-mp-ink-2">{s.text}</p>
          <div className="mt-5 flex flex-wrap gap-1.5" aria-label="Metrics the investigation cites">
            {s.cited.map((c) => (
              <Chip key={c.key}>{c.label}</Chip>
            ))}
          </div>
          <Link to={metroPath(s.slug)} className="mt-6 inline-flex items-center gap-1.5 text-sm text-mp-accent no-underline hover:underline">
            Open the dossier <ArrowRight size={15} strokeWidth={1.5} aria-hidden="true" />
          </Link>
        </GlassPanel>
      ))}
    </div>
  );
}
