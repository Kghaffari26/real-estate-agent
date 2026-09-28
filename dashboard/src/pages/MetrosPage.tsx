import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MapLegend, MetroMap, type MapPoint } from '../components/MetroMap';
import { SortableTable, type Column, type TableRow } from '../components/MetroTable';
import { PageHeader } from '../components/PageHeader';
import { TemperatureChip } from '../components/TemperatureChip';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { Delta } from '../components/ui/Delta';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { Select } from '../components/ui/Select';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateViews';
import type { IndexOutput } from '../data/schema.gen';
import { useIndex } from '../data/hooks';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useQueryState, useSetQuery } from '../hooks/useQueryState';
import { formatValue } from '../lib/format';
import { buildRegistry, deltaFormat, flagName, metricLabel, valueScale } from '../lib/metrics';
import { bucketFor, divergingBuckets } from '../lib/scale';
import { buildMetroRows, distinct, filterRows, metricColumns, metricsWithData, sortRows, type SortDir } from '../viewmodels/metros';

const VIEWS = [
  { value: 'both', label: 'Map + table' },
  { value: 'table', label: 'Table only' },
] as const;
type View = (typeof VIEWS)[number]['value'];

export function MetrosPage() {
  useDocumentTitle('Metros');
  const index = useIndex();
  if (index.status === 'loading') return <LoadingState label="Loading metros…" />;
  if (index.status === 'error') return <ErrorState error={index.error} onRetry={index.retry} />;
  return <Metros index={index.data} />;
}

