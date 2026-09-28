import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertsList } from '../components/AlertsList';
import { BriefCard } from '../components/BriefCard';
import { TimeSeriesChart } from '../components/charts/TimeSeriesChart';
import { InvestigationCard } from '../components/InvestigationCard';
import { KpiTile } from '../components/KpiTile';
import { MoversList } from '../components/MoversList';
import { PageHeader } from '../components/PageHeader';
import { TemperatureGauge } from '../components/TemperatureGauge';
import { Card } from '../components/ui/Card';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { Select } from '../components/ui/Select';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateViews';
import type { IndexOutput } from '../data/schema.gen';
import { useIndex } from '../data/hooks';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useQueryState } from '../hooks/useQueryState';
import { formatDate, formatMonth, formatValue } from '../lib/format';
import { buildRegistry, deltaFormat, metricLabel, valueScale } from '../lib/metrics';
import { numericSeries, rangeStart, RANGES, seriesDates, toRows, type Range } from '../lib/series';
import { alertViews, investigationSummaryViews, keyStatScale, keyStatViews, moverRows, nationalMetricKeys } from '../viewmodels/overview';

const RANGE_OPTIONS = RANGES.map((r) => ({ value: r, label: r }));

export function OverviewPage() {
  useDocumentTitle('Overview');
  const index = useIndex();
  if (index.status === 'loading') return <LoadingState label="Loading the national overview…" />;
  if (index.status === 'error') return <ErrorState error={index.error} onRetry={index.retry} />;
  return <Overview index={index.data} />;
}

