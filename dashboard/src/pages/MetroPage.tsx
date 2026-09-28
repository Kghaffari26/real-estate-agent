import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AffordabilityCalculator } from '../components/AffordabilityCalculator';
import { BriefCard } from '../components/BriefCard';
import { TimeSeriesChart, type ChartSeries } from '../components/charts/TimeSeriesChart';
import { InvestigationCard } from '../components/InvestigationCard';
import { KpiTile } from '../components/KpiTile';
import { PageHeader } from '../components/PageHeader';
import { TemperatureBreakdown } from '../components/TemperatureBreakdown';
import { TemperatureGauge } from '../components/TemperatureGauge';
import { Badge } from '../components/ui/Badge';
import { severityTone } from '../components/ui/tones';
import { Card } from '../components/ui/Card';
import { Checkbox } from '../components/ui/Checkbox';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { Select } from '../components/ui/Select';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateViews';
import { isValidSlug } from '../data/api';
import { useIndex, useMetro } from '../data/hooks';
import type { IndexOutput, MetroDetailOutput } from '../data/schema.gen';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useQueryState } from '../hooks/useQueryState';
import { formatMonth, formatValue } from '../lib/format';
import { buildRegistry, metricLabel, valueScale, type Registry } from '../lib/metrics';
import { alignToDates, hasData, numericSeries, rangeStart, RANGES, seriesDates, toRows, type Range } from '../lib/series';
import { calculatorDefaults, flagFacts, investigationView, metricTiles, temperatureRows, type MetricTileView } from '../viewmodels/metro';
import { NotFoundPage } from './NotFoundPage';

const RANGE_OPTIONS = RANGES.map((r) => ({ value: r, label: r }));
const TREND_TEXT = { up: '▲ Rising (3 mo)', down: '▼ Falling (3 mo)', flat: '■ Flat (3 mo)' } as const;

export function MetroPage() {
  const { slug } = useParams();
  const valid = isValidSlug(slug);
  const metro = useMetro(valid ? slug : '');
  const index = useIndex();
  useDocumentTitle(metro.status === 'ready' ? metro.data.name : 'Metro');

  if (!valid) return <NotFoundPage what="metro" />;
  if (metro.status === 'loading' || index.status === 'loading') return <LoadingState label="Loading metro…" />;
  if (metro.status === 'error') {
    if ((metro.error as { kind?: string }).kind === 'not_found') return <NotFoundPage what="metro" />;
    return <ErrorState error={metro.error} onRetry={metro.retry} />;
  }
  if (index.status === 'error') return <ErrorState error={index.error} onRetry={index.retry} />;
  return <Metro metro={metro.data} index={index.data} />;
}

function tileBadges(tile: MetricTileView) {
  return (
    <>
      {tile.trend && <Badge>{TREND_TEXT[tile.trend]}</Badge>}
      {tile.high36 && <Badge tone="info">36-month high</Badge>}
      {tile.low36 && <Badge tone="info">36-month low</Badge>}
    </>
  );
}

