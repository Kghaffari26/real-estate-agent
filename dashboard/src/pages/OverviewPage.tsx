import { ArrowRight, Table2 } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TimeSeriesChart } from '../components/charts';
import { Sparkline } from '../components/charts/Sparkline';
import { AlertCards } from '../components/data/AlertCards';
import { AnalystNote, NarrativeBadge } from '../components/data/AnalystNote';
import { HeatGrid, HeatLegend } from '../components/data/HeatGrid';
import { InvestigationTeaser } from '../components/data/InvestigationCard';
import { KpiCard } from '../components/data/KpiCard';
import { RankedBars } from '../components/data/RankedBars';
import { TemperatureGauge } from '../components/data/TemperatureGauge';
import { MetroMap } from '../components/map';
import { MapLegend } from '../components/map/MapLegend';
import { Card } from '../components/ui/Card';
import { CopyLinkButton } from '../components/ui/CopyLinkButton';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { Select } from '../components/ui/Select';
import { PageSkeleton } from '../components/ui/Skeleton';
import { EmptyState, ErrorState } from '../components/ui/StateViews';
import { useIndex } from '../data/hooks';
import type { IndexOutput } from '../data/schema.gen';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useQueryState } from '../hooks/useQueryState';
import { formatDate, formatMonth, formatValue } from '../lib/format';
import { buildRegistry, deltaFormat, metricLabel, valueScale } from '../lib/metrics';
import { numericSeries, rangeStart, RANGES, seriesDates, toRows, type Range } from '../lib/series';
import { legendSteps, mapPoints, sizeLegend } from '../viewmodels/map';
import { buildMetroRows, metricColumns, metricsWithData } from '../viewmodels/metros';
import { alertViews, heatCells, investigationSummaryViews, moverRows, nationalMetricKeys } from '../viewmodels/overview';

const RANGE_OPTIONS = RANGES.map((r) => ({ value: r, label: r }));
const KPI_KEYS = ['median_sale_price', 'inventory', 'homes_sold', 'median_dom', 'price_drops'] as const;

export function OverviewPage() {
  useDocumentTitle('Overview');
  const index = useIndex();
  if (index.status === 'loading') return <PageSkeleton label="Loading the national overview…" />;
  if (index.status === 'error') return <ErrorState error={index.error} onRetry={index.retry} />;
  return <Overview index={index.data} />;
}

