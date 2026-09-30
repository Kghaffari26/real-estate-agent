/**
 * The regional market view's panels (v3 R2): the county → city → ZIP drill-down with
 * rankings and a trend, the ZIP hover card, and the region table. Every figure is the
 * agent's (`regions/<slug>.json`); city and county figures are homes-sold-weighted
 * roll-ups of their ZIPs, and the panel says so.
 */
import { ChevronRight, Download, MapPin, X } from 'lucide-react';
import { useState } from 'react';
import type { MetricRegistryEntry, RegionOutput } from '../data/schema.gen';
import { downloadBlob, slugifyFilename, toCsv } from '../lib/csv';
import { formatMonth, formatValue } from '../lib/format';
import { Segmented } from '../ui/controls';
import { MiniSpark } from '../ui/dataviz';
import { GlassPanel } from '../ui/Glass';
import { ranked, type Drill, type RankKey, type RegionArea, type ZipLayer } from '../viewmodels/region';
import { fmtChange, fmtMetric, toneClass } from './format';

type Registry = ReadonlyMap<string, MetricRegistryEntry>;
const RANKS: ReadonlyArray<{ value: RankKey; label: string }> = [
  { value: 'median_sale_price', label: 'Price' },
  { value: 'median_sale_price_yoy', label: 'Growth' },
  { value: 'median_dom', label: 'Speed' },
  { value: 'homes_sold', label: 'Sales' },
];
const KPIS = ['median_sale_price', 'homes_sold', 'median_dom', 'inventory', 'avg_sale_to_list', 'months_of_supply'] as const;

function rankValue(a: RegionArea, key: RankKey, reg: Registry): string {
  if (key === 'median_sale_price_yoy') return fmtChange(reg.get('median_sale_price'), a.latest.median_sale_price?.yoy);
  return fmtMetric(reg.get(key), a.latest[key]?.value);
}

interface RegionPanelProps {
  region: RegionOutput;
  d: Drill;
  registry: Registry;
  metric: MetricRegistryEntry;
  layer: ZipLayer | null;
  requestedMonth: string | null;
  onOpen: (city: string | null, zip: string | null, fly?: { lat: number; lon: number; zoom: number }) => void;
  onClose: () => void;
}