function Metro({ metro, index }: { metro: MetroDetailOutput; index: IndexOutput }) {
  const registry = useMemo(() => buildRegistry(index.metric_registry), [index]);
  const tiles = useMemo(() => metricTiles(metro, registry), [metro, registry]);
  const dates = seriesDates(metro.series);
  const chartable = tiles.map((t) => t.key).filter((k) => hasData(numericSeries(metro.series, k)));

  const [metric, setMetric] = useQueryState('metric', chartable[0] ?? 'median_sale_price', chartable);
  const [range, setRange] = useQueryState<Range>('range', '3Y', RANGES);
  const [overlay, setOverlay] = useQueryState<'0' | '1'>('rate', '0', ['0', '1']);

  const entry = registry.get(metric);
  const start = rangeStart(dates, range);
  const values = numericSeries(metro.series, metric) ?? [];
  const rates = alignToDates(dates, index.national.rates.dates, index.national.rates.mortgage30);
  const rows = toRows(dates.slice(start), { [metric]: values.slice(start), mortgage30: rates.slice(start) });
  const series: ChartSeries[] = [{ key: metric, label: metricLabel(registry, metric), color: 'chart-1' }];
  if (overlay === '1') series.push({ key: 'mortgage30', label: metricLabel(registry, 'mortgage30'), color: 'chart-2', axis: 'right', dashed: true });

  const coreTiles = tiles.filter((t) => !['zhvi', 'zori'].includes(t.key) && !t.permits);
  const zillowTiles = tiles.filter((t) => ['zhvi', 'zori'].includes(t.key));
  const permitTiles = tiles.filter((t) => t.permits);
  const defaults = calculatorDefaults(metro);
  const investigation = investigationView(metro, registry);

  const tile = (t: MetricTileView) => (
    <KpiTile
      key={t.key}
      label={t.label}
      value={t.value}
      goodDirection={t.goodDirection}
      deltas={[
        { value: t.yoy, format: t.deltaFormat, label: t.permits ? 'YoY (12-mo)' : 'YoY' },
        ...(t.permits ? [] : [{ value: t.mom, format: t.deltaFormat, label: 'MoM' }]),
      ]}
      badges={tileBadges(t)}
      note={t.note}
    />
  );

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link to="/metros">Metros</Link> <span aria-hidden="true">/</span> <span aria-current="page">{metro.name}</span>
      </nav>
      <PageHeader
        title={metro.name}
        subtitle={
          <>
            Data through {formatMonth(metro.data_through, true)}
            {metro.market_type && <> · {metro.market_type}</>}
            {metro.stale && (
              <>
                {' '}
                <Badge tone="warning">Stale data</Badge>
              </>
            )}
          </>
        }
      >
        <Link to={`/compare?m=${metro.slug}`} className="btn no-underline hover:no-underline">
          Compare with…
        </Link>
      </PageHeader>

      <section aria-label="Key metrics" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {coreTiles.map(tile)}
      </section>

      <Card
        id="metro-chart"
        title="Trend"
        actions={
          <>
            <Select label="Metric" hideLabel value={metric} onChange={setMetric} options={chartable.map((k) => ({ value: k, label: metricLabel(registry, k) }))} />
            <SegmentedControl label="Time range" options={RANGE_OPTIONS} value={range} onChange={setRange} />
            <Checkbox label="30-yr mortgage rate" checked={overlay === '1'} onChange={(on) => setOverlay(on ? '1' : '0')} />
          </>
        }
        footer={entry?.note ?? undefined}
      >
        <TimeSeriesChart
          rows={rows}
          series={series}
          left={{ format: entry?.format ?? 'count', scale: valueScale(entry) }}
          right={overlay === '1' ? { format: 'percent', scale: 'points' } : undefined}
          description={`${metricLabel(registry, metric)} in ${metro.name}, monthly${overlay === '1' ? ', with the 30-year mortgage rate on the right axis' : ''}`}
        />
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card id="temperature" title="Market temperature" footer="Competitiveness relative to the other tracked metros. Each component is a z-score across the metros this month; the score is 100 × Φ(mean signed z).">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <TemperatureGauge score={metro.temperature.score} label={metro.temperature.label} size="sm" />
            <div className="w-full min-w-0">
              <TemperatureBreakdown rows={temperatureRows(metro, registry)} />
            </div>
          </div>
        </Card>
        <Card id="flags" title="Flags">
          {metro.flags.length === 0 ? (
            <EmptyState>No flags this month.</EmptyState>
          ) : (
            <ul className="space-y-3">
              {metro.flags.map((f) => (
                <li key={f.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{f.label}</span>
                    <Badge tone={severityTone(f.severity)}>{f.severity}</Badge>
                  </div>
                  {Object.keys(f.facts).length > 0 && (
                    <dl className="mt-1 text-sm muted">
                      {flagFacts(f, registry).map((fact) => (
                        <div key={fact.label} className="flex gap-2">
                          <dt>{fact.label}:</dt>
                          <dd className="tabular-nums">{fact.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <BriefCard id="metro-brief" title="Market brief" brief={metro.brief} />
        {investigation ? (
          <InvestigationCard id="investigation" view={investigation} />
        ) : (
          <Card id="investigation" title="Why this is happening">
            <EmptyState>
              The investigator looks into up to 3 metros per run (new major flags, else the top mover). {metro.name} wasn't one of them this run.
            </EmptyState>
          </Card>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card id="zillow" title="Home values and rents (Zillow)">
          <SubTiles tiles={zillowTiles} registry={registry} metro={metro} empty="Zillow doesn't publish this metro separately." />
        </Card>
        <Card id="permits" title="Building permits (Census)">
          <SubTiles tiles={permitTiles} registry={registry} metro={metro} empty="No permit data." />
        </Card>
      </div>

      <Card id="affordability" title="Affordability calculator">
        {defaults ? (
          <>
            <AffordabilityCalculator key={metro.slug} defaults={defaults} />
            {metro.affordability && (
              <p className="mt-3 text-sm muted">
                Published estimate: {formatValue(metro.affordability.payment_now, 'currency')}/mo now vs{' '}
                {formatValue(metro.affordability.payment_year_ago, 'currency')} a year ago (
                {formatValue(metro.affordability.payment_change_pct, 'percent_signed')}), at{' '}
                {formatValue(metro.affordability.assumptions.rate_year_ago, 'percent', { scale: 'points' })} and{' '}
                {formatValue(metro.affordability.assumptions.price_year_ago, 'currency')} a year ago.
              </p>
            )}
          </>
        ) : (
          <EmptyState>Affordability isn't available for this metro (no price or rate).</EmptyState>
        )}
      </Card>
    </div>
  );
}

/** ZHVI/ZORI and permits panels: a value per metric (dash when null) plus a small chart. */
function SubTiles({ tiles, registry, metro, empty }: { tiles: readonly MetricTileView[]; registry: Registry; metro: MetroDetailOutput; empty: string }) {
  if (tiles.length === 0) return <EmptyState>{empty}</EmptyState>;
  const dates = seriesDates(metro.series);
  const withData = tiles.filter((t) => hasData(numericSeries(metro.series, t.key)));
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.key}>
            <dt className="text-sm muted">{t.label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{t.value}</dd>
            <dd className="text-sm">
              {t.permits ? 'YoY (12-mo) ' : 'YoY '}
              {formatValue(t.yoy, t.deltaFormat, { signed: true })}
            </dd>
          </div>
        ))}
      </dl>
      {withData.length === 0 ? (
        <EmptyState>{empty}</EmptyState>
      ) : (
        withData.map((t) => {
          const entry = registry.get(t.key);
          return (
            <TimeSeriesChart
              key={t.key}
              height={180}
              rows={toRows(dates, { [t.key]: numericSeries(metro.series, t.key) ?? [] })}
              series={[{ key: t.key, label: t.label, color: 'chart-3' }]}
              left={{ format: entry?.format ?? 'count', scale: valueScale(entry) }}
              description={`${t.label} in ${metro.name}, monthly`}
            />
          );
        })
      )}
    </div>
  );
}