function Overview({ index }: { index: IndexOutput }) {
  const registry = useMemo(() => buildRegistry(index.metric_registry), [index]);
  const national = index.national;
  const metricKeys = useMemo(() => nationalMetricKeys(index), [index]);
  const [metric, setMetric] = useQueryState('metric', metricKeys[0] ?? 'median_sale_price', metricKeys);
  const [range, setRange] = useQueryState<Range>('range', '3Y', RANGES);
  const [rateRange, setRateRange] = useQueryState<Range>('rates', '3Y', RANGES);

  const entry = registry.get(metric);
  const dates = seriesDates(national.series);
  const start = rangeStart(dates, range);
  const values = numericSeries(national.series, metric) ?? [];
  const nationalRows = toRows(dates.slice(start), { [metric]: values.slice(start) });

  const rateDates = national.rates.dates;
  const rateStart = rangeStart(rateDates, rateRange);
  const rateRows = toRows(rateDates.slice(rateStart), {
    mortgage30: national.rates.mortgage30.slice(rateStart),
    mortgage15: national.rates.mortgage15.slice(rateStart),
  });

  const construction = national.construction;
  const constructionDates = seriesDates(construction.series);
  const constructionRows = toRows(constructionDates, {
    housing_starts: numericSeries(construction.series, 'housing_starts') ?? [],
    permits: numericSeries(construction.series, 'permits') ?? [],
  });

  const keyStats = keyStatViews(index.key_stats);
  const latest = national.latest[metric];

  return (
    <div className="space-y-6">
      <PageHeader title="U.S. housing market" subtitle={`Redfin data through ${formatMonth(index.data_through, true)} · mortgage rates as of ${formatDate(index.rates_as_of)}`} />

      <section aria-labelledby="headline" className="card">
        <h2 id="headline" className="text-xl font-semibold leading-snug">
          {index.headline}
        </h2>
      </section>

      <section aria-label="Key stats" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {keyStats.map((s) => (
          <KpiTile
            key={s.label}
            label={s.label}
            value={s.value}
            scale={keyStatScale(s)}
            goodDirection={s.goodDirection}
            deltas={[{ value: s.delta, format: s.deltaFormat, label: s.deltaLabel }]}
          />
        ))}
        <div className="card flex items-center justify-center sm:col-span-2 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-center gap-4">
            <TemperatureGauge score={national.temperature.score} label={national.temperature.label} basis={national.temperature.basis} />
            <p className="max-w-xs text-sm muted">
              National market temperature: how competitive the U.S. market is {national.temperature.basis ?? 'vs its own history'}.{' '}
              <Link to="/about#temperature">How it's computed</Link>
            </p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <BriefCard id="national-brief" title="National brief" brief={national.brief} />
        </div>
        <Card id="case-shiller" title="Case-Shiller index">
          {national.case_shiller ? (
            <dl className="space-y-2">
              <div>
                <dt className="text-sm muted">S&amp;P CoreLogic Case-Shiller U.S. National</dt>
                <dd className="text-2xl font-semibold tabular-nums">{formatValue(national.case_shiller.value, 'decimal1')}</dd>
              </div>
              <div>
                <dt className="text-sm muted">Year over year</dt>
                <dd>{formatValue(national.case_shiller.yoy, 'percent_signed')}</dd>
              </div>
              <div>
                <dt className="text-sm muted">Period</dt>
                <dd>{formatMonth(national.case_shiller.period, true)}</dd>
              </div>
            </dl>
          ) : (
            <EmptyState>Case-Shiller data isn't available in this run.</EmptyState>
          )}
        </Card>
      </div>

      <Card
        id="national-series"
        title="National trends"
        actions={
          <>
            <Select
              label="Metric"
              hideLabel
              value={metric}
              onChange={setMetric}
              options={metricKeys.map((k) => ({ value: k, label: metricLabel(registry, k) }))}
            />
            <SegmentedControl label="Time range" options={RANGE_OPTIONS} value={range} onChange={setRange} />
          </>
        }
        footer={entry?.note ?? undefined}
      >
        {latest && (
          <p className="mb-2 text-sm">
            Latest: <strong>{formatValue(latest.value, entry?.format, { scale: valueScale(entry) })}</strong>
            {' · '}YoY {formatValue(latest.yoy, deltaFormat(entry, latest.delta_format), { signed: true })}
          </p>
        )}
        <TimeSeriesChart
          rows={nationalRows}
          series={[{ key: metric, label: metricLabel(registry, metric), color: 'chart-1' }]}
          left={{ format: entry?.format ?? 'count', scale: valueScale(entry) }}
          description={`${metricLabel(registry, metric)}, United States, monthly, ${range === 'All' ? 'all available months' : `last ${range}`}`}
        />
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card
          id="rates"
          title="Mortgage rates"
          actions={<SegmentedControl label="Rate chart time range" options={RANGE_OPTIONS} value={rateRange} onChange={setRateRange} />}
          footer={`30-yr change over 1 week: ${formatValue(national.rates.latest.mortgage30_change_1w_pp, 'pp_signed', { scale: 'points' })} · year ago: ${formatValue(national.rates.latest.mortgage30_year_ago, 'percent', { scale: 'points' })} · Freddie Mac PMMS via FRED`}
        >
          <p className="mb-2 text-sm">
            30-yr fixed: <strong>{formatValue(national.rates.latest.mortgage30, 'percent', { scale: 'points' })}</strong> as of {formatDate(index.rates_as_of)}
          </p>
          <TimeSeriesChart
            rows={rateRows}
            series={[
              { key: 'mortgage30', label: metricLabel(registry, 'mortgage30'), color: 'chart-1' },
              { key: 'mortgage15', label: metricLabel(registry, 'mortgage15'), color: 'chart-2', dashed: true },
            ]}
            left={{ format: 'percent', scale: 'points' }}
            description="30-year and 15-year fixed mortgage rates, weekly"
            tooltipDate={formatDate}
          />
        </Card>

        <Card
          id="construction"
          title="New construction"
          footer={`${construction.housing_starts.units ?? ''} · U.S. Census Bureau via FRED`}
        >
          <dl className="mb-2 grid grid-cols-2 gap-2 text-sm">
            {(['housing_starts', 'permits'] as const).map((key) => {
              const v = construction[key];
              return (
                <div key={key}>
                  <dt className="muted">{key === 'housing_starts' ? 'Housing starts' : 'Building permits'}</dt>
                  <dd>
                    <strong className="tabular-nums">{formatValue(v.value, 'count')}K</strong> · MoM {formatValue(v.mom, 'percent_signed')}
                    <span className="block text-xs muted">{formatMonth(v.period, true)}</span>
                  </dd>
                </div>
              );
            })}
          </dl>
          <TimeSeriesChart
            rows={constructionRows}
            series={[
              { key: 'housing_starts', label: 'Housing starts', color: 'chart-3' },
              { key: 'permits', label: 'Building permits', color: 'chart-4', dashed: true },
            ]}
            left={{ format: 'count' }}
            description="U.S. housing starts and building permits, thousands of units, seasonally adjusted annual rate"
          />
        </Card>
      </div>

      <Card id="movers" title="Movers">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <MoversList title="Biggest price gains (YoY)" rows={moverRows(index.movers.price_gains, 'percent_signed')} />
          <MoversList title="Biggest price declines (YoY)" rows={moverRows(index.movers.price_declines, 'percent_signed')} />
          <MoversList title="Inventory growth (YoY)" rows={moverRows(index.movers.inventory_growth, 'percent_signed')} />
          <MoversList title="Hottest markets (temperature)" rows={moverRows(index.movers.temperature_top, 'count')} />
          <MoversList title="Coolest markets (temperature)" rows={moverRows(index.movers.temperature_bottom, 'count')} />
        </div>
      </Card>

      <Card id="alerts" title="Alerts">
        <AlertsList alerts={alertViews(index)} />
      </Card>

      <section aria-labelledby="investigations-title" className="space-y-3">
        <h2 id="investigations-title" className="text-lg font-semibold">
          Investigations: why these markets are moving
        </h2>
        {index.investigations.length === 0 ? (
          <EmptyState>No metros were investigated this run.</EmptyState>
        ) : (
          investigationSummaryViews(index, registry).map((view) => (
            <InvestigationCard key={view.slug} id={`investigation-${view.slug}`} view={view} linkToMetro />
          ))
        )}
      </section>
    </div>
  );
}
