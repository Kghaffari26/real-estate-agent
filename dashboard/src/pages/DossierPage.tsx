/**
 * The metro dossier (spec §7.3, M5): the 3D house in temperature light over the
 * region plate, the instrument cluster, the story with chips that drive the chart,
 * the annotated chart + rate strip, the temperature drivers, Zillow and permits, and
 * affordability. Every number is the metro file's or the index's.
 */
import { AlertTriangle, ArrowRight, BarChart3, Building2, CheckCircle2, Info, OctagonAlert, Plane } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { DossierChart } from '../dossier/DossierChart';
import { Drivers, HouseStage, RegionPlate } from '../dossier/parts';
import { fmtChange, fmtMetric, signOf, toneClass } from '../atlas/format';
import { isValidSlug, loadArea, loadTimeline } from '../data/api';
import { useIndex, useMetro, usePulse } from '../data/hooks';
import type { IndexOutput, MetricRegistryEntry, MetroDetailOutput } from '../data/schema.gen';
import { useResource } from '../data/useResource';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useIsDark, usePrefersReducedMotion } from '../hooks/useMediaQuery';
import { useSetQuery } from '../hooks/useQueryState';
import { parseChannels } from '../lib/columns';
import { houseScale, regionOf, statesOf, temperatureDrivers, temperatureLight } from '../lib/dossier';
import { formatDate, formatDelta, formatMonth, formatValue } from '../lib/format';
import { sentences } from '../lib/text';
import { AtlasChrome } from '../ui/AtlasChrome';
import { metroPath, useMediaPaused } from '../ui/atlasState';
import { Chip, Segmented } from '../ui/controls';
import { MiniSpark, ThermalArc } from '../ui/dataviz';
import { GlassPanel } from '../ui/Glass';
import { Instrument } from '../ui/Instrument';
import { dossierChart, INSTRUMENT_KEYS, type ChartMode, type ChartRange } from '../viewmodels/dossier';
import { metroPulse } from '../viewmodels/pulse';


const RANGES: ChartRange[] = ['1Y', '3Y', 'All'];

export function DossierPage() {
  const { slug = '' } = useParams();
  const index = useIndex();
  const metro = useMetro(isValidSlug(slug) ? slug : '');
  useDocumentTitle(metro.status === 'ready' ? metro.data.name : null);
  return (
    <AtlasChrome>
      {index.status === 'ready' && metro.status === 'ready' ? (
        <Dossier key={slug} index={index.data} m={metro.data} />
      ) : (
        <div className="grid min-h-[70vh] place-items-center px-6 text-center" role="status">
          <div>
            <p className="mp-display text-[34px]">{metro.status === 'error' ? 'We don’t track a metro at that address.' : 'Loading the dossier…'}</p>
            {metro.status === 'error' && (
              <Link to="/explore" className="mt-4 inline-block text-mp-accent">
                Browse the atlas
              </Link>
            )}
          </div>
        </div>
      )}
    </AtlasChrome>
  );
}

function statusIcon(severity: string) {
  if (severity === 'major') return <OctagonAlert size={13} strokeWidth={1.5} className="text-mp-bad" aria-hidden="true" />;
  if (severity === 'notable') return <AlertTriangle size={13} strokeWidth={1.5} className="text-mp-warn" aria-hidden="true" />;
  return <Info size={13} strokeWidth={1.5} className="text-mp-ink-3" aria-hidden="true" />;
}