function Overview({ index }: { index: IndexOutput }) {
  const navigate = useNavigate();
  const registry = useMemo(() => buildRegistry(index.metric_registry), [index]);
  const national = index.national;
  const metricKeys = useMemo(() => nationalMetricKeys(index), [index]);
  const rows = useMemo(() => buildMetroRows(index), [index]);
  const mappable = useMemo(() => metricsWithData(metricColumns(registry, rows), rows), [registry, rows]);

  const [metric, setMetric] = useQueryState('metric', metricKeys[0] ?? 'median_sale_price', metricKeys);
  const [range, setRange] = useQueryState<Range>('range', '3Y', RANGES);
  const [rateRange, setRateRange] = useQueryState<Range>('rates', '3Y', RANGES);
  const [mapMetric, setMapMetric] = useQueryState('map', 'median_sale_price', mappable);

  const entry = registry.get(metric);
  const dates = seriesDates(national.series);
  const start = rangeStart(dates, range);
  const nationalRows = toRows(dates.slice(start), { [metric]: (numericSeries(national.series, metric) ?? []).slice(start) });

  const rateStart = rangeStart(national.rates.dates, rateRange);
  const rateRows = toRows(national.rates.dates.slice(rateStart), {
    mortgage30: national.rates.mortgage30.slice(rateStart),
    mortgage15: national.rates.mortgage15.slice(rateStart),
  });
  const construction = national.construction;
  const constructionRows = toRows(seriesDates(construction.series), {
    housing_starts: numericSeries(construction.series, 'housing_starts') ?? [],
    permits: numericSeries(construction.series, 'permits') ?? [],
  });
  const points = useMemo(() => mapPoints(rows, registry, mapMetric), [rows, registry, mapMetric]);
  const rates = national.rates;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section aria-labelledby="headline" className="card relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-accent/[0.06] via-transparent to-transparent" aria-hidden="true" />
        <div className="relative grid gap-6 p-5 sm:p-6 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="min-w-0">
            <p className="eyebrow">U.S. housing market · {formatMonth(index.data_through, true)}</p>
            <h1 id="headline" className="mt-2 max-w-3xl text-xl font-semibold leading-tight tracking-tight sm:text-2xl lg:text-[28px] lg:leading-9">
              {index.headline}
            </h1>
            <p className="mt-2 text-sm text-text-3">
              Redfin data through {formatMonth(index.data_through, true)} · 30-yr rate {formatValue(rates.latest.mortgage30, 'percent', { scale: 'points' })} as of {formatDate(index.rates_as_of)}
            </p>
            <div className="mt-4 flex flex-wrap gap-2" data-no-print>
              <Link to="/metros" className="btn btn-primary">
                Explore all metros
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
              </Link>
              <CopyLinkButton />
            </div>
          </div>
          <div className="flex flex-col items-center gap-1">
            <TemperatureGauge score={national.temperature.score} label={national.temperature.label} basis={national.temperature.basis} />
            <Link to="/about?section=temperature" className="text-2xs">
              How temperature works
            </Link>
          </div>
        </div>
      </section>

      {/* KPIs */}
      <section aria-label="Key national metrics" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-6">
        <KpiCard
          label="30-yr fixed mortgage"
          value={rates.latest.mortgage30}
          formatValue={(v) => formatValue(v, 'percent', { scale: 'points' })}
          scale="points"
          deltas={[{ value: rates.latest.mortgage30_change_1w_pp, format: 'pp_signed', label: '1 wk' }]}
          spark={rates.mortgage30.slice(-52)}
          sparkTone="cat-2"
          note={`Year ago ${formatValue(rates.latest.mortgage30_year_ago, 'percent', { scale: 'points' })}`}
        />
        {KPI_KEYS.map((key) => {
          const v = national.latest[key];
          if (!v) return null;
          const e = registry.get(key);
          const fmt = deltaFormat(e, v.delta_format);
          return (
            <KpiCard
              key={key}
              label={metricLabel(registry, key)}
              value={v.value}
              formatValue={(x) => formatValue(x, e?.format, { scale: valueScale(e) })}
              goodDirection={e?.good_direction}
              deltas={[
                { value: v.yoy, format: fmt, label: 'YoY' },
                { value: v.mom, format: fmt, label: 'MoM' },
              ]}
              spark={numericSeries(national.series, key) ?? undefined}
            />
          );
        })}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card id="national-brief" eyebrow="Analyst note" title="The national picture" className="lg:col-span-2" actions={<NarrativeBadge source={national.brief.narrative_source} reused={national.brief.reused} />} copyLink>
          <AnalystNote brief={national.brief} />
        </Card>
        <div className="grid gap-6">
          <Card id="case-shiller" eyebrow="S&P CoreLogic Case-Shiller" title="U.S. home price index">
            {national.case_shiller ? (
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="num text-2xl font-semibold tracking-tight">{formatValue(national.case_shiller.value, 'decimal1')}</p>
                  <p className="mt-1 text-xs text-text-3">{formatMonth(national.case_shiller.period, true)} · lags ~2 months</p>
                </div>
                <p className="num text-sm font-medium text-text-2">{formatValue(national.case_shiller.yoy, 'percent_signed')} YoY</p>
              </div>
            ) : (
              <EmptyState compact>Case-Shiller data isn't available in this run.</EmptyState>
            )}
          </Card>
          <Card id="construction-summary" eyebrow="Census via FRED" title="New construction">
            <dl className="grid grid-cols-2 gap-4">
              {(['housing_starts', 'permits'] as const).map((key) => {
                const v = construction[key];
                return (
                  <div key={key}>
                    <dt className="text-xs text-text-3">{key === 'housing_starts' ? 'Housing starts' : 'Permits'}</dt>
                    <dd className="num mt-1 text-lg font-semibold">{v.value === null ? '—' : `${formatValue(v.value, 'count')}K`}</dd>
                    <dd className="num text-xs text-text-2">{formatValue(v.mom, 'percent_signed')} MoM</dd>
                    <dd className="mt-2">
                      <Sparkline values={(numericSeries(construction.series, key) ?? []).slice(-24)} tone={key === 'permits' ? 'cat-3' : 'cat-1'} area={false} className="h-7 w-full" />
                    </dd>
                  </div>
                );
              })}
            </dl>
            <p className="mt-3 text-2xs text-text-3">{construction.housing_starts.units ?? 'Thousands, SAAR'} · {formatMonth(construction.housing_starts.period, true)}</p>
          </Card>
        </div>
      </div>

      <Card
        id="national-trends"
        title="National trends"
        subtitle={entry?.note ?? undefined}
        copyLink
        exportTitle={`${metricLabel(registry, metric)}, United States`}
        exportSubtitle={`Redfin, monthly, through ${formatMonth(index.data_through, true)}`}
        actions={
          <>
            <Select label="Metric" hideLabel value={metric} onChange={setMetric} options={metricKeys.map((k) => ({ value: k, label: metricLabel(registry, k) }))} />
            <SegmentedControl label="Time range" options={RANGE_OPTIONS} value={range} onChange={setRange} />
          </>
        }
      >
        <TimeSeriesChart
          rows={nationalRows}
          series={[{ key: metric, label: metricLabel(registry, metric), color: 'cat-1' }]}
          axis={{ format: entry?.format ?? 'count', scale: valueScale(entry) }}
          area
          annotate
          extremeLabel={range === '1Y' ? { high: '1-yr high', low: '1-yr low' } : { high: '36-mo high', low: '36-mo low' }}
          description={`${metricLabel(registry, metric)}, United States, monthly, ${range === 'All' ? 'all available months' : `last ${range}`}`}
        />
      </Card>

      <Card
        id="map"
        title="Metro map"
        subtitle="Bubble size: homes sold over 12 months. Color: year-over-year change."
        copyLink
        actions={
          <>
            <Select label="Color by YoY change in" hideLabel value={mapMetric} onChange={setMapMetric} options={mappable.map((k) => ({ value: k, label: `${metricLabel(registry, k)} YoY` }))} />
            <Link to={`/metros?view=table&metric=${mapMetric}`} className="btn">
              <Table2 aria-hidden="true" className="h-3.5 w-3.5" />
              View as table
            </Link>
          </>
        }
      >
        <MetroMap
          points={points}
          onSelect={(slug) => navigate(`/metro/${slug}`)}
          label={`Map of the ${points.length} metros colored by ${metricLabel(registry, mapMetric)} year-over-year change`}
          fallback={<RankedBars title={`Largest ${metricLabel(registry, mapMetric)} changes`} rows={[...rows].sort((a, b) => Math.abs(b.metrics[mapMetric]?.yoy ?? 0) - Math.abs(a.metrics[mapMetric]?.yoy ?? 0)).slice(0, 10).map((r) => ({ slug: r.slug, name: r.name, value: r.metrics[mapMetric]?.yoy ?? null, text: formatValue(r.metrics[mapMetric]?.yoy, deltaFormat(registry.get(mapMetric)), { signed: true }) }))} />}
        />
        <div className="mt-4">
          <MapLegend title={`${metricLabel(registry, mapMetric)}, YoY`} steps={legendSteps(rows, registry, mapMetric)} sizes={sizeLegend(rows)} />
        </div>
      </Card>

      <Card id="heat" title="Market heat" subtitle="All 50 metros by temperature: how competitive each is relative to the others" copyLink actions={<HeatLegend />}>
        <HeatGrid cells={heatCells(index)} />
      </Card>

      <Card id="movers" title="Movers" subtitle="Largest year-over-year changes across the 50 metros" copyLink>
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 xl:grid-cols-3">
          <RankedBars title="Price gains" rows={moverRows(index.movers.price_gains, 'percent_signed')} />
          <RankedBars title="Price declines" rows={moverRows(index.movers.price_declines, 'percent_signed')} />
          <RankedBars title="Inventory growth" rows={moverRows(index.movers.inventory_growth, 'percent_signed')} />
          {index.movers.temperature_top.length > 0 && <RankedBars title="Hottest (temperature)" rows={moverRows(index.movers.temperature_top, 'count')} tone="seq-4" />}
          {index.movers.temperature_bottom.length > 0 && <RankedBars title="Coolest (temperature)" rows={moverRows(index.movers.temperature_bottom, 'count')} tone="seq-2" />}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card
          id="rates"
          title="Mortgage rates"
          subtitle="Freddie Mac Primary Mortgage Market Survey, weekly"
          copyLink
          exportTitle="30-yr and 15-yr fixed mortgage rates"
          exportSubtitle={`Freddie Mac PMMS via FRED, as of ${formatDate(index.rates_as_of)}`}
          actions={<SegmentedControl label="Rate chart time range" options={RANGE_OPTIONS} value={rateRange} onChange={setRateRange} />}
        >
          <TimeSeriesChart
            rows={rateRows}
            series={[
              { key: 'mortgage30', label: metricLabel(registry, 'mortgage30'), shortLabel: '30-yr', color: 'cat-1' },
              { key: 'mortgage15', label: metricLabel(registry, 'mortgage15'), shortLabel: '15-yr', color: 'cat-2' },
            ]}
            axis={{ format: 'percent', scale: 'points' }}
            height={260}
            description="30-year and 15-year fixed mortgage rates, weekly"
            tooltipDate={formatDate}
          />
        </Card>
        <Card id="construction" title="Housing starts and permits" subtitle="Thousands of units, seasonally adjusted annual rate" copyLink exportTitle="U.S. housing starts and building permits" exportSubtitle="U.S. Census Bureau via FRED">
          <TimeSeriesChart
            rows={constructionRows}
            series={[
              { key: 'housing_starts', label: 'Housing starts', shortLabel: 'Starts', color: 'cat-1' },
              { key: 'permits', label: 'Building permits', shortLabel: 'Permits', color: 'cat-3' },
            ]}
            axis={{ format: 'count' }}
            height={260}
            valueFormatter={(v) => `${formatValue(v, 'count')}K`}
            description="U.S. housing starts and building permits, thousands of units, seasonally adjusted annual rate"
          />
        </Card>
      </div>

      <section aria-labelledby="alerts-title" id="alerts" className="scroll-mt-20 space-y-3">
        <h2 id="alerts-title" className="text-md font-semibold">
          Alerts
        </h2>
        <AlertCards alerts={alertViews(index)} />
      </section>

      <section aria-labelledby="investigations-title" id="investigations" className="scroll-mt-20 space-y-3">
        <div>
          <h2 id="investigations-title" className="text-md font-semibold">
            Why these markets are moving
          </h2>
          <p className="text-sm text-text-3">An AI investigator digs into the metros with new major flags (or the top mover), using only computed data.</p>
        </div>
        {index.investigations.length === 0 ? (
          <EmptyState title="No investigations this run" />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {investigationSummaryViews(index, registry).map((view) => (
              <InvestigationTeaser key={view.slug} view={view} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
