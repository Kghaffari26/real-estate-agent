import { ChevronsUp, Crown, X } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { TimeSeriesChart } from '../components/charts';
import { Card } from '../components/ui/Card';
import { Checkbox } from '../components/ui/Checkbox';
import { CopyLinkButton } from '../components/ui/CopyLinkButton';
import { MetroSearch } from '../components/ui/MetroSearch';
import { PageHeader } from '../components/ui/PageHeader';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { PageSkeleton } from '../components/ui/Skeleton';
import { EmptyState, ErrorState } from '../components/ui/StateViews';
import { isValidSlug } from '../data/api';
import { useIndex, useMetros } from '../data/hooks';
import type { IndexOutput, MetroDetailOutput } from '../data/schema.gen';
import { useEntityColors } from '../hooks/EntityColors';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useQueryList, useQueryState } from '../hooks/useQueryState';
import { formatMonth } from '../lib/format';
import { buildRegistry, metricLabel, valueScale } from '../lib/metrics';
import { RANGES, type Range } from '../lib/series';
import { color } from '../lib/tokens';
import { comparableMetrics, compareRows, compareTable, MAX_COMPARE } from '../viewmodels/compare';

const RANGE_OPTIONS = RANGES.map((r) => ({ value: r, label: r }));
const shortName = (name: string) => name.replace(/, [A-Z]{2}(-[A-Z]{2})*$/, '');