function Dossier({ index, m }: { index: IndexOutput; m: MetroDetailOutput }) {
  const [params] = useSearchParams();
  const setQuery = useSetQuery();
  const dark = useIsDark();
  const reduce = usePrefersReducedMotion();
  const [mediaPaused] = useMediaPaused();
  const chartRef = useRef<HTMLElement>(null);
  const [highlight, setHighlight] = useState<string | null>(null);

  const registry = useMemo(() => new Map(index.metric_registry.map((r) => [r.key, r])), [index.metric_registry]);
  const reg = (key: string) => registry.get(key) as MetricRegistryEntry;
  const chartKeys = INSTRUMENT_KEYS.filter((k) => registry.has(k) && m.series[k]);
  // `?m=` (v2) or v1's `?metric=`, so old shared links keep their chart.
  const wanted = params.get('m') ?? params.get('metric');
  const metricKey = chartKeys.includes(wanted as (typeof chartKeys)[number]) ? (wanted as string) : 'median_sale_price';
  const metric = reg(metricKey);
  const range = (RANGES as string[]).includes(params.get('range') ?? '') ? (params.get('range') as ChartRange) : '3Y';
  const mode: ChartMode = params.get('mode') === 'yoy' ? 'yoy' : 'level';
  const indexed = params.get('vs') === '1';
  const lowTier = params.get('tier') === 'low';

  // "All" reaches back to 2012 when the metric has a published timeline (§6.4).
  const ref = index.timelines.find((t) => t.metric === metricKey);
  const slugs = useMemo(() => index.metros.map((x) => x.slug), [index.metros]);
  const timeline = useResource(range === 'All' && ref ? `timeline:${metricKey}:true` : 'timeline:none', () =>
    range === 'All' && ref ? loadTimeline(metricKey, slugs, { compact: true }) : Promise.resolve(null),
  );
  const chart = dossierChart({ detail: m, metric, range, mode, indexed, national: index.national.series, timeline: timeline.status === 'ready' ? timeline.data : null });

  // ---------- the house ----------
  const usMedian = index.national.latest.median_sale_price?.value ?? index.key_stats.find((k) => k.format.startsWith('currency'))?.value ?? null;
  const price = m.latest.median_sale_price?.value ?? null;
  const light = useMemo(() => {
    const css = getComputedStyle(document.documentElement);
    const g = (n: string) => parseChannels(css.getPropertyValue(`--mp-${n}`));
    return temperatureLight(m.temperature.score, { cold: g('cold-light'), neutral: g('mid'), warm: g('warm-light') });
    // Recompute when the theme flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.temperature.score, dark]);
  const scale = houseScale(price, usMedian);
  const region = regionOf(m.name);
  const states = statesOf(m.name);
  const shortName = m.name.replace(/,\s*[A-Z-]+$/, '');
  const temp = m.temperature.score;
  const tempTone = temp == null ? 'neutral' : temp >= 60 ? 'hot' : temp <= 40 ? 'cool' : 'neutral';

  // ---------- chips that drive the chart ----------
  const cited = useMemo(() => {
    const keys = new Set<string>(m.investigation?.cited_metrics ?? []);
    for (const f of m.flags) for (const k of Object.keys(f.facts ?? {})) keys.add(k.replace(/_(yoy|mom|pp|diff|12m)$/, '').replace(/_yoy_pp$/, ''));
    for (const k of ['median_sale_price', 'inventory', 'median_dom', 'months_of_supply']) keys.add(k);
    return [...keys].filter((k) => chartKeys.includes(k as (typeof chartKeys)[number]));
  }, [m, chartKeys]);
  const focusMetric = (key: string) => {
    setQuery({ m: key === 'median_sale_price' ? null : key });
    setHighlight(key);
    chartRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  };
  useEffect(() => {
    if (!highlight) return;
    const id = window.setTimeout(() => setHighlight(null), 2600);
    return () => window.clearTimeout(id);
  }, [highlight]);

  const head: Array<[string, string]> = [
    ['median_sale_price', 'Median sale price'],
    ['median_dom', 'Days on market'],
    ['inventory', 'Active inventory'],
  ];
  const fmt = (v: number | null | undefined) => (indexed && chart.canIndex ? (v == null ? '—' : v.toFixed(1)) : mode === 'yoy' ? fmtChange(metric, v) : fmtMetric(metric, v));
  const aff = m.affordability;
  const brief = m.brief;
  const zhvi = m.latest.zhvi;
  const zori = m.latest.zori;
  const permits = m.latest.permits_total;
  const yoyOf = (v: MetroDetailOutput['latest'][string] | undefined) => (v && 'yoy' in v ? v.yoy : null);

  return (
    <article aria-labelledby="metro-h">
      {/* ---------- hero ---------- */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-mp-bg-2/40" aria-hidden="true" />
        <RegionPlate region={region} dark={dark} />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgb(var(--mp-bg))_0%,rgb(var(--mp-bg)/.86)_38%,rgb(var(--mp-bg)/.1)_70%),linear-gradient(0deg,rgb(var(--mp-bg))_0%,transparent_30%)]" aria-hidden="true" />
        <span className="absolute right-4 top-4 z-10 rounded-full border border-mp-line bg-mp-bg/60 px-2 py-0.5 text-[11px] text-mp-ink-3" title="An abstract plate for the region, not a photo of this metro">
          Illustrative · {region ?? 'U.S.'}
        </span>
        <div className="relative mx-auto grid max-w-[1320px] gap-6 px-4 pb-10 pt-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)] lg:pb-14">
          <div className="min-w-0">
            <nav aria-label="Breadcrumb" className="text-sm text-mp-ink-3">
              <Link to="/explore" className="text-mp-ink-3 no-underline hover:text-mp-ink">
                Atlas
              </Link>{' '}
              / {region ?? 'U.S.'} / <span className="text-mp-ink-2">{m.name}</span>
            </nav>
            <h1 id="metro-h" className="mp-display mt-4 text-[64px] leading-[0.92] sm:text-[104px]">
              {shortName}
              {states && <span className="ml-3 align-baseline font-ui text-[0.3em] font-medium tracking-normal text-mp-ink-3">{states}</span>}
            </h1>
            <div className="mt-5 flex flex-wrap gap-2">
              <Chip dot tone={tempTone === 'hot' ? 'hot' : tempTone === 'cool' ? 'cool' : 'neutral'}>{m.temperature.label ?? 'No temperature'} market</Chip>
              {m.market_type && <Chip>{m.market_type}</Chip>}
              {m.flags.map((f) => (
                <Chip key={f.id} icon={statusIcon(f.severity)} title={`${f.severity} flag`}>
                  {f.label}
                </Chip>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap items-end gap-x-10 gap-y-6">
              <div className="flex items-end gap-3">
                <div>
                  <ThermalArc score={temp} label={m.temperature.label ?? ''} />
                  <div className="mp-label -mt-1 text-center">Temperature</div>
                </div>
                <div className="mp-num-hero text-[60px] leading-[0.9]" style={{ color: `rgb(${light.rim.join(',')})` }} data-testid="temperature">
                  {temp ?? '—'}
                  <span className="text-[18px] text-mp-ink-3">/100</span>
                </div>
              </div>
              <dl className="flex flex-wrap gap-x-10 gap-y-4" data-testid="headline-stats">
                {head.map(([k, labelText]) => (
                  <div key={k}>
                    <dt className="mp-label">{labelText}</dt>
                    <dd className="mp-num-hero mt-1 text-[28px]">{fmtMetric(reg(k), m.latest[k]?.value)}</dd>
                    <dd className={`mp-num text-[13px] ${toneClass(yoyOf(m.latest[k]))}`}>
                      {fmtChange(reg(k), yoyOf(m.latest[k]))} <span className="font-ui text-mp-ink-3">YoY</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="mt-8 flex flex-wrap gap-2.5">
              <Link to={`/explore?sel=${m.slug}&cam=${m.lon ?? -96},${m.lat ?? 38},6.2,52,-12`} className="inline-flex h-11 items-center gap-2 rounded-control bg-mp-accent px-4 text-sm font-medium text-mp-accent-ink no-underline" data-testid="fly-there">
                <Plane size={15} strokeWidth={1.5} aria-hidden="true" /> Fly there
              </Link>
              <a href="#afford" className="inline-flex h-11 items-center gap-2 rounded-control border border-mp-line px-4 text-sm text-mp-ink no-underline">
                Affordability <ArrowRight size={15} strokeWidth={1.5} aria-hidden="true" />
              </a>
              <Link to={`/compare?m=${m.slug}`} className="inline-flex h-11 items-center gap-2 rounded-control border border-mp-line px-4 text-sm text-mp-ink no-underline">
                <BarChart3 size={15} strokeWidth={1.5} aria-hidden="true" /> Compare with…
              </Link>
            </div>
          </div>
          <div className="relative min-h-[320px] lg:min-h-[480px]">
            <HouseStage className="absolute inset-0" scale={scale} rim={light.rim} lean={light.lean} dark={dark} animate={!reduce && !mediaPaused} lowTier={lowTier} />
            <p className="sr-only" data-testid="house-summary">
              A stylized house sized {scale.toFixed(2)} times the U.S. median price ({formatValue(price, 'currency')} vs {formatValue(usMedian, 'currency')}), lit {light.side < 0 ? 'cool blue' : light.side > 0 ? 'warm amber' : 'neutral'} for a temperature of {temp ?? 'unknown'}.
            </p>
            <p className="absolute bottom-0 right-0 max-w-[260px] text-right text-[11px] text-mp-ink-3" aria-hidden="true">
              House scale {scale.toFixed(2)}× the U.S. median price; light from the market temperature.
            </p>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1320px] space-y-8 px-4 pb-20 sm:px-8">
        {/* ---------- instruments ---------- */}
        <section aria-label="Instruments">
          <GlassPanel className="flex overflow-x-auto" role="region" aria-label={`${m.name} instruments (scrolls sideways)`} tabIndex={0}>
            {INSTRUMENT_KEYS.filter((k) => m.latest[k] && registry.has(k)).map((k, i) => {
              const v = m.latest[k]!;
              const full = 'mom' in v ? v : null;
              return (
                <div key={k} className={i ? 'border-l border-mp-line' : ''} data-instrument={k}>
                  <Instrument
                    id={`instrument-${k}`}
                    wide={i === 0}
                    label={reg(k).label}
                    value={fmtMetric(reg(k), v.value)}
                    yoy={fmtChange(reg(k), yoyOf(v))}
                    yoySign={signOf(yoyOf(v))}
                    mom={full ? fmtChange(reg(k), full.mom) : undefined}
                    trend={full?.trend_3m}
                    series={(m.series[k] as Array<number | null>) ?? undefined}
                    extreme={full?.high_36m ? '36-mo high' : full?.low_36m ? '36-mo low' : null}
                    highlighted={highlight === k || (highlight == null && metricKey === k)}
                  />
                </div>
              );
            })}
          </GlassPanel>
        </section>

        {/* ---------- chart + story ---------- */}
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
          <section ref={chartRef} aria-labelledby="chart-h" className="min-w-0 scroll-mt-24">
            <GlassPanel className="p-5 sm:p-6">
              <div className="flex flex-wrap items-center gap-3">
                <h2 id="chart-h" className="mp-display mr-auto text-[28px]">
                  {metric.label}
                </h2>
                <Segmented label="Show" size="sm" value={mode} onChange={(v) => setQuery({ mode: v === 'level' ? null : v, vs: v === 'yoy' ? null : params.get('vs') })} options={[{ value: 'level', label: 'Level' }, { value: 'yoy', label: 'YoY' }]} />
                <Segmented label="Range" size="sm" value={range} onChange={(v) => setQuery({ range: v === '3Y' ? null : v })} options={RANGES.map((r) => ({ value: r, label: r }))} />
                <label className={`flex items-center gap-2 text-xs ${chart.canIndex ? 'text-mp-ink-2' : 'text-mp-ink-3'}`}>
                  <input type="checkbox" className="accent-[rgb(var(--mp-accent))]" checked={indexed && chart.canIndex} disabled={!chart.canIndex} onChange={(e) => setQuery({ vs: e.target.checked ? '1' : null })} />
                  Index to U.S.
                </label>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm text-mp-ink-2">
                Metric
                <select className="rounded-control border border-mp-line bg-mp-panel px-2 py-1 text-sm text-mp-ink" value={metricKey} onChange={(e) => setQuery({ m: e.target.value === 'median_sale_price' ? null : e.target.value })}>
                  {chartKeys.map((k) => (
                    <option key={k} value={k}>
                      {reg(k).label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="mt-5">
                <DossierChart
                  dates={chart.dates}
                  metro={chart.metro}
                  national={chart.national}
                  rateDates={index.national.rates.dates}
                  rates={index.national.rates.mortgage30}
                  fmt={fmt}
                  fmtRate={(v) => formatValue(v, 'percent', { scale: 'points' })}
                  fmtDate={(d) => formatMonth(d, true)}
                  zeroLine={mode === 'yoy'}
                  label={`${metric.label}${mode === 'yoy' ? ', change from a year ago' : indexed && chart.canIndex ? ', indexed to 100' : ''}`}
                  metroName={m.name}
                />
              </div>
              <p className="mt-3 text-xs text-mp-ink-3">
                {chart.span === 'timeline' ? `Monthly since ${formatMonth(chart.dates[0], true)} (§6.4 timeline). ` : range === 'All' && !ref ? 'This metric’s published history is the last 36 months. ' : ''}
                {mode === 'yoy' ? 'Past months’ YoY is derived from the published levels (value vs 12 months earlier); the latest is the published figure. ' : ''}
                {indexed && chart.canIndex ? 'Both lines rebased to 100 at the start of the range. ' : ''}
                The 30-year rate is its own strip, never a second axis.
              </p>
            </GlassPanel>
          </section>

          <section aria-labelledby="story-h">
            <div className="mp-label text-mp-accent">The story</div>
            <h2 id="story-h" className="sr-only">
              The story
            </h2>
            <div className="mt-3 space-y-3">
              {sentences(brief.text).map((s, i) => (
                <p key={i} className={i === 0 ? 'mp-display text-[24px] italic leading-[1.25]' : 'text-[15px] text-mp-ink-2'}>
                  {s}
                </p>
              ))}
            </div>
            {m.investigation && (
              <GlassPanel as="aside" className="mt-5 p-4" aria-label="Why this is happening">
                <div className="mp-label">Why this is happening · {m.investigation.trigger_label}</div>
                <p className="mt-2 text-sm text-mp-ink">{m.investigation.explanation}</p>
              </GlassPanel>
            )}
            <div className="mt-5">
              <div className="mp-label mb-2">See it in the numbers</div>
              <div className="flex flex-wrap gap-1.5" data-testid="cited-chips">
                {cited.map((k) => (
                  <Chip key={k} selected={metricKey === k} onClick={() => focusMetric(k)}>
                    {reg(k).label}
                  </Chip>
                ))}
              </div>
            </div>
            <p className="mt-4 flex items-start gap-1.5 text-xs text-mp-ink-3">
              <Info size={13} strokeWidth={1.5} className="mt-0.5 flex-none" aria-hidden="true" />
              {brief.narrative_source === 'llm' ? 'Narrated by Claude from facts computed in code; every figure is checked against them.' : 'Written from a template of the computed facts.'}
            </p>
          </section>
        </div>

        {/* ---------- the weekly pulse and the counties (§6.6, §6.7; shown only when published) ---------- */}
        <WeeklyAndCounties index={index} m={m} />

        {/* ---------- drivers, Zillow, permits ---------- */}
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <Panel id="drivers" title="What drives the temperature" note="Each component against the other tracked metros (z-score). Right of center heats the market.">
            <Drivers drivers={temperatureDrivers(m.temperature.components)} />
          </Panel>
          <div className="space-y-8">
            <Panel id="zillow" title="Home values and rents" note="Zillow Research: ZHVI and ZORI.">
              {zhvi?.value == null && zori?.value == null ? (
                <Empty icon={<Building2 size={18} strokeWidth={1.5} aria-hidden="true" />}>Zillow doesn’t publish this metro’s home value or rent index.</Empty>
              ) : (
                <dl className="grid grid-cols-2 gap-4">
                  {([['zhvi', 'Typical home value'], ['zori', 'Typical rent']] as const).map(([k, labelText]) => (
                    <div key={k}>
                      <dt className="mp-label">{labelText}</dt>
                      <dd className="mp-num-hero mt-1 text-[26px]">{fmtMetric(reg(k), m.latest[k]?.value)}</dd>
                      <dd className={`mp-num text-xs ${toneClass(yoyOf(m.latest[k]))}`}>{fmtChange(reg(k), yoyOf(m.latest[k]))} YoY</dd>
                    </div>
                  ))}
                </dl>
              )}
            </Panel>
            <Panel id="permits" title="Building permits" note="U.S. Census Bureau, Building Permits Survey.">
              {permits?.value == null ? (
                <Empty icon={<Building2 size={18} strokeWidth={1.5} aria-hidden="true" />}>
                  Not in this run: the agent skips the Census permits feed until its monthly metro file is verified, so it publishes nothing rather than a guess.
                </Empty>
              ) : (
                <div className="mp-num-hero text-[26px]">{fmtMetric(reg('permits_total'), permits.value)}</div>
              )}
            </Panel>
          </div>
        </div>

        {/* ---------- affordability ---------- */}
        <section id="afford" aria-labelledby="afford-h" className="scroll-mt-24">
          <GlassPanel className="grid gap-6 p-6 sm:p-8 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <div className="mp-label text-mp-accent">Affordability</div>
              <h2 id="afford-h" className="mp-display mt-2 text-[32px]">
                What the median home costs a month
              </h2>
              {aff ? (
                <dl className="mt-5 flex flex-wrap gap-x-12 gap-y-4">
                  <div>
                    <dt className="mp-label">Payment now</dt>
                    <dd className="mp-num-hero mt-1 text-[36px]">{formatValue(aff.payment_now, 'currency')}</dd>
                    <dd className="text-xs text-mp-ink-3">
                      principal + interest at {formatValue(aff.assumptions.rate_now, 'percent', { scale: 'points' })}, {formatValue(aff.assumptions.down_payment_pct, 'percent', { decimals: 0 })} down
                    </dd>
                  </div>
                  <div>
                    <dt className="mp-label">A year ago</dt>
                    <dd className="mp-num-hero mt-1 text-[36px] text-mp-ink-2">{formatValue(aff.payment_year_ago, 'currency')}</dd>
                    <dd className={`mp-num text-xs ${toneClass(aff.payment_change_pct)}`}>{formatValue(aff.payment_change_pct, 'percent_signed')}</dd>
                  </div>
                  <div>
                    <dt className="mp-label">Share of income</dt>
                    <dd className="mt-2 max-w-[220px] text-sm text-mp-ink-2">
                      {aff.payment_to_income != null ? formatValue(aff.payment_to_income, 'percent') : 'Needs income data: Census ACS income isn’t in this run.'}
                    </dd>
                  </div>
                </dl>
              ) : (
                <Empty icon={<Info size={18} strokeWidth={1.5} aria-hidden="true" />}>No affordability figures for this metro this run.</Empty>
              )}
            </div>
            {aff && (
              <Link to={`${metroPath(m.slug)}/afford`} className="inline-flex h-11 items-center gap-2 rounded-control bg-mp-accent px-4 text-sm font-medium text-mp-accent-ink no-underline" data-testid="open-studio">
                Open the affordability studio <ArrowRight size={15} strokeWidth={1.5} aria-hidden="true" />
              </Link>
            )}
          </GlassPanel>
        </section>

        <p className="flex items-center gap-2 text-xs text-mp-ink-3">
          <CheckCircle2 size={13} strokeWidth={1.5} aria-hidden="true" />
          Data through {formatMonth(m.data_through, true)} · 30-yr rate as of {formatDate(index.rates_as_of)} · Redfin, a national real estate brokerage; Zillow Research; FRED.
        </p>
      </div>
    </article>
  );
}

function Panel({ id, title, note, children }: { id: string; title: string; note: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24">
      <h2 id={`${id}-h`} className="mp-display text-[26px]">
        {title}
      </h2>
      <p className="mt-1 text-xs text-mp-ink-3">{note}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Empty({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-panel border border-dashed border-mp-line p-4 text-sm text-mp-ink-2">
      <span className="mt-0.5 text-mp-ink-3">{icon}</span>
      <p>{children}</p>
    </div>
  );
}

function WeeklyAndCounties({ index, m }: { index: IndexOutput; m: MetroDetailOutput }) {
  const pulse = usePulse(Boolean(index.pulse));
  const listed = index.areas.some((a) => a.slug === m.slug);
  const area = useResource(`area:${m.slug}:${listed}`, () => (listed ? loadArea(m.slug) : Promise.resolve(null)));
  const weekly = pulse.status === 'ready' && pulse.data ? metroPulse(pulse.data, m.slug) : null;
  const counties = area.status === 'ready' && area.data?.areas.length ? area.data : null;
  if (!weekly && !counties) return null;
  const through = weekly ? weekly.weeks[weekly.weeks.length - 1]! : null;
  return (
    <div className={`grid gap-8 ${weekly && counties ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : ''}`}>
      {weekly && through && (
        <Panel id="weekly" title="The last 12 weeks" note={`Redfin weekly data: each point is the ${weekly.windowWeeks} weeks ending that date; the latest ends ${formatDate(through)}. YoY vs the window a year earlier.`}>
          <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2" data-testid="weekly-pulse">
            {weekly.rows.map((r) => (
              <div key={r.key}>
                <dt className="mp-label">{r.label}</dt>
                <dd className="mt-1 flex items-end justify-between gap-3">
                  <span>
                    <span className="mp-num-hero block text-[24px]">{formatValue(r.latest, r.format === 'currency' ? 'currency' : 'count')}</span>
                    <span className={`mp-num text-xs ${toneClass(r.yoy)}`}>{formatDelta(r.yoy, 'percent_signed')} YoY</span>
                  </span>
                  <MiniSpark values={r.values} width={84} height={28} marks={false} />
                </dd>
              </div>
            ))}
          </dl>
        </Panel>
      )}
      {counties && (
        <Panel id="counties" title="County by county" note={`Redfin county data, ${formatMonth(counties.data_through, true)}. YoY computed by the agent from the same county a year earlier.`}>
          <div className="relative max-h-[320px] overflow-auto" tabIndex={0} role="region" aria-label="Counties in this metro">
            <table className="w-full border-collapse text-sm" data-testid="county-table">
              <caption className="sr-only">Counties in {m.name}: median sale price, its change from a year earlier, and homes sold</caption>
              <thead className="sticky top-0 bg-mp-bg">
                <tr className="border-b border-mp-line text-left text-mp-ink-3">
                  <th scope="col" className="py-2 pr-3 font-normal">
                    County
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-normal">
                    Median price
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-normal">
                    YoY
                  </th>
                  <th scope="col" className="py-2 text-right font-normal">
                    Homes sold
                  </th>
                </tr>
              </thead>
              <tbody>
                {counties.areas.map((a) => (
                  <tr key={a.name} className="border-b border-mp-line/60">
                    <th scope="row" className="py-2 pr-3 text-left font-normal text-mp-ink">
                      {a.name.replace(/,\s*[A-Z]{2}$/, '')}
                    </th>
                    <td className="mp-num py-2 pr-3 text-right text-mp-ink">{formatValue(a.median_sale_price, 'currency_compact')}</td>
                    <td className={`mp-num py-2 pr-3 text-right ${toneClass(a.median_sale_price_yoy)}`}>{formatDelta(a.median_sale_price_yoy, 'percent_signed')}</td>
                    <td className="mp-num py-2 text-right text-mp-ink-2">{formatValue(a.homes_sold, 'count')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
