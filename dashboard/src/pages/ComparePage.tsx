import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { TimeSeriesChart } from '../components/charts/TimeSeriesChart';
import { MetroSearch } from '../components/layout/MetroSearch';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/ui/Card';
import { Checkbox } from '../components/ui/Checkbox';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateViews';
import { isValidSlug } from '../data/api';
import { useIndex, useMetros } from '../data/hooks';
import type { IndexOutput, MetroDetailOutput } from '../data/schema.gen';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useQueryList, useQueryState } from '../hooks/useQueryState';
import { buildRegistry, metricLabel, valueScale } from '../lib/metrics';
import { RANGES, type Range } from '../lib/series';
import { color, SERIES_COLORS } from '../lib/tokens';
import { comparableMetrics, compareRows, compareTable, MAX_COMPARE } from '../viewmodels/compare';

const RANGE_OPTIONS = RANGES.map((r) => ({ value: r, label: r }));

export function ComparePage() {
  useDocumentTitle('Compare');
  const index = useIndex();
  const [rawSlugs, setSlugs] = useQueryList('m', MAX_COMPARE);
  const slugs = rawSlugs.filter(isValidSlug);
  const metros = useMetros(slugs);

  if (index.status === 'loading') return <LoadingState label="Loading…" />;
  if (index.status === 'error') return <ErrorState error={index.error} onRetry={index.retry} />;

  const loaded = metros.status === 'ready' ? metros.data.filter((r) => r.ok).map((r) => (r as { data: MetroDetailOutput }).data) : [];
  const failed = metros.status === 'ready' ? metros.data.filter((r) => !r.ok).map((r) => r.slug) : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Compare metros" subtitle={`Overlay up to ${MAX_COMPARE} metros on the same chart`} />
      <Card id="picker" title="Metros">
        <ul className="mb-3 flex flex-wrap gap-2">
          {slugs.map((slug, i) => {
            const name = index.data.metros.find((m) => m.slug === slug)?.name ?? slug;
            return (
              <li key={slug} className="chip gap-2 border-border py-1 text-sm">
                <svg width="10" height="10" aria-hidden="true">
                  <circle cx="5" cy="5" r="5" fill={color(SERIES_COLORS[i % SERIES_COLORS.length]!)} />
                </svg>
                <Link to={`/metro/${slug}`}>{name}</Link>
                <button type="button" className="rounded-sm px-1 hover:bg-surface-muted" aria-label={`Remove ${name}`} onClick={() => setSlugs(slugs.filter((s) => s !== slug))}>
                  ×
                </button>
              </li>
            );
          })}
        </ul>
        {slugs.length < MAX_COMPARE ? (
          <div className="max-w-sm">
            <MetroSearch
              items={index.data.metros.map((m) => ({ slug: m.slug, name: m.name }))}
              exclude={slugs}
              onSelect={(slug) => setSlugs([...slugs, slug])}
              label="Add a metro to compare"
              placeholder="Add a metro…"
            />
          </div>
        ) : (
          <p className="text-sm muted">Remove a metro to add another (maximum {MAX_COMPARE}).</p>
        )}
        {failed.length > 0 && (
          <p role="alert" className="mt-2 text-sm text-negative">
            Couldn't load: {failed.join(', ')}
          </p>
        )}
      </Card>
      {slugs.length === 0 ? (
        <EmptyState>Pick at least one metro above to start comparing.</EmptyState>
      ) : metros.status === 'loading' ? (
        <LoadingState label="Loading metros…" />
      ) : metros.status === 'error' ? (
        <ErrorState error={metros.error} onRetry={metros.retry} />
      ) : loaded.length === 0 ? (
        <EmptyState>None of the selected metros could be loaded.</EmptyState>
      ) : (
        <Comparison index={index.data} metros={loaded} />
      )}
    </div>
  );
}

function Comparison({ index, metros }: { index: IndexOutput; metros: MetroDetailOutput[] }) {
  const registry = useMemo(() => buildRegistry(index.metric_registry), [index]);
  const available = comparableMetrics(metros, registry);
  const [metricList, setMetricList] = useQueryList('metrics');
  const selected = metricList.filter((k) => available.includes(k));
  const metrics = selected.length ? selected : available.slice(0, 1);
  const [range, setRange] = useQueryState<Range>('range', '3Y', RANGES);
  const [indexed, setIndexed] = useQueryState<'0' | '1'>('indexed', '0', ['0', '1']);

  const toggleMetric = (key: string, on: boolean) => {
    const next = on ? [...metrics, key] : metrics.filter((k) => k !== key);
    setMetricList(available.filter((k) => next.includes(k)));
  };

  const series = metros.map((m, i) => ({ key: m.slug, label: m.name, color: SERIES_COLORS[i % SERIES_COLORS.length]! }));
  const table = compareTable(metros, registry);

  return (
    <>
      <Card
        id="compare-controls"
        title="Chart options"
        actions={
          <>
            <SegmentedControl label="Time range" options={RANGE_OPTIONS} value={range} onChange={setRange} />
            <Checkbox label="Index to 100" checked={indexed === '1'} onChange={(on) => setIndexed(on ? '1' : '0')} />
          </>
        }
      >
        <fieldset>
          <legend className="label">Metrics (one chart each)</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {available.map((key) => (
              <Checkbox key={key} label={metricLabel(registry, key)} checked={metrics.includes(key)} onChange={(on) => toggleMetric(key, on)} />
            ))}
          </div>
        </fieldset>
      </Card>

      {metrics.map((metric) => {
        const entry = registry.get(metric);
        const label = metricLabel(registry, metric);
        return (
          <Card key={metric} id={`chart-${metric}`} title={indexed === '1' ? `${label} (indexed, first month = 100)` : label}>
            <TimeSeriesChart
              rows={compareRows(metros, metric, range, indexed === '1')}
              series={series}
              left={indexed === '1' ? { format: 'index' } : { format: entry?.format ?? 'count', scale: valueScale(entry) }}
              description={`${label} for ${metros.map((m) => m.name).join(', ')}${indexed === '1' ? ', indexed to 100 at the first month' : ''}`}
            />
          </Card>
        );
      })}

      <Card id="compare-table" title="Side by side (latest month)">
        <div className="max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label="Side-by-side comparison table">
          <table className="table-base">
            <caption className="sr-only">Latest values and year-over-year changes for each compared metro</caption>
            <thead>
              <tr>
                <th scope="col">Metric</th>
                {metros.map((m) => (
                  <th key={m.slug} scope="col" className="text-right">
                    {m.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.map((row) => (
                <tr key={row.key}>
                  <th scope="row" className="font-normal">
                    {row.label}
                  </th>
                  {row.cells.map((cell, i) => (
                    <td key={metros[i]!.slug} className="text-right tabular-nums">
                      {cell.value}
                      {cell.yoy && <span className="block text-xs muted">{cell.yoy} YoY</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