export function ComparePage() {
  useDocumentTitle('Compare');
  const index = useIndex();
  const [rawSlugs, setSlugs] = useQueryList('m', MAX_COMPARE);
  const slugs = rawSlugs.filter(isValidSlug);
  const metros = useMetros(slugs);
  const colors = useEntityColors();
  const key = slugs.join(',');
  useEffect(() => colors.sync(slugs), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (index.status === 'loading') return <PageSkeleton label="Loading…" />;
  if (index.status === 'error') return <ErrorState error={index.error} onRetry={index.retry} />;

  const loaded = metros.status === 'ready' ? metros.data.filter((r) => r.ok).map((r) => (r as { data: MetroDetailOutput }).data) : [];
  const failed = metros.status === 'ready' ? metros.data.filter((r) => !r.ok).map((r) => r.slug) : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Compare metros" subtitle={`Overlay up to ${MAX_COMPARE} metros. Each keeps its color everywhere in the app.`} actions={<CopyLinkButton />} />
      <section aria-label="Metros being compared" className="card flex flex-wrap items-center gap-3 p-4">
        <ul className="flex flex-wrap gap-2">
          {slugs.map((slug) => {
            const name = index.data.metros.find((m) => m.slug === slug)?.name ?? slug;
            return (
              <li key={slug} className="chip h-8 gap-2 border-border bg-surface-2 pl-2.5 pr-1 text-sm">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: color(colors.colorFor(slug)) }} aria-hidden="true" />
                <Link to={`/metro/${slug}`} className="font-medium text-text no-underline hover:underline">
                  {name}
                </Link>
                <button type="button" className="inline-flex h-6 w-6 items-center justify-center rounded-full text-text-3 hover:bg-surface-3 hover:text-text" aria-label={`Remove ${name}`} onClick={() => setSlugs(slugs.filter((s) => s !== slug))}>
                  <X aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
        {slugs.length < MAX_COMPARE ? (
          <div className="w-full sm:w-72">
            <MetroSearch items={index.data.metros.map((m) => ({ slug: m.slug, name: m.name }))} exclude={slugs} onSelect={(s) => setSlugs([...slugs, s])} label="Add a metro to compare" placeholder="Add a metro…" />
          </div>
        ) : (
          <p className="text-sm text-text-3">Maximum {MAX_COMPARE}: remove one to add another.</p>
        )}
        {failed.length > 0 && (
          <p role="alert" className="w-full text-sm text-bad-text">
            Couldn't load: {failed.join(', ')}
          </p>
        )}
      </section>
      {slugs.length === 0 ? (
        <EmptyState title="Pick metros to compare">Add up to {MAX_COMPARE} metros above, or start from any metro page's “Compare” button.</EmptyState>
      ) : metros.status === 'loading' ? (
        <PageSkeleton label="Loading metros…" />
      ) : metros.status === 'error' ? (
        <ErrorState error={metros.error} onRetry={metros.retry} />
      ) : loaded.length === 0 ? (
        <EmptyState title="None of the selected metros could be loaded" />
      ) : (
        <Comparison index={index.data} metros={loaded} />
      )}
    </div>
  );
}

function Comparison({ index, metros }: { index: IndexOutput; metros: MetroDetailOutput[] }) {
  const registry = useMemo(() => buildRegistry(index.metric_registry), [index]);
  const colors = useEntityColors();
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
  const series = metros.map((m) => ({ key: m.slug, label: m.name, shortLabel: shortName(m.name), color: colors.colorFor(m.slug) }));
  const table = compareTable(metros, registry);

  return (
    <>
      <section aria-label="Chart options" className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <SegmentedControl label="Time range" options={RANGE_OPTIONS} value={range} onChange={setRange} />
          <Checkbox label="Index to 100 (first month in range)" checked={indexed === '1'} onChange={(on) => setIndexed(on ? '1' : '0')} />
        </div>
        <fieldset>
          <legend className="label">Metrics (one chart each, crosshairs linked)</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {available.map((key) => (
              <Checkbox key={key} variant="box" label={metricLabel(registry, key)} checked={metrics.includes(key)} onChange={(on) => toggleMetric(key, on)} />
            ))}
          </div>
        </fieldset>
      </section>

      <div className={`grid grid-cols-1 gap-6 ${metrics.length > 1 ? 'xl:grid-cols-2' : ''}`}>
        {metrics.map((metric) => {
          const entry = registry.get(metric);
          const label = metricLabel(registry, metric);
          return (
            <Card
              key={metric}
              id={`chart-${metric}`}
              title={indexed === '1' ? `${label}, indexed` : label}
              subtitle={indexed === '1' ? 'First month in range = 100' : (entry?.note ?? undefined)}
              copyLink
              exportTitle={`${label}: ${metros.map((m) => m.name).join(' vs ')}`}
              exportSubtitle={`Redfin, monthly, through ${formatMonth(index.data_through, true)}`}
            >
              <TimeSeriesChart
                rows={compareRows(metros, metric, range, indexed === '1')}
                series={series}
                syncId="compare"
                axis={indexed === '1' ? { format: 'index' } : { format: entry?.format ?? 'count', scale: valueScale(entry) }}
                height={280}
                description={`${label} for ${metros.map((m) => m.name).join(', ')}${indexed === '1' ? ', indexed to 100 at the first month' : ''}`}
              />
            </Card>
          );
        })}
      </div>

      <Card id="compare-table" title="Side by side" subtitle="Latest month. Crown: best where a direction is better (e.g. more homes sold, hotter, lower payment); arrows: simply the highest." copyLink>
        <div className="relative max-w-full overflow-x-auto rounded-md border border-border" tabIndex={0} role="region" aria-label="Side-by-side comparison table">
          <table className="table-base min-w-max">
            <caption className="sr-only">Latest values and year-over-year changes for each compared metro, with the leader per metric marked</caption>
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 border-r">
                  Metric
                </th>
                {metros.map((m) => (
                  <th key={m.slug} scope="col" className="text-right">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: color(colors.colorFor(m.slug)) }} aria-hidden="true" />
                      {m.name}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.map((row) => (
                <tr key={row.key}>
                  <th scope="row" className="sticky left-0 z-10 border-b border-r border-border bg-surface px-3 py-2 text-left font-normal text-text-2">
                    {row.label}
                  </th>
                  {row.cells.map((cell, i) => {
                    const lead = row.leader === i;
                    return (
                      <td key={metros[i]!.slug} className={`num text-right ${lead ? 'bg-accent-soft' : ''}`}>
                        <span className="inline-flex items-center gap-1 font-medium">
                          {lead && (
                            <>
                              {row.leaderLabel === 'Highest' ? <ChevronsUp aria-hidden="true" className="h-3 w-3 text-accent" /> : <Crown aria-hidden="true" className="h-3 w-3 text-accent" />}
                              <span className="sr-only">{row.leaderLabel}: </span>
                            </>
                          )}
                          {cell.value}
                        </span>
                        {cell.yoy && <span className={`block text-2xs ${lead ? 'text-text-2' : 'text-text-3'}`}>{cell.yoy} YoY</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
