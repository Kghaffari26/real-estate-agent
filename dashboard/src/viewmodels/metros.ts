/** View model for the Metros page: rows, filtering and sorting (pure, unit-tested). */
import type { IndexOutput, MetroSummary } from '../data/schema.gen';
import type { Registry } from '../lib/metrics';

export interface MetricCell {
  value: number | null;
  /** YoY; for permits the rolling-12-month YoY (§5.1). */
  yoy: number | null;
}

export interface MetroRow {
  slug: string;
  name: string;
  lat: number | null;
  lon: number | null;
  homesSold12m: number | null;
  temperatureScore: number | null;
  temperatureLabel: string | null;
  marketType: string | null;
  flags: string[];
  metrics: Record<string, MetricCell>;
  stale: boolean;
}

export function metricCell(summary: MetroSummary['latest'][string] | undefined): MetricCell {
  if (!summary) return { value: null, yoy: null };
  const yoy = 'yoy_12m' in summary ? summary.yoy_12m : 'yoy' in summary ? summary.yoy : null;
  return { value: summary.value ?? null, yoy: yoy ?? null };
}

export function buildMetroRows(index: Pick<IndexOutput, 'metros'>): MetroRow[] {
  return index.metros.map((m) => ({
    slug: m.slug,
    name: m.name,
    lat: m.lat,
    lon: m.lon,
    homesSold12m: m.homes_sold_12m ?? null,
    temperatureScore: m.temperature.score,
    temperatureLabel: m.temperature.label,
    marketType: m.market_type,
    flags: m.flags,
    metrics: Object.fromEntries(Object.entries(m.latest).map(([k, v]) => [k, metricCell(v)])),
    stale: m.stale,
  }));
}

/** Registry metrics that at least one metro reports (in registry order). */
export function metricColumns(registry: Registry, rows: readonly MetroRow[]): string[] {
  const present = new Set(rows.flatMap((r) => Object.keys(r.metrics)));
  return [...registry.keys()].filter((k) => present.has(k));
}

/** Metrics with at least one non-null value (e.g. excludes permits while BPS is off). */
export function metricsWithData(keys: readonly string[], rows: readonly MetroRow[]): string[] {
  return keys.filter((k) => rows.some((r) => r.metrics[k]?.value !== null && r.metrics[k]?.value !== undefined));
}

export interface MetroFilters {
  query: string;
  marketType: string;
  flag: string;
  temperature: string;
}

export function filterRows(rows: readonly MetroRow[], f: MetroFilters): MetroRow[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!q || r.name.toLowerCase().includes(q) || r.slug.includes(q)) &&
      (!f.marketType || r.marketType === f.marketType) &&
      (!f.flag || r.flags.includes(f.flag)) &&
      (!f.temperature || r.temperatureLabel === f.temperature),
  );
}

export type SortDir = 'asc' | 'desc';

/** Sort keys: "name", "temperature", "market_type", "homes_sold_12m", "<metric>.value", "<metric>.yoy". */
export function sortValue(row: MetroRow, key: string): number | string | null {
  switch (key) {
    case 'name':
      return row.name;
    case 'temperature':
      return row.temperatureScore;
    case 'market_type':
      return row.marketType;
    case 'homes_sold_12m':
      return row.homesSold12m;
    default: {
      const [metric, field] = key.split('.') as [string, string | undefined];
      const cell = row.metrics[metric];
      if (!cell) return null;
      return field === 'yoy' ? cell.yoy : cell.value;
    }
  }
}

/** Stable sort; nulls always last regardless of direction. */
export function sortRows(rows: readonly MetroRow[], key: string, dir: SortDir): MetroRow[] {
  const factor = dir === 'asc' ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, v: sortValue(row, key) }))
    .sort((a, b) => {
      if (a.v === null && b.v === null) return a.i - b.i;
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      const cmp = typeof a.v === 'string' || typeof b.v === 'string' ? String(a.v).localeCompare(String(b.v)) : a.v - b.v;
      return cmp !== 0 ? cmp * factor : a.i - b.i;
    })
    .map((x) => x.row);
}

export function distinct(values: readonly (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].sort();
}
