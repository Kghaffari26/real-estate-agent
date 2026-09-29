import { Download, Map as MapIcon, Table2 } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ColumnPicker } from '../components/data/ColumnPicker';
import { DataTable, type Column, type TableRow } from '../components/data/DataTable';
import { Sparkline } from '../components/charts/Sparkline';
import { MetroMap } from '../components/map';
import { MapLegend } from '../components/map/MapLegend';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { CopyLinkButton } from '../components/ui/CopyLinkButton';
import { Delta } from '../components/ui/Delta';
import { PageHeader } from '../components/ui/PageHeader';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { Select } from '../components/ui/Select';
import { PageSkeleton } from '../components/ui/Skeleton';
import { EmptyState, ErrorState } from '../components/ui/StateViews';
import { useIndex } from '../data/hooks';
import type { IndexOutput } from '../data/schema.gen';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useQueryState, useSetQuery } from '../hooks/useQueryState';
import { useToast } from '../hooks/Toast';
import { downloadBlob, toCsv } from '../lib/csv';
import { formatMonth, formatValue } from '../lib/format';
import { buildRegistry, deltaFormat, flagName, metricLabel, valueScale } from '../lib/metrics';
import { sequentialToken } from '../lib/scale';
import { color } from '../lib/tokens';
import { availableColumns, csvTable, DEFAULT_COLUMNS, parseColumns } from '../viewmodels/columns';
import { legendSteps, mapPoints, sizeLegend } from '../viewmodels/map';
import { buildMetroRows, distinct, filterRows, metricColumns, metricsWithData, sortRows, type SortDir } from '../viewmodels/metros';

const VIEWS = [
  { value: 'both', label: 'Map + table' },
  { value: 'table', label: 'Table' },
] as const;
type View = (typeof VIEWS)[number]['value'];

export function MetrosPage() {
  useDocumentTitle('Metros');
  const index = useIndex();
  if (index.status === 'loading') return <PageSkeleton label="Loading metros…" />;
  if (index.status === 'error') return <ErrorState error={index.error} onRetry={index.retry} />;
  return <Metros index={index.data} />;
}