export function RegionPanel({ region, d, registry, metric, layer, requestedMonth, onOpen, onClose }: RegionPanelProps) {
  const [rank, setRank] = useState<RankKey>('median_sale_price');
  const a = d.area;
  const weighted = d.level !== 'zip';
  const title = d.level === 'zip' ? `${a.id}${a.city ? ` · ${a.city}` : ''}` : a.name.replace(/,\s*[A-Z]{2}$/, '');
  const children = ranked(d.children, rank);
  const n = d.level === 'city' || d.level === 'region' ? (d.level === 'region' ? region.cities.length : children.length) : 0;
  const count = d.level === 'zip' ? region.zips.length : region.cities.length;
  const historyFellBack = requestedMonth !== null && layer?.month === region.data_through && requestedMonth.slice(0, 7) !== region.data_through.slice(0, 7);
  return (
    <section aria-labelledby="region-h" data-testid="region-panel">
      <div className="flex items-center gap-2">
        <span className="mp-label flex items-center gap-2 text-mp-accent">
          <MapPin size={14} strokeWidth={1.5} aria-hidden="true" /> Regional market
        </span>
        <span className="flex-1" />
        <button type="button" onClick={onClose} className="rounded-control p-1.5 text-mp-ink-3 hover:bg-mp-ink/[.06] hover:text-mp-ink" aria-label="Close the regional view">
          <X size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
      {d.crumbs.length > 1 && (
        <nav aria-label="Region breadcrumb" className="mt-2 flex flex-wrap items-center gap-1 text-xs text-mp-ink-3">
          {d.crumbs.map((c, i) => (
            <span key={c.label} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={12} aria-hidden="true" />}
              {i < d.crumbs.length - 1 ? (
                <button type="button" className="hover:text-mp-ink hover:underline" onClick={() => onOpen(c.city, c.zip)}>
                  {c.label}
                </button>
              ) : (
                <span className="text-mp-ink-2" aria-current="page">
                  {c.label}
                </span>
              )}
            </span>
          ))}
        </nav>
      )}
      <h2 id="region-h" className="mp-display mt-1 text-[27px] leading-[1.05]" data-testid="region-title">
        {title}
      </h2>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 border-t border-mp-line pt-3" data-testid="region-kpis" aria-live="polite">
        {KPIS.map((k) => {
          const m = a.latest[k];
          const entry = registry.get(k);
          return (
            <div key={k}>
              <dt className="mp-label text-[10px]">
                {entry?.label ?? k}
                {weighted && !['homes_sold', 'inventory'].includes(k) ? ', weighted' : ''}
              </dt>
              <dd className="mp-num mt-0.5 text-[18px] leading-tight text-mp-ink">{fmtMetric(entry, m?.value)}</dd>
              <dd className={`mp-num text-[11px] ${toneClass(m?.yoy)}`}>{fmtChange(entry, m?.yoy)} YoY</dd>
            </div>
          );
        })}
      </dl>
      {(a.series.median_sale_price ?? []).some((v) => v != null) && (
        <div className="mt-3 border-t border-mp-line pt-3">
          <div className="mp-label text-[10px]">Median sale price, 36 months</div>
          <MiniSpark values={a.series.median_sale_price ?? []} width={300} height={40} stroke="rgb(var(--mp-accent))" />
        </div>
      )}
      {d.level !== 'region' && Object.keys(a.ranks).length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5 text-[11px]" aria-label="Ranks in the region">
          {a.ranks.median_sale_price && (
            <li className="rounded-full border border-mp-line px-2 py-0.5">
              #{a.ranks.median_sale_price} of {count} by price
            </li>
          )}
          {a.ranks.median_sale_price_yoy && <li className="rounded-full border border-mp-line px-2 py-0.5">#{a.ranks.median_sale_price_yoy} by growth</li>}
          {a.ranks.median_dom && <li className="rounded-full border border-mp-line px-2 py-0.5">#{a.ranks.median_dom} fastest</li>}
        </ul>
      )}
      {a.low_sample && (
        <p className="mt-3 rounded-control border border-mp-warn/40 px-2.5 py-1.5 text-[12px] text-mp-ink-2" data-testid="low-sample">
          Only {formatValue(a.latest.homes_sold?.value, 'count')} homes sold in these 3 months: the median can swing on one sale, so this area isn't ranked.
        </p>
      )}
      {d.level === 'zip' && d.city && (
        <button
          type="button"
          className="mt-3 text-sm text-mp-accent hover:underline"
          onClick={() => onOpen(d.city!.id, null, d.city!.lat != null && d.city!.lon != null ? { lat: d.city!.lat, lon: d.city!.lon, zoom: 11.2 } : undefined)}
        >
          All of {d.city.name} →
        </button>
      )}
      {d.children.length > 0 && (
        <div className="mt-4 border-t border-mp-line pt-3">
          <div className="flex items-center justify-between gap-2">
            <div className="mp-label">{d.level === 'region' ? `${n} cities` : `${n} ZIP codes`}</div>
            {d.children.length > children.length && <span className="sr-only">{d.children.length - children.length} with fewer than 10 sales aren't ranked</span>}
            <Segmented size="sm" label="Rank by" value={rank} onChange={setRank} options={RANKS} />
          </div>
          <ol className="mt-2 max-h-[34vh] space-y-0.5 overflow-auto pr-1 text-[13px]" data-testid="region-list">
            {children.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="flex w-full items-baseline gap-2 rounded-control px-1.5 py-1 text-left hover:bg-mp-ink/[.06]"
                  onClick={() =>
                    d.level === 'region'
                      ? onOpen(c.id, null, c.lat != null && c.lon != null ? { lat: c.lat, lon: c.lon, zoom: 11.2 } : undefined)
                      : onOpen(d.city?.id ?? null, c.id, c.lat != null && c.lon != null ? { lat: c.lat, lon: c.lon, zoom: 12.2 } : undefined)
                  }
                >
                  <span className="mp-num w-6 flex-none text-right text-[11px] text-mp-ink-3">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-mp-ink">{d.level === 'region' ? c.name : `${c.id}${c.city ? ` · ${c.city}` : ''}`}</span>
                  <span className={`mp-num flex-none ${rank === 'median_sale_price_yoy' ? toneClass(c.latest.median_sale_price?.yoy) : 'text-mp-ink-2'}`}>{rankValue(c, rank, registry)}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
      {d.children.length > children.length && (
        <p className="mt-1 text-[11px] text-mp-ink-3">{d.children.length - children.length} with fewer than 10 sales in the window aren't ranked (see the table view).</p>
      )}
      {layer && <RegionLegend layer={layer} metric={metric} />}
      <p className="mt-3 text-[11px] leading-4 text-mp-ink-3">
        Redfin ZIP data, rolling 3 months ending {formatMonth(region.data_through, true)}.
        {weighted ? ' City and county figures are sums (sales, inventory) or homes-sold-weighted means of their ZIPs.' : ''}
        {historyFellBack ? ` ZIP history covers the last 36 months of price, sales, inventory and days on market; the map shows ${formatMonth(region.data_through, true)}.` : ''}
      </p>
    </section>
  );
}

function RegionLegend({ layer, metric }: { layer: ZipLayer; metric: MetricRegistryEntry }) {
  const s = layer.scale;
  return (
    <div className="mt-3 border-t border-mp-line pt-3" data-testid="region-legend">
      <div className="mp-label text-[10px]">
        ZIP color: {metric.label}
        {s.kind === 'yoy' ? ', change from a year ago' : ''} · {formatMonth(layer.month, true)}
      </div>
      <div
        className={`mt-1.5 h-2 rounded-full ${s.kind === 'yoy' ? 'bg-[linear-gradient(90deg,rgb(var(--mp-cool-2)),rgb(var(--mp-mid)),rgb(var(--mp-hot-2)))]' : 'bg-[linear-gradient(90deg,rgb(var(--mp-ink)/.22),rgb(var(--mp-accent)))]'}`}
        aria-hidden="true"
      />
      <div className="mp-num mt-1 flex justify-between text-[11px] text-mp-ink-3">
        <span>{s.kind === 'yoy' ? fmtChange(metric, -s.bound) : fmtMetric(metric, s.low)}</span>
        {s.kind === 'yoy' && <span>0</span>}
        <span>{s.kind === 'yoy' ? fmtChange(metric, s.bound) : fmtMetric(metric, s.high)}</span>
      </div>
      <div className="text-[10px] text-mp-ink-3">{s.kind === 'value' ? "5th to 95th percentile of the region's ZIPs. " : s.clamped ? 'Larger changes take the end colors. ' : ''}Faded: fewer than 10 sales.</div>
    </div>
  );
}

export function ZipHoverCard({
  area,
  metric,
  value,
  change,
  x,
  y,
  bounds,
}: {
  area: RegionArea;
  metric: MetricRegistryEntry;
  value: number | null;
  change: number | null;
  x: number;
  y: number;
  bounds: { w: number; h: number };
}) {
  const W = 220;
  const left = x + 18 + W > bounds.w ? x - W - 18 : x + 18;
  const top = Math.min(Math.max(72, y - 80), bounds.h - 170);
  return (
    <GlassPanel className="pointer-events-none absolute z-20 p-3.5" style={{ left, top, width: W }} role="tooltip" data-testid="zip-hover-card">
      <div className="flex items-baseline justify-between gap-2">
        <b className="mp-num font-semibold">{area.id}</b>
        <span className="truncate text-[12px] text-mp-ink-3">{area.city ?? ''}</span>
      </div>
      <div className="mp-label mt-2 text-[10px]">{metric.label}</div>
      <div className="mp-num text-[20px] leading-tight">
        {fmtMetric(metric, value)} <span className={`text-xs ${toneClass(change)}`}>{fmtChange(metric, change)}</span>
      </div>
      <div className="mt-1 text-[11px] text-mp-ink-3">
        {formatValue(area.latest.homes_sold?.value, 'count')} sold (3 mo) · {formatValue(area.latest.median_dom?.value, 'count')} days
      </div>
      {area.low_sample && <div className="mt-1 text-[11px] text-mp-warn">Few sales: volatile</div>}
    </GlassPanel>
  );
}

type TableKey = 'name' | 'median_sale_price' | 'median_sale_price_yoy' | 'homes_sold' | 'median_dom' | 'avg_sale_to_list' | 'months_of_supply';
const TABLE_COLS: ReadonlyArray<{ key: TableKey; label: string }> = [
  { key: 'median_sale_price', label: 'Median price' },
  { key: 'median_sale_price_yoy', label: 'YoY' },
  { key: 'homes_sold', label: 'Sold (3 mo)' },
  { key: 'median_dom', label: 'Days' },
  { key: 'avg_sale_to_list', label: 'Sale/list' },
  { key: 'months_of_supply', label: 'Supply' },
];

const cell = (a: RegionArea, k: TableKey): number | string | null => (k === 'name' ? a.name : k === 'median_sale_price_yoy' ? (a.latest.median_sale_price?.yoy ?? null) : (a.latest[k]?.value ?? null));

/** The region as a sortable table (ZIPs or cities), with CSV export of the raw published values. */
export function RegionTable({ region, registry, onOpen, onClose }: { region: RegionOutput; registry: Registry; onOpen: (city: string | null, zip: string | null) => void; onClose: () => void }) {
  const [level, setLevel] = useState<'zip' | 'city'>('zip');
  const [sort, setSort] = useState<{ key: TableKey; dir: 1 | -1 }>({ key: 'median_sale_price', dir: -1 });
  const rows = [...(level === 'zip' ? region.zips : region.cities)].sort((a, b) => {
    const av = cell(a, sort.key);
    const bv = cell(b, sort.key);
    if (av == null) return 1;
    if (bv == null) return -1;
    return (typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)) * sort.dir;
  });
  const fmt = (a: RegionArea, k: TableKey) =>
    k === 'median_sale_price_yoy' ? fmtChange(registry.get('median_sale_price'), a.latest.median_sale_price?.yoy) : k === 'name' ? a.name : fmtMetric(registry.get(k), a.latest[k]?.value);
  const csv = () =>
    downloadBlob(
      new Blob(
        [
          toCsv(
            [level, ...(level === 'zip' ? ['city'] : []), ...TABLE_COLS.map((c) => c.key)],
            rows.map((a) => [level === 'zip' ? a.id : a.name, ...(level === 'zip' ? [a.city ?? ''] : []), ...TABLE_COLS.map((c) => cell(a, c.key) as number | null)]),
          ),
        ],
        { type: 'text/csv;charset=utf-8' },
      ),
      `metro-pulse-${slugifyFilename(`${region.slug} ${level} ${region.data_through}`)}.csv`,
    );
  const th = (key: TableKey, label: string, right = true) => (
    <th scope="col" aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className={`px-3 py-2 font-medium ${right ? 'text-right' : 'text-left'}`}>
      <button type="button" className="hover:text-mp-ink" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'name' || key === 'median_dom' ? 1 : -1 }))}>
        {label}
        {sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
      </button>
    </th>
  );
  return (
    <GlassPanel solid className="flex max-h-full min-h-0 flex-col" role="region" aria-labelledby="region-table-h" data-testid="region-table">
      <div className="flex flex-wrap items-center gap-3 border-b border-mp-line px-4 py-3">
        <h2 id="region-table-h" className="mp-display text-[24px]">
          {region.name.replace(/,\s*[A-Z]{2}$/, '')}
        </h2>
        <Segmented
          size="sm"
          label="Rows"
          value={level}
          onChange={setLevel}
          options={[
            { value: 'zip', label: `ZIPs (${region.zips.length})` },
            { value: 'city', label: `Cities (${region.cities.length})` },
          ]}
        />
        <span className="text-sm text-mp-ink-3">Rolling 3 months to {formatMonth(region.data_through, true)} · † fewer than 10 sales</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={csv}
          className="inline-flex items-center gap-1.5 rounded-control px-2 py-1.5 text-xs text-mp-ink-2 hover:bg-mp-ink/[.06] hover:text-mp-ink"
          data-testid="region-csv"
        >
          <Download size={14} strokeWidth={1.5} aria-hidden="true" /> CSV
        </button>
        <button type="button" onClick={onClose} className="rounded-control p-1.5 text-mp-ink-3 hover:text-mp-ink" aria-label="Back to the map (T)">
          <X size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
      <div className="relative min-h-0 overflow-auto" tabIndex={0} role="group" aria-label={`${level === 'zip' ? 'ZIP code' : 'City'} table, scrollable`}>
        <table className="w-full text-[13px]">
          <caption className="sr-only">
            {region.name} {level === 'zip' ? 'ZIP codes' : 'cities'}: latest rolling 3-month values and year-over-year change; city figures are sums or homes-sold-weighted means of their ZIPs
          </caption>
          <thead className="sticky top-0 bg-mp-panel text-[11px] uppercase tracking-[.06em] text-mp-ink-3">
            <tr>
              {th('name', level === 'zip' ? 'ZIP' : 'City', false)}
              {level === 'zip' && (
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  City
                </th>
              )}
              {TABLE_COLS.map((c) => th(c.key, c.label))}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-t border-mp-line hover:bg-mp-ink/[.04]">
                <th scope="row" className="px-3 py-1.5 text-left font-normal">
                  <button type="button" className="text-mp-ink hover:text-mp-accent" onClick={() => (level === 'zip' ? onOpen(null, a.id) : onOpen(a.id, null))}>
                    {level === 'zip' ? a.id : a.name}
                  </button>
                  {a.low_sample && (
                    <span className="ml-1 text-mp-warn" title="Fewer than 10 sales in the window">
                      †<span className="sr-only"> (fewer than 10 sales)</span>
                    </span>
                  )}
                </th>
                {level === 'zip' && <td className="px-3 py-1.5 text-mp-ink-2">{a.city ?? '—'}</td>}
                {TABLE_COLS.map((c) => (
                  <td key={c.key} className={`mp-num px-3 py-1.5 text-right ${c.key === 'median_sale_price_yoy' ? toneClass(a.latest.median_sale_price?.yoy) : ''}`}>
                    {fmt(a, c.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </GlassPanel>
  );
}

/** The atlas's idle panel entry for each configured region. */
export function RegionShortcuts({ regions, onOpen }: { regions: ReadonlyArray<{ slug: string; name: string; zips: number; cities: number }>; onOpen: (slug: string) => void }) {
  if (!regions.length) return null;
  return (
    <div className="mt-4 border-t border-mp-line pt-3">
      <div className="mp-label">Regional markets</div>
      <ul className="mt-2 space-y-1">
        {regions.map((r) => (
          <li key={r.slug}>
            <button
              type="button"
              onClick={() => onOpen(r.slug)}
              className="flex w-full items-center justify-between gap-2 rounded-control border border-mp-line px-3 py-2 text-left text-sm hover:border-mp-accent"
              data-testid={`open-region-${r.slug}`}
            >
              <span className="text-mp-ink">{r.name}</span>
              <span className="mp-num text-[11px] text-mp-ink-3">
                {r.cities} cities · {r.zips} ZIPs
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
