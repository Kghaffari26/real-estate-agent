import { m } from 'framer-motion';
import { AlertTriangle, ArrowRight, CheckCircle2, Crosshair, Flag, Mountain, Building2, OctagonAlert, Plane, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useIndex } from '../data/hooks';
import type { IndexOutput } from '../data/schema.gen';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { usePrefersReducedMotion } from '../hooks/useMediaQuery';
import { detectRateEvents } from '../lib/events';
import { formatDelta, formatMonth, formatValue } from '../lib/format';
import { DUR, panelVariants, riseVariants, staggerVariants, STAGGER, SPRING_PANEL } from '../motion/presets';
import { AtlasChrome } from '../ui/AtlasChrome';
import { Button, Chip, Segmented, Slider, Toggle } from '../ui/controls';
import { Counter } from '../ui/Counter';
import { DivergingLegend, ThermalArc } from '../ui/dataviz';
import { Dock } from '../ui/Dock';
import { GlassPanel } from '../ui/Glass';
import { Instrument } from '../ui/Instrument';
import { Scrubber } from '../ui/Scrubber';

function Section({ id, eyebrow, title, note, children }: { id: string; eyebrow: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="grid gap-x-12 gap-y-6 border-t border-mp-line py-14 lg:grid-cols-[260px_1fr]">
      <header>
        <div className="mp-label text-mp-accent">{eyebrow}</div>
        <h2 id={`${id}-h`} className="mp-display mt-2 text-[30px]">
          {title}
        </h2>
        {note && <p className="mt-3 max-w-[30ch] text-sm text-mp-ink-2">{note}</p>}
      </header>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

type Summary = { value: number | null; yoy: number | null } | { value: number | null; yoy_12m: number | null } | undefined;
const yoyOf = (x: Summary): number | null => (x == null ? null : 'yoy' in x ? x.yoy : x.yoy_12m);

const sign = (v: number | null | undefined): -1 | 0 | 1 => (v == null || v === 0 ? 0 : v > 0 ? 1 : -1);

function Swatch({ name, token, note, ring = false }: { name: string; token: string; note?: string; ring?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`h-10 w-10 flex-none rounded-control ${ring ? 'ring-1 ring-inset ring-mp-ink/20' : ''}`} style={{ background: `rgb(var(--mp-${token}))` }} aria-hidden="true" />
      <div className="min-w-0 text-sm">
        <div className="text-mp-ink">{name}</div>
        <div className="mp-num truncate text-xs text-mp-ink-3">--mp-{token}{note ? ` · ${note}` : ''}</div>
      </div>
    </div>
  );
}

function Tokens({ index }: { index: IndexOutput }) {
  const yoys = index.metros.map((x) => yoyOf(x.latest.median_sale_price)).filter((v): v is number => typeof v === 'number');
  const maxAbs = Math.max(...yoys.map(Math.abs));
  return (
    <div className="grid gap-10 xl:grid-cols-2">
      <div className="grid gap-4 sm:grid-cols-2">
        <Swatch name="Canvas" token="bg" ring />
        <Swatch name="Canvas, raised" token="bg-2" ring />
        <Swatch name="Glass panel" token="panel" note="72% + 20 px blur" ring />
        <Swatch name="Accent (one only)" token="accent" />
        <Swatch name="Ink" token="ink" />
        <Swatch name="Ink, secondary" token="ink-2" />
        <Swatch name="Ink, muted (≥ 4.5:1)" token="ink-3" />
        <Swatch name="Focus ring" token="focus" />
      </div>
      <div className="space-y-6">
        <div>
          <div className="mp-label mb-2">Diverging · YoY, the same scale on map, tables and chips</div>
          <DivergingLegend min={formatValue(-maxAbs, 'percent_signed')} max={formatValue(maxAbs, 'percent_signed')} />
          <p className="mt-2 text-xs text-mp-ink-3">Symmetric at ±{formatValue(maxAbs, 'percent')}, the largest |YoY| among the 50 metros this run.</p>
        </div>
        <div>
          <div className="mp-label mb-2">Market temperature → light</div>
          <div className="flex flex-wrap gap-4">
            <Swatch name="Cold rim" token="cold-light" />
            <Swatch name="Neutral" token="mid" />
            <Swatch name="Warm key" token="warm-light" />
          </div>
        </div>
        <div>
          <div className="mp-label mb-2">Status: reserved, always icon + label</div>
          <div className="flex flex-wrap gap-2">
            <Chip icon={<CheckCircle2 size={13} strokeWidth={1.5} className="text-mp-good" aria-hidden="true" />}>Published</Chip>
            <Chip icon={<AlertTriangle size={13} strokeWidth={1.5} className="text-mp-warn" aria-hidden="true" />}>Notable</Chip>
            <Chip icon={<OctagonAlert size={13} strokeWidth={1.5} className="text-mp-bad" aria-hidden="true" />}>Major</Chip>
          </div>
        </div>
        <div>
          <div className="mp-label mb-2">Entity colors · a metro keeps its color everywhere</div>
          <div className="flex flex-wrap gap-4">
            <Swatch name="First" token="e1" />
            <Swatch name="Second" token="e2" />
            <Swatch name="Third" token="e3" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Type({ index }: { index: IndexOutput }) {
  const price = index.key_stats.find((k) => k.format === 'currency_compact');
  return (
    <div className="space-y-8">
      <div>
        <div className="mp-label">Display · Instrument Serif, 72–120 px</div>
        <p className="mp-display mt-2 text-[56px] sm:text-[84px]">{index.headline}</p>
      </div>
      <div className="grid gap-8 sm:grid-cols-[auto_1fr] sm:items-end">
        <div>
          <div className="mp-label">Headline number · Geist Mono 300, 48–64 px</div>
          <div className="mp-num-hero mt-2 text-[56px]">
            <Counter value={price?.value} format={(v) => formatValue(v, 'currency')} />
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <div className="mp-label">Section title · 28–32 px</div>
            <div className="mp-display text-[30px]">Why these markets are moving</div>
          </div>
          <div>
            <div className="mp-label">Body · Inter Tight, 15–16 px</div>
            <p className="max-w-[62ch] text-[15px] text-mp-ink-2">{index.national.brief.text.split('. ').slice(0, 2).join('. ')}.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Controls({ index }: { index: IndexOutput }) {
  const [radius, setRadius] = useState(100);
  const rate = index.national.rates.latest.mortgage30 ?? 7;
  const [ratePct, setRatePct] = useState(rate);
  const [layer, setLayer] = useState<'columns' | 'bubbles' | 'heat' | 'flat'>('columns');
  const [buildings, setBuildings] = useState(true);
  const [terrain, setTerrain] = useState(false);
  const [chip, setChip] = useState('median_sale_price');
  return (
    <div className="grid gap-10 xl:grid-cols-2">
      <div className="space-y-6">
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" size="lg">
            Enter the market <ArrowRight size={16} strokeWidth={1.5} aria-hidden="true" />
          </Button>
          <Button icon={<Plane size={15} strokeWidth={1.5} aria-hidden="true" />}>Fly there</Button>
          <Button variant="quiet" icon={<RotateCcw size={15} strokeWidth={1.5} aria-hidden="true" />}>
            Reset to published
          </Button>
        </div>
        <Segmented
          label="Layer style"
          value={layer}
          onChange={setLayer}
          options={[
            { value: 'columns', label: 'Columns' },
            { value: 'bubbles', label: 'Bubbles' },
            { value: 'heat', label: 'Heat' },
            { value: 'flat', label: 'Flat' },
          ]}
        />
        <div className="max-w-xs space-y-3">
          <Toggle label="3D buildings" checked={buildings} onChange={setBuildings} icon={<Building2 size={15} strokeWidth={1.5} aria-hidden="true" />} />
          <Toggle label="Terrain" checked={terrain} onChange={setTerrain} icon={<Mountain size={15} strokeWidth={1.5} aria-hidden="true" />} />
        </div>
        <div className="flex flex-wrap gap-2">
          {['median_sale_price', 'inventory', 'median_dom', 'price_drops'].map((k) => (
            <Chip key={k} selected={chip === k} onClick={() => setChip(k)}>
              {index.metric_registry.find((r) => r.key === k)?.label ?? k}
            </Chip>
          ))}
          <Chip icon={<Flag size={12} strokeWidth={1.5} aria-hidden="true" />}>Median price −6.3% YoY</Chip>
        </div>
      </div>
      <div className="space-y-8">
        <Slider
          label="Search radius"
          value={radius}
          min={10}
          max={250}
          step={5}
          scale="log"
          onChange={setRadius}
          format={(v) => `${Math.round(v)} mi`}
          ends={['10', '250 mi']}
          hint="Logarithmic: 10→25 mi gets the same travel as 100→250 mi."
        />
        <Slider
          label="30-yr rate"
          size="lg"
          value={ratePct}
          min={3}
          max={9}
          step={0.01}
          onChange={setRatePct}
          format={(v) => `${v.toFixed(2)}%`}
          hint={`Latest Freddie Mac PMMS: ${rate.toFixed(2)}% · year ago ${index.national.rates.latest.mortgage30_year_ago?.toFixed(2) ?? '—'}%`}
        />
      </div>
    </div>
  );
}

function Instruments({ index }: { index: IndexOutput }) {
  const nat = index.national;
  const keys = ['median_sale_price', 'inventory', 'median_dom', 'price_drops'] as const;
  const reg = new Map(index.metric_registry.map((r) => [r.key, r]));
  const [hl, setHl] = useState<string>('inventory');
  return (
    <div className="space-y-4">
      <GlassPanel className="flex overflow-x-auto" tabIndex={0} role="region" aria-label="National instruments (scrolls sideways)">
        {keys.map((k, i) => {
          const v = nat.latest[k];
          const r = reg.get(k);
          const series = nat.series[k] as (number | null)[] | undefined;
          const dfmt = v?.delta_format ?? 'percent_signed';
          return (
            <div key={k} className={i ? 'border-l border-mp-line' : ''}>
              <Instrument
                wide={i === 0}
                label={r?.label ?? k}
                value={formatValue(v?.value, r?.format)}
                yoy={formatDelta(v?.yoy, dfmt)}
                yoySign={sign(v?.yoy)}
                mom={formatDelta(v?.mom, dfmt)}
                trend={v?.trend_3m}
                series={series}
                extreme={v?.high_36m ? '36-mo high' : v?.low_36m ? '36-mo low' : null}
                highlighted={hl === k}
              />
            </div>
          );
        })}
      </GlassPanel>
      <div className="flex flex-wrap items-center gap-2 text-sm text-mp-ink-2">
        Cited-metric chips highlight their instrument:
        {keys.map((k) => (
          <Chip key={k} selected={hl === k} onClick={() => setHl(k)}>
            {reg.get(k)?.label ?? k}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function TimeMachine({ index }: { index: IndexOutput }) {
  const nat = index.national;
  const dates = nat.series.dates as string[];
  const prices = nat.series.median_sale_price as (number | null)[];
  const [i, setI] = useState(dates.length - 1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<'1' | '4'>('1');
  const events = useMemo(() => {
    const monthOf = (d: string) => dates.findIndex((x) => x.slice(0, 7) === d.slice(0, 7));
    const found = detectRateEvents(nat.rates.dates, nat.rates.mortgage30, { minProminence: 0.3, window: 8 })
      .map((e) => ({ ...e, month: monthOf(e.date) }))
      .filter((e) => e.month >= 0);
    const top = (k: 'high' | 'low') => found.filter((e) => e.kind === k).sort((a, b) => b.prominence - a.prominence)[0];
    const featured = new Set([top('high'), top('low')]);
    return found.map((e) => ({ index: e.month, kind: e.kind, label: `30-yr ${e.kind} ${e.value.toFixed(2)}% · ${formatMonth(e.date)}`, showLabel: featured.has(e) }));
  }, [dates, nat.rates]);
  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => setI((x) => (x >= dates.length - 1 ? 0 : x + 1)), speed === '4' ? 180 : 700);
    return () => window.clearInterval(t);
  }, [playing, speed, dates.length]);
  const d = dates[i]!;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-x-10 gap-y-2">
        <div className="mp-display text-[56px] italic leading-none">{formatMonth(d, true)}</div>
        <div>
          <div className="mp-label">U.S. median sale price</div>
          <div className="mp-num-hero text-[34px]">{formatValue(prices[i], 'currency')}</div>
        </div>
      </div>
      <GlassPanel className="px-5 py-3">
        <Scrubber
          dates={dates}
          index={i}
          onChange={setI}
          playing={playing}
          onPlayToggle={() => setPlaying((p) => !p)}
          speed={speed}
          onSpeedChange={setSpeed}
          events={events}
          formatDate={(x) => formatMonth(x, true)}
          announcement={`${formatMonth(d, true)}: U.S. median ${formatValue(prices[i], 'currency')}`}
        />
      </GlassPanel>
      <p className="text-xs text-mp-ink-3">
        Moments are detected in code: 30-yr rate peaks and troughs with at least 0.30 pp prominence over the weekly series ({events.length} found in this window).
      </p>
    </div>
  );
}

function Panels({ index }: { index: IndexOutput }) {
  const temp = index.national.temperature;
  const reduce = usePrefersReducedMotion();
  const [run, setRun] = useState(0);
  const cols = [...index.metros].sort((a, b) => (b.homes_sold_12m ?? 0) - (a.homes_sold_12m ?? 0)).slice(0, 24);
  const yoys = index.metros.map((x) => Math.abs(yoyOf(x.latest.median_sale_price) ?? 0));
  const maxAbs = Math.max(...yoys);
  const price = (x: (typeof cols)[number]) => x.latest.median_sale_price?.value ?? 0;
  const maxP = Math.max(...cols.map(price));
  return (
    <div className="relative overflow-hidden rounded-panel border border-mp-line bg-mp-bg-2 p-6 sm:p-10">
      {/* a strip of light columns: the 24 largest metros, height = median price, color = YoY */}
      <svg className="absolute inset-x-0 bottom-0 h-[70%] w-full" viewBox="0 0 480 200" preserveAspectRatio="none" aria-hidden="true">
        {cols.map((c, k) => {
          const y = yoyOf(c.latest.median_sale_price) ?? 0;
          const t = y / maxAbs;
          const color = t < 0 ? `rgb(var(--mp-cool-${t < -0.5 ? 2 : 1}))` : t > 0.5 ? 'rgb(var(--mp-hot-2))' : t > 0 ? 'rgb(var(--mp-hot-1))' : 'rgb(var(--mp-mid))';
          const h = 30 + (price(c) / maxP) * 160;
          return (
            <g key={c.slug}>
              <rect x={10 + k * 19.5} y={200 - h} width="5" height={h} style={{ fill: color }} opacity=".75" />
              <rect x={11.8 + k * 19.5} y={200 - h} width="1.4" height={h} fill="#fff" opacity=".5" />
            </g>
          );
        })}
      </svg>
      <span className="mp-grain" aria-hidden="true" />
      <m.div key={run} className="relative grid gap-5 md:grid-cols-[250px_1fr_280px]" variants={staggerVariants} initial={reduce ? false : 'hidden'} animate="shown">
        <m.div variants={panelVariants}>
          <Dock title="Layers">
            <div className="space-y-1 text-sm">
              {['Median sale price', 'Active inventory', 'Days on market'].map((n, k) => (
                <div key={n} className={`rounded-control px-2.5 py-1.5 ${k === 0 ? 'bg-mp-accent/[.12] text-mp-ink shadow-[inset_2px_0_0_rgb(var(--mp-accent))]' : 'text-mp-ink-2'}`}>
                  {n}
                </div>
              ))}
            </div>
          </Dock>
        </m.div>
        <m.div variants={panelVariants} className="self-end">
          <GlassPanel className="inline-flex items-end gap-4 p-4">
            <ThermalArc score={temp.score} label={temp.label ?? ''} />
            <div>
              <div className="mp-label">U.S. temperature</div>
              <div className="mp-num-hero text-[44px]">{temp.score ?? '—'}</div>
              <div className="text-xs text-mp-ink-3">{temp.label} vs its own 3-year history</div>
            </div>
          </GlassPanel>
        </m.div>
        <m.div variants={panelVariants}>
          <GlassPanel className="p-4">
            <div className="mp-label flex items-center gap-2 text-mp-accent">
              <Crosshair size={14} strokeWidth={1.5} aria-hidden="true" /> Glass over data
            </div>
            <p className="mt-2 text-sm text-mp-ink-2">Panels blur what's under them and keep text above 4.5:1 even over the brightest column. Reduced transparency makes them solid.</p>
          </GlassPanel>
        </m.div>
      </m.div>
      <div className="relative mt-6 inline-block rounded-control bg-mp-bg/80">
        <Button variant="quiet" onClick={() => setRun((r) => r + 1)} icon={<RotateCcw size={15} strokeWidth={1.5} aria-hidden="true" />}>
          Replay the panel entrance
        </Button>
      </div>
    </div>
  );
}

function Motion() {
  const reduce = usePrefersReducedMotion();
  const rows: Array<[string, string]> = [
    ['Micro (hover, press)', `${DUR.micro * 1000} ms · cubic-bezier(.2,.8,.2,1)`],
    ['Panels', `spring · stiffness ${(SPRING_PANEL as { stiffness: number }).stiffness}, damping ${(SPRING_PANEL as { damping: number }).damping}`],
    ['Stagger', `${STAGGER * 1000} ms between siblings`],
    ['Numbers', `count up over ${DUR.count * 1000} ms, eased out`],
    ['Chart lines', `draw left → right over ${DUR.draw * 1000} ms, first view only`],
    ['Camera', `flyTo ${DUR.camera} s, curve 1.4, never over user input`],
    ['Reduced motion', 'no flights, no count-ups, no autoplay; panels appear instantly'],
  ];
  return (
    <m.dl className="grid max-w-3xl gap-px overflow-hidden rounded-panel border border-mp-line bg-mp-ink/[.08] text-sm" variants={staggerVariants} initial={reduce ? false : 'hidden'} whileInView="shown" viewport={{ once: true }}>
      {rows.map(([k, v]) => (
        <m.div key={k} variants={riseVariants} className="grid grid-cols-[180px_1fr] gap-4 bg-mp-bg px-4 py-3">
          <dt className="text-mp-ink">{k}</dt>
          <dd className="mp-num text-mp-ink-2">{v}</dd>
        </m.div>
      ))}
    </m.dl>
  );
}

export function StyleguidePage() {
  useDocumentTitle('Styleguide');
  const index = useIndex();
  return (
    <AtlasChrome>
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute -right-40 -top-40 h-[640px] w-[640px] rounded-full bg-mp-accent/10 blur-[120px]" aria-hidden="true" />
        <div className="mx-auto max-w-[1280px] px-4 pb-24 pt-10 sm:px-8">
          <div className="mp-label text-mp-accent">Metro Pulse v2 · design system</div>
          <h1 className="mp-display mt-3 text-[64px] sm:text-[104px]">Night Atlas</h1>
          <p className="mt-4 max-w-[58ch] text-[16px] text-mp-ink-2">
            A planetarium for the housing market: a near-black canvas where data glows, glass that floats over it, one electric accent. Dawn is its designed light sibling. Every figure on this page comes from the published snapshot.
          </p>
          {index.status !== 'ready' ? (
            <p className="mt-10 text-mp-ink-3" role="status">
              {index.status === 'error' ? 'The data could not be loaded.' : 'Loading the snapshot…'}
            </p>
          ) : (
            <div className="mt-12">
              <Section id="color" eyebrow="01" title="Color" note="Designed twice: Night (default) and Dawn. Each color has one job.">
                <Tokens index={index.data} />
              </Section>
              <Section id="type" eyebrow="02" title="Type" note="A serif for voice, a tight grotesk for UI, mono for every figure (tabular).">
                <Type index={index.data} />
              </Section>
              <Section id="glass" eyebrow="03" title="Glass, grain, glow" note="The map is the canvas; panels float over it and can collapse.">
                <Panels index={index.data} />
              </Section>
              <Section id="controls" eyebrow="04" title="Controls" note="Native inputs underneath, so keyboard and screen readers just work.">
                <Controls index={index.data} />
              </Section>
              <Section id="instruments" eyebrow="05" title="Instruments" note="One panel, hairline dividers: value, YoY, MoM, 3-month trend, 36-month extremes.">
                <Instruments index={index.data} />
              </Section>
              <Section id="time" eyebrow="06" title="Time machine" note="Arrows, Home/End or the play button; the month is announced.">
                <TimeMachine index={index.data} />
              </Section>
              <Section id="motion" eyebrow="07" title="Motion" note="Motion explains or guides, never decorates.">
                <Motion />
              </Section>
            </div>
          )}
        </div>
      </div>
    </AtlasChrome>
  );
}
