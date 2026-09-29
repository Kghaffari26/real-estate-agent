import { ArrowDownRight, ArrowRight, ArrowUpRight, Building2, GitCompare, Printer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LogoMark } from '../components/brand/Logo';
import { RateStrip, TimeSeriesChart, type ChartSeries } from '../components/charts';
import { Sparkline } from '../components/charts/Sparkline';
import { endLabelMargin } from '../components/charts/chartUtils';
import { AffordabilityCalculator } from '../components/data/AffordabilityCalculator';
import { AnalystNote, NarrativeBadge } from '../components/data/AnalystNote';
import { FlagCards } from '../components/data/FlagCards';
import { InvestigationBody } from '../components/data/InvestigationCard';
import { KpiCard } from '../components/data/KpiCard';
import { TemperatureComponents } from '../components/data/TemperatureComponents';
import { TemperatureGauge } from '../components/data/TemperatureGauge';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { Checkbox } from '../components/ui/Checkbox';
import { Collapsible } from '../components/ui/Collapsible';
import { CopyLinkButton } from '../components/ui/CopyLinkButton';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { Select } from '../components/ui/Select';
import { PageSkeleton } from '../components/ui/Skeleton';
import { EmptyState, ErrorState } from '../components/ui/StateViews';
import { BRAND } from '../config/brand';
import { isValidSlug } from '../data/api';
import { useIndex, useMetro } from '../data/hooks';
import type { IndexOutput, MetroDetailOutput } from '../data/schema.gen';
import { useEntityColors } from '../hooks/EntityColors';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useQueryState } from '../hooks/useQueryState';
import { withAttribution } from '../lib/attribution';
import { formatDateTime, formatMonth, formatValue } from '../lib/format';
import { buildRegistry, metricLabel, valueScale } from '../lib/metrics';
import { alignToDates, hasData, indexTo100, numericSeries, rangeStart, RANGES, seriesDates, toRows, type Range } from '../lib/series';
import { calculatorDefaults, flagViews, investigationView, metricTiles, temperatureBars, type MetricTileView } from '../viewmodels/metro';
import { NotFoundPage } from './NotFoundPage';

const RANGE_OPTIONS = RANGES.map((r) => ({ value: r, label: r }));
const TREND = {
  up: { Icon: ArrowUpRight, text: 'Rising, 3 mo' },
  down: { Icon: ArrowDownRight, text: 'Falling, 3 mo' },
  flat: { Icon: ArrowRight, text: 'Flat, 3 mo' },
} as const;

export function MetroPage() {
  const { slug } = useParams();
  const valid = isValidSlug(slug);
  const metro = useMetro(valid ? slug : '');
  const index = useIndex();
  useDocumentTitle(metro.status === 'ready' ? metro.data.name : 'Metro');

  if (!valid) return <NotFoundPage what="metro" />;
  if (metro.status === 'loading' || index.status === 'loading') return <PageSkeleton label="Loading metro…" />;
  if (metro.status === 'error') {
    if ((metro.error as { kind?: string }).kind === 'not_found') return <NotFoundPage what="metro" />;
    return <ErrorState error={metro.error} onRetry={metro.retry} />;
  }
  if (index.status === 'error') return <ErrorState error={index.error} onRetry={index.retry} />;
  return <Metro metro={metro.data} index={index.data} />;
}

function TrendChip({ tile }: { tile: MetricTileView }) {
  const trend = tile.trend ? TREND[tile.trend] : null;
  if (!trend) return null;
  return (
    <Badge title={trend.text}>
      <trend.Icon aria-hidden="true" className="h-3 w-3" />
      <span className="sr-only">{trend.text}</span>
      <span aria-hidden="true">3 mo</span>
    </Badge>
  );
}

function ExtremeBadges({ tile }: { tile: MetricTileView }) {
  if (!tile.high36 && !tile.low36) return null;
  return <Badge tone="accent">{tile.high36 ? '36-month high' : '36-month low'}</Badge>;
}