function Metros({ index }: { index: IndexOutput }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const registry = useMemo(() => buildRegistry(index.metric_registry), [index]);
  const allRows = useMemo(() => buildMetroRows(index), [index]);
  const metrics = useMemo(() => metricColumns(registry, allRows), [registry, allRows]);
  const withData = useMemo(() => metricsWithData(metrics, allRows), [metrics, allRows]);

  const [query, setSearch] = useQueryState('q', '');
  const [marketType, setMarketType] = useQueryState('type', '');
  const [flag, setFlag] = useQueryState('flag', '');
  const [temperature, setTemperature] = useQueryState('temp', '');
  const [sortKey] = useQueryState('sort', 'homes_sold_12m');
  const [sortDir] = useQueryState<SortDir>('dir', 'desc', ['asc', 'desc']);
  const [metric, setMetric] = useQueryState('metric', withData[0] ?? 'median_sale_price', withData);
  const [view, setView] = useQueryState<View>('view', 'both', ['both', 'table']);
  const setQuery = useSetQuery();
  const available = availableColumns(withData);
  const columnsShown = parseColumns(params.get('cols'), available);

  const filtered = useMemo(() => sortRows(filterRows(allRows, { query, marketType, flag, temperature }), sortKey, sortDir), [allRows, query, marketType, flag, temperature, sortKey, sortDir]);
  const points = useMemo(() => mapPoints(filtered, registry, metric), [filtered, registry, metric]);

  const onSort = (key: string) => {
    const dir: SortDir = key === sortKey ? (sortDir === 'asc' ? 'desc' : 'asc') : key === 'name' || key === 'market_type' ? 'asc' : 'desc';
    setQuery({ sort: key === 'homes_sold_12m' ? null : key, dir: dir === 'desc' ? null : dir });
  };
  const setColumns = (ids: string[]) => {
    const ordered = available.filter((c) => ids.includes(c));
    const isDefault = ordered.length === DEFAULT_COLUMNS.length && DEFAULT_COLUMNS.every((c) => ordered.includes(c));
    setQuery({ cols: isDefault ? null : ordered.join(',') });
  };
  const exportCsv = () => {
    const { header, body } = csvTable(filtered, withData, registry);
    downloadBlob(new Blob([toCsv(header, body)], { type: 'text/csv;charset=utf-8' }), `metro-pulse-metros-${index.data_through}.csv`);
    toast(`Exported ${filtered.length} metros`);
  };

  const columns: Column[] = [
    { id: 'name', header: 'Metro', sortable: true },
    { id: 'temperature', header: 'Temp.', sortable: true, align: 'right' },
    { id: 'trend', header: 'Price trend', sub: 'Median sale price, 24 mo' },
    ...columnsShown.map((id): Column => {
      const [key, field] = id.split('.') as [string, string];
      return { id, header: metricLabel(registry, key), sub: field === 'yoy' ? (key.startsWith('permits_') ? 'YoY (12-mo)' : 'YoY') : undefined, align: 'right', sortable: true };
    }),
    { id: 'market_type', header: 'Market', sortable: true },
    { id: 'flags', header: 'Flags' },
    { id: 'homes_sold_12m', header: 'Homes sold', sub: '12 months', align: 'right', sortable: true },
  ];

  const tableRows: TableRow[] = filtered.map((r) => {
    const heat = sequentialToken(r.temperatureScore);
    return {
      key: r.slug,
      cells: {
        name: (
          <span className="flex items-center gap-2">
            <Link to={`/metro/${r.slug}`} className="font-medium text-text no-underline hover:underline">
              {r.name}
            </Link>
            {r.stale && <Badge>stale</Badge>}
          </span>
        ),
        temperature: (
          <span className="inline-flex items-center justify-end gap-1.5">
            {heat && <span className="h-2 w-2 rounded-full" style={{ background: color(heat) }} aria-hidden="true" />}
            <span className="num">{r.temperatureScore ?? '—'}</span>
            <span className="sr-only">{r.temperatureLabel}</span>
          </span>
        ),
        trend: r.spark.some((v) => v !== null) ? <Sparkline values={r.spark} area={false} className="h-6 w-20" /> : <span className="text-text-3">—</span>,
        market_type: <span className="text-text-2">{r.marketType ?? '—'}</span>,
        flags: r.flags.length ? (
          <span className="flex max-w-[280px] flex-wrap gap-1">
            {r.flags.map((f) => (
              <Badge key={f}>{flagName(f)}</Badge>
            ))}
          </span>
        ) : (
          <span className="text-text-3">—</span>
        ),
        homes_sold_12m: formatValue(r.homesSold12m, 'count'),
        ...Object.fromEntries(
          columnsShown.map((id) => {
            const [key, field] = id.split('.') as [string, string];
            const entry = registry.get(key);
            const cell = r.metrics[key];
            return [id, field === 'yoy' ? <Delta value={cell?.yoy} format={deltaFormat(entry)} goodDirection={entry?.good_direction} size="xs" /> : formatValue(cell?.value, entry?.format, { scale: valueScale(entry) })];
          }),
        ),
      },
    };
  });

  const typeOptions = distinct(allRows.map((r) => r.marketType));
  const tempOptions = distinct(allRows.map((r) => r.temperatureLabel));
  const flagOptions = distinct(allRows.flatMap((r) => r.flags));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Metros"
        subtitle={`The ${allRows.length} largest U.S. metros · data through ${formatMonth(index.data_through, true)}`}
        actions={
          <>
            <SegmentedControl label="Layout" options={VIEWS} value={view} onChange={setView} />
            <CopyLinkButton />
          </>
        }
      />

      <section aria-label="Filters" className="card grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <label htmlFor="metro-filter" className="label">
            Search
          </label>
          <input id="metro-filter" type="search" className="input" placeholder="City or state" value={query} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select label="Market type" value={marketType} onChange={setMarketType} options={[{ value: '', label: 'All' }, ...typeOptions.map((t) => ({ value: t, label: t }))]} />
        <Select label="Temperature" value={temperature} onChange={setTemperature} options={[{ value: '', label: 'All' }, ...tempOptions.map((t) => ({ value: t, label: t }))]} />
        <Select label="Flag" value={flag} onChange={setFlag} options={[{ value: '', label: 'All' }, ...flagOptions.map((f) => ({ value: f, label: flagName(f) }))]} />
        <p className="text-xs text-text-3 sm:col-span-2 lg:col-span-5" role="status">
          Showing <span className="num font-medium text-text-2">{filtered.length}</span> of {allRows.length} metros
        </p>
      </section>

      {view === 'both' && (
        <Card
          id="map"
          title="Map"
          subtitle="Bubble size: homes sold (12 mo). Color: year-over-year change. Click a metro to open it."
          copyLink
          actions={
            <>
              <Select label="Color by YoY change in" hideLabel value={metric} onChange={setMetric} options={withData.map((k) => ({ value: k, label: `${metricLabel(registry, k)} YoY` }))} />
              <button type="button" className="btn" onClick={() => setView('table')}>
                <Table2 aria-hidden="true" className="h-3.5 w-3.5" />
                View as table
              </button>
            </>
          }
          footer="Metros Redfin reports as divisions of a larger metro (e.g. Dallas and Fort Worth) share a centroid; they're fanned out slightly so each is visible."
        >
          {points.length === 0 ? (
            <EmptyState title="No metros match these filters" />
          ) : (
            <MetroMap
              points={points}
              onSelect={(slug) => navigate(`/metro/${slug}`)}
              label={`Map of ${points.length} metros colored by ${metricLabel(registry, metric)} year-over-year change`}
              fallback={<p className="text-sm text-text-2">Every metro is in the table below.</p>}
            />
          )}
          <div className="mt-4">
            <MapLegend title={`${metricLabel(registry, metric)}, YoY`} steps={legendSteps(allRows, registry, metric)} sizes={sizeLegend(allRows)} />
          </div>
        </Card>
      )}

      <Card
        id="table"
        title="All metros"
        subtitle="Sort by any column; pick columns; export what's shown."
        copyLink
        bodyClassName="card-pad"
        actions={
          <>
            {view === 'table' && (
              <>
                <button type="button" className="btn" onClick={() => setView('both')}>
                  <MapIcon aria-hidden="true" className="h-3.5 w-3.5" />
                  Show map
                </button>
              </>
            )}
            <ColumnPicker
              groups={withData.map((k) => ({ label: metricLabel(registry, k), options: [{ id: `${k}.value`, label: 'Value' }, { id: `${k}.yoy`, label: k.startsWith('permits_') ? 'YoY (12-mo)' : 'YoY' }] }))}
              selected={columnsShown}
              onChange={setColumns}
              onReset={() => setQuery({ cols: null })}
            />
            <button type="button" className="btn" onClick={exportCsv}>
              <Download aria-hidden="true" className="h-3.5 w-3.5" />
              Export CSV
            </button>
          </>
        }
      >
        {tableRows.length === 0 ? (
          <EmptyState title="No metros match these filters">Try clearing the search or a filter.</EmptyState>
        ) : (
          <DataTable caption="Metros with their latest values and year-over-year changes" columns={columns} rows={tableRows} sortKey={sortKey} sortDir={sortDir} onSort={onSort} rowHeader="name" />
        )}
      </Card>
    </div>
  );
}