function Metros({ index }: { index: IndexOutput }) {
  const navigate = useNavigate();
  const registry = useMemo(() => buildRegistry(index.metric_registry), [index]);
  const allRows = useMemo(() => buildMetroRows(index), [index]);
  const columns = useMemo(() => metricColumns(registry, allRows), [registry, allRows]);
  const mappable = useMemo(() => metricsWithData(columns, allRows), [columns, allRows]);

  const [query, setSearch] = useQueryState('q', '');
  const [marketType, setMarketType] = useQueryState('type', '');
  const [flag, setFlag] = useQueryState('flag', '');
  const [temperature, setTemperature] = useQueryState('temp', '');
  const [sortKey] = useQueryState('sort', 'homes_sold_12m');
  const [sortDir] = useQueryState<SortDir>('dir', 'desc', ['asc', 'desc']);
  const [mapMetric, setMapMetric] = useQueryState('metric', mappable[0] ?? 'median_sale_price', mappable);
  const [view, setView] = useQueryState<View>('view', 'both', ['both', 'table']);

  const filtered = useMemo(
    () => sortRows(filterRows(allRows, { query, marketType, flag, temperature }), sortKey, sortDir),
    [allRows, query, marketType, flag, temperature, sortKey, sortDir],
  );

  const setQuery = useSetQuery();
  const onSort = (key: string) => {
    const dir: SortDir = key === sortKey ? (sortDir === 'asc' ? 'desc' : 'asc') : key === 'name' || key === 'market_type' ? 'asc' : 'desc';
    // Defaults (homes sold, descending) are dropped from the URL to keep it short.
    setQuery({ sort: key === 'homes_sold_12m' ? null : key, dir: dir === 'desc' ? null : dir });
  };

  const mapEntry = registry.get(mapMetric);
  const mapDeltaFormat = deltaFormat(mapEntry);
  const buckets = divergingBuckets(allRows.map((r) => r.metrics[mapMetric]?.yoy));
  const points: MapPoint[] = filtered
    .filter((r) => r.lat !== null && r.lon !== null)
    .map((r) => ({
      slug: r.slug,
      name: r.name,
      lat: r.lat!,
      lon: r.lon!,
      color: bucketFor(buckets, r.metrics[mapMetric]?.yoy),
      valueText: `${metricLabel(registry, mapMetric)} YoY: ${formatValue(r.metrics[mapMetric]?.yoy, mapDeltaFormat, { signed: true })}`,
    }));
  const legend = [
    ...buckets.map((b) => ({
      color: b.token,
      label:
        b.min === -Infinity
          ? `< ${formatValue(b.max, mapDeltaFormat, { signed: true })}`
          : b.max === Infinity
            ? `≥ ${formatValue(b.min, mapDeltaFormat, { signed: true })}`
            : `${formatValue(b.min, mapDeltaFormat, { signed: true })} to ${formatValue(b.max, mapDeltaFormat, { signed: true })}`,
    })),
    { color: 'scale-missing' as const, label: 'No data' },
  ];

  const tableColumns: Column[] = [
    { id: 'name', header: 'Metro', sortable: true },
    { id: 'temperature', header: 'Temperature', sortable: true },
    { id: 'market_type', header: 'Market type', sortable: true },
    { id: 'flags', header: 'Flags' },
    { id: 'homes_sold_12m', header: 'Homes sold', sub: '12 months', align: 'right', sortable: true },
    ...columns.flatMap((key): Column[] => [
      { id: `${key}.value`, header: metricLabel(registry, key), align: 'right', sortable: true },
      { id: `${key}.yoy`, header: metricLabel(registry, key), sub: key.startsWith('permits_') ? 'YoY (12-mo)' : 'YoY', align: 'right', sortable: true },
    ]),
  ];

  const tableRows: TableRow[] = filtered.map((r) => ({
    key: r.slug,
    cells: {
      name: (
        <>
          <Link to={`/metro/${r.slug}`}>{r.name}</Link>
          {r.stale && (
            <>
              {' '}
              <Badge tone="warning">stale</Badge>
            </>
          )}
        </>
      ),
      temperature: <TemperatureChip score={r.temperatureScore} label={r.temperatureLabel} />,
      market_type: r.marketType ?? '—',
      flags: r.flags.length ? (
        <span className="flex flex-wrap gap-1">
          {r.flags.map((f) => (
            <Badge key={f}>{flagName(f)}</Badge>
          ))}
        </span>
      ) : (
        <span className="muted">—</span>
      ),
      homes_sold_12m: formatValue(r.homesSold12m, 'count'),
      ...Object.fromEntries(
        columns.flatMap((key) => {
          const entry = registry.get(key);
          const cell = r.metrics[key];
          return [
            [`${key}.value`, formatValue(cell?.value, entry?.format, { scale: valueScale(entry) })],
            [`${key}.yoy`, <Delta key="d" value={cell?.yoy} format={deltaFormat(entry)} goodDirection={entry?.good_direction} />],
          ];
        }),
      ),
    },
  }));

  const flagOptions = distinct(allRows.flatMap((r) => r.flags));
  const typeOptions = distinct(allRows.map((r) => r.marketType));
  const tempOptions = distinct(allRows.map((r) => r.temperatureLabel));

  return (
    <div className="space-y-6">
      <PageHeader title="Metros" subtitle={`The ${allRows.length} largest U.S. metros, latest month`}>
        <SegmentedControl label="Layout" options={VIEWS} value={view} onChange={setView} />
      </PageHeader>

      <Card id="filters" title="Filter">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="metro-filter" className="label">
              Search
            </label>
            <input id="metro-filter" type="search" className="input" placeholder="City or state" value={query} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select label="Market type" value={marketType} onChange={setMarketType} options={[{ value: '', label: 'All' }, ...typeOptions.map((t) => ({ value: t, label: t }))]} />
          <Select label="Temperature" value={temperature} onChange={setTemperature} options={[{ value: '', label: 'All' }, ...tempOptions.map((t) => ({ value: t, label: t }))]} />
          <Select label="Flag" value={flag} onChange={setFlag} options={[{ value: '', label: 'All' }, ...flagOptions.map((f) => ({ value: f, label: flagName(f) }))]} />
        </div>
        <p className="mt-3 text-sm muted" role="status">
          Showing {filtered.length} of {allRows.length} metros
        </p>
      </Card>

      {view === 'both' && (
        <Card
          id="map"
          title="Map"
          actions={
            <>
              <Select
                label="Color by YoY change in"
                value={mapMetric}
                onChange={setMapMetric}
                options={mappable.map((k) => ({ value: k, label: metricLabel(registry, k) }))}
              />
              <button type="button" className="btn self-end" onClick={() => setView('table')}>
                View as table
              </button>
            </>
          }
          footer="Metros reported as divisions of a larger metro share its centroid, so some markers overlap. Map tiles © OpenStreetMap contributors."
        >
          {points.length === 0 ? (
            <EmptyState>No metros match these filters.</EmptyState>
          ) : (
            <MetroMap points={points} onSelect={(slug) => navigate(`/metro/${slug}`)} label={`Map of metros colored by ${metricLabel(registry, mapMetric)} year-over-year change`} />
          )}
          <div className="mt-3">
            <MapLegend title={`${metricLabel(registry, mapMetric)}, YoY`} items={legend} />
          </div>
        </Card>
      )}

      <Card id="table" title="All metros">
        {tableRows.length === 0 ? (
          <EmptyState>No metros match these filters.</EmptyState>
        ) : (
          <SortableTable
            caption="Metros with their latest value and year-over-year change for every metric"
            columns={tableColumns}
            rows={tableRows}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            rowHeader="name"
          />
        )}
      </Card>
    </div>
  );
}