function Metro({ metro, index }: { metro: MetroDetailOutput; index: IndexOutput }) {
  const registry = useMemo(() => buildRegistry(index.metric_registry), [index]);
  const tiles = useMemo(() => metricTiles(metro, registry), [metro, registry]);
  const entityColors = useEntityColors();
  const tone = entityColors.peek(metro.slug) ?? 'cat-1';
  const [hovered, setHovered] = useState<string | null>(null);
  const dates = seriesDates(metro.series);
  const chartable = tiles.map((t) => t.key).filter((k) => hasData(numericSeries(metro.series, k)));

  const [metric, setMetric] = useQueryState('metric', chartable[0] ?? 'median_sale_price', chartable);
  const [range, setRange] = useQueryState<Range>('range', '3Y', RANGES);
  const [rates, setRates] = useQueryState<'1' | '0'>('rates', '1', ['1', '0']);
  const [vsUs, setVsUs] = useQueryState<'0' | '1'>('vs', '0', ['0', '1']);

  const entry = registry.get(metric);
  const start = rangeStart(dates, range);
  const values = (numericSeries(metro.series, metric) ?? []).slice(start);
  const nationalValues = alignToDates(dates, seriesDates(index.national.series), numericSeries(index.national.series, metric) ?? [], 5).slice(start);
  const canCompareUs = hasData(nationalValues);
  const indexed = vsUs === '1' && canCompareUs;
  const rateValues = alignToDates(dates, index.national.rates.dates, index.national.rates.mortgage30).slice(start);
  const rows = toRows(dates.slice(start), {
    [metric]: indexed ? indexTo100(values) : values,
    us: indexed ? indexTo100(nationalValues) : nationalValues,
    mortgage30: rateValues,
  });
  const cityName = metro.name.replace(/, [A-Z]{2}(-[A-Z]{2})*$/, '');
  const series: ChartSeries[] = [{ key: metric, label: `${metricLabel(registry, metric)}, ${metro.name}`, shortLabel: cityName, color: tone }];
  if (indexed) series.push({ key: 'us', label: `${metricLabel(registry, metric)}, U.S.`, shortLabel: 'U.S.', color: tone === 'cat-2' ? 'cat-1' : 'cat-2', dashed: true });

  const core = tiles.filter((t) => !['zhvi', 'zori'].includes(t.key) && !t.permits);
  const zillow = tiles.filter((t) => ['zhvi', 'zori'].includes(t.key));
  const permits = tiles.filter((t) => t.permits);
  const heroKeys = ['median_sale_price', 'homes_sold', 'median_dom'];
  const hero = heroKeys.map((k) => tiles.find((t) => t.key === k)).filter((t): t is MetricTileView => Boolean(t));
  const defaults = calculatorDefaults(metro);
  const investigation = investigationView(metro, registry);
  const spark = (key: string) => (numericSeries(metro.series, key) ?? []).slice(-36);

  // Keep a stale hover from lingering if the chips unmount.
  useEffect(() => () => setHovered(null), []);

  const kpi = (t: MetricTileView) => (
    <KpiCard
      key={t.key}
      metricKey={t.key}
      label={t.label}
      value={t.raw}
      formatValue={(v) => formatValue(v, t.format, { scale: t.scale })}
      goodDirection={t.goodDirection}
      deltas={[
        { value: t.yoy, format: t.deltaFormat, label: t.permits ? 'YoY 12-mo' : 'YoY' },
        ...(t.permits ? [] : [{ value: t.mom, format: t.deltaFormat, label: 'MoM' }]),
      ]}
      badges={<TrendChip tile={t} />}
      highlights={t.high36 || t.low36 ? <ExtremeBadges tile={t} /> : undefined}
      spark={spark(t.key)}
      sparkTone={tone}
      note={t.note}
      highlighted={hovered === t.key}
    />
  );

  return (
    <div className="space-y-6">
      {/* Print-only report header */}
      <div className="print-only mb-4 border-b border-border pb-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-md font-semibold">
            <LogoMark className="h-6 w-6" />
            {BRAND.name} · Metro report
          </span>
          <span className="text-xs">Data through {formatMonth(metro.data_through, true)}</span>
        </div>
      </div>

      {/* Hero band */}
      <section aria-labelledby="metro-title" className="card relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-accent/[0.05] via-transparent to-transparent" aria-hidden="true" />
        <div className="relative grid gap-6 p-5 sm:p-6 lg:grid-cols-[1fr_auto]">
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {metro.market_type && (
                <Badge tone="accent">
                  <Building2 aria-hidden="true" className="h-3 w-3" />
                  {metro.market_type}
                </Badge>
              )}
              {metro.stale && <Badge>Stale data</Badge>}
              <span className="text-xs text-text-3">Data through {formatMonth(metro.data_through, true)}</span>
            </div>
            <h1 id="metro-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {metro.name}
            </h1>
            <dl className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-3">
              {hero.map((t) => (
                <div key={t.key}>
                  <dt className="text-xs text-text-3">{t.label}</dt>
                  <dd className="num mt-0.5 text-lg font-semibold">{t.value}</dd>
                  <dd className="num text-xs text-text-2">{formatValue(t.yoy, t.deltaFormat, { signed: true })} YoY</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap gap-2" data-no-print>
              <Link to={`/compare?m=${metro.slug}`} className="btn">
                <GitCompare aria-hidden="true" className="h-3.5 w-3.5" />
                Compare
              </Link>
              <CopyLinkButton />
              <button type="button" className="btn" onClick={() => window.print()}>
                <Printer aria-hidden="true" className="h-3.5 w-3.5" />
                Print report
              </button>
            </div>
          </div>
          <div className="flex flex-col items-center justify-center">
            <TemperatureGauge score={metro.temperature.score} label={metro.temperature.label} basis="vs the other 49 metros" />
          </div>
        </div>
      </section>

      <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
        {core.map(kpi)}
      </section>

      <Card
        id="trend"
        title="Trend"
        subtitle={indexed ? 'Indexed: first month in range = 100' : (entry?.note ?? undefined)}
        copyLink
        exportTitle={`${metricLabel(registry, metric)}, ${metro.name}`}
        exportSubtitle={`Redfin, monthly, through ${formatMonth(metro.data_through, true)}`}
        actions={
          <>
            <Select label="Metric" hideLabel value={metric} onChange={setMetric} options={chartable.map((k) => ({ value: k, label: metricLabel(registry, k) }))} />
            <SegmentedControl label="Time range" options={RANGE_OPTIONS} value={range} onChange={setRange} />
          </>
        }
      >
        <div className="mb-3 flex flex-wrap gap-x-5" data-no-print>
          {canCompareUs && <Checkbox label="Compare with U.S. (index to 100)" checked={indexed} onChange={(on) => setVsUs(on ? '1' : '0')} />}
          <Checkbox label="30-yr mortgage rate strip" checked={rates === '1'} onChange={(on) => setRates(on ? '1' : '0')} />
        </div>
        <TimeSeriesChart
          rows={rows}
          series={series}
          axis={indexed ? { format: 'index' } : { format: entry?.format ?? 'count', scale: valueScale(entry) }}
          syncId="metro-trend"
          area={!indexed}
          annotate={!indexed}
          extremeLabel={range === '1Y' ? { high: '1-yr high', low: '1-yr low' } : { high: '36-mo high', low: '36-mo low' }}
          height={280}
          description={`${metricLabel(registry, metric)} in ${metro.name}, monthly${indexed ? ', indexed to 100 with the U.S.' : ''}`}
        />
        {rates === '1' && (
          <div className="mt-2 border-t border-border pt-3">
            <RateStrip rows={rows} dataKey="mortgage30" label="30-yr fixed mortgage rate (U.S.)" syncId="metro-trend" rightMargin={endLabelMargin(series)} />
          </div>
        )}
      </Card>

      <Collapsible title="Temperature and flags" defaultOpen>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card id="temperature" title="What drives the temperature" subtitle="Each component vs the other tracked metros (z-score). Right of center pushes the score up." copyLink>
            <TemperatureComponents bars={temperatureBars(metro, registry)} />
          </Card>
          <Card id="flags" title="Flags" subtitle="Deterministic rules on this month's numbers" copyLink>
            <FlagCards flags={flagViews(metro, registry)} />
          </Card>
        </div>
      </Collapsible>

      <Collapsible title="Analysis" defaultOpen>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card id="brief" eyebrow="Analyst note" title="Market brief" actions={<NarrativeBadge source={metro.brief.narrative_source} reused={metro.brief.reused} />} copyLink>
            <AnalystNote brief={metro.brief} compact />
          </Card>
          <Card id="investigation" eyebrow="Investigation" title="Why this is happening" copyLink>
            {investigation ? (
              <InvestigationBody view={investigation} onHoverMetric={setHovered} />
            ) : (
              <EmptyState title="Not investigated this run">The AI investigator looks into up to 3 metros per run: those with a new major flag, else the top mover.</EmptyState>
            )}
          </Card>
        </div>
      </Collapsible>

      <Collapsible title="Home values, rents and permits">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card id="zillow" eyebrow="Zillow Research" title="Home values and rents" copyLink>
            <MiniMetrics tiles={zillow} spark={spark} tone={tone} empty={<EmptyState compact title="Not published for this metro">Zillow reports this area only as part of its larger metro, so there's no separate index.</EmptyState>} />
          </Card>
          <Card id="permits" eyebrow="U.S. Census Bureau" title="Building permits" copyLink>
            <MiniMetrics
              tiles={permits}
              spark={spark}
              tone={tone}
              empty={<EmptyState compact title="Permits coming soon">Metro-level permits will appear once the Census Bureau's monthly metro file is wired in. National starts and permits are on the Overview.</EmptyState>}
            />
          </Card>
        </div>
      </Collapsible>

      <Collapsible title="Affordability">
        <Card id="affordability" title="Affordability calculator" subtitle="Prefilled with this metro's median price and the latest 30-yr rate" copyLink>
          {defaults ? (
            <>
              <AffordabilityCalculator key={metro.slug} defaults={defaults} />
              {metro.affordability && (
                <p className="num mt-4 border-t border-border pt-3 text-xs text-text-3">
                  Published estimate: {formatValue(metro.affordability.payment_now, 'currency')}/mo now vs {formatValue(metro.affordability.payment_year_ago, 'currency')} a year ago ({formatValue(metro.affordability.payment_change_pct, 'percent_signed')}), with {formatValue(metro.affordability.assumptions.rate_year_ago, 'percent', { scale: 'points' })} rates and a {formatValue(metro.affordability.assumptions.price_year_ago, 'currency')} price a year ago.
                </p>
              )}
            </>
          ) : (
            <EmptyState compact title="Not available">This metro has no price or rate to start from.</EmptyState>
          )}
        </Card>
      </Collapsible>

      <footer className="print-only mt-6 border-t border-border pt-2 text-2xs">
        {withAttribution(index.sources)
          .map((s) => s.attribution ?? s.name)
          .join(' · ')}{' '}
        · Generated {formatDateTime(index.meta.finished_at)} · {BRAND.siteUrl}
      </footer>
    </div>
  );
}

/** Zillow/permit metrics: value + YoY + a sparkline each, or one friendly empty state when all are null. */
function MiniMetrics({ tiles, spark, tone, empty }: { tiles: readonly MetricTileView[]; spark: (key: string) => (number | null)[]; tone: Parameters<typeof Sparkline>[0]['tone']; empty: React.ReactNode }) {
  const present = tiles.filter((t) => t.raw !== null || hasData(spark(t.key)));
  if (present.length === 0) return <>{empty}</>;
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {present.map((t) => (
        <li key={t.key} className="well p-3">
          <p className="text-xs text-text-3">{t.label}</p>
          <div className="mt-1 flex items-end justify-between gap-3">
            <div>
              <p className="num text-lg font-semibold">{t.value}</p>
              <p className="num text-xs text-text-2">
                {formatValue(t.yoy, t.deltaFormat, { signed: true })} {t.permits ? 'YoY (12-mo)' : 'YoY'}
              </p>
            </div>
            <Sparkline values={spark(t.key)} tone={tone} className="h-10 w-28" />
          </div>
          {t.note && <p className="mt-1 text-2xs text-text-3">{t.note}</p>}
        </li>
      ))}
    </ul>
  );
}
