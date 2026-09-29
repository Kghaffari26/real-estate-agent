/**
 * The regional market view (v3 R2): a region's published ZIP/city file and shapes →
 * map features, the panel's drill-down, rankings and the table. Pure: every value and
 * change is the agent's (`regions/<slug>.json`); this only picks the month, colors and
 * orders them. The one derivation is a past month's YoY on the map, from the published
 * 36-month series with the same rule the atlas uses for metros (`changeAt`).
 */
import type { MetricRegistryEntry, RegionGeometry, RegionOutput } from '../data/schema.gen';
import { divergingColor, robustBound, sequentialColor, type DivergingStops, type RGB } from '../lib/columns';
import { changeAt } from '../lib/timeline';
import { pointInPolygon } from './atlas';

export type RegionArea = RegionOutput['zips'][number];
export type RegionLevel = 'zip' | 'city';

export interface ZipFeature {
  zip: string;
  city: string | null;
  /** One polygon (rings of [lon, lat]); a MultiPolygon ZIP yields several features. */
  polygon: Array<Array<[number, number]>>;
  value: number | null;
  change: number | null;
  color: RGB;
  /** Fewer than 10 sales in the window (the agent's flag): drawn faded, never ranked. */
  lowSample: boolean;
}

export interface CityOutline {
  id: string;
  name: string;
  paths: Array<Array<[number, number]>>;
  lat: number | null;
  lon: number | null;
}

export interface ZipLayer {
  features: ZipFeature[];
  cities: CityOutline[];
  /** Label points (ZIP centroids) for close zooms. */
  labels: Array<{ zip: string; lat: number; lon: number; text: string }>;
  /** The month shown ("latest" or a month inside the 36-month series), or null when the metric has no ZIP history for the scrubbed month. */
  month: string | null;
  scale: { kind: 'yoy'; bound: number; clamped: boolean } | { kind: 'value'; low: number; high: number };
}

type Geometry = { type: string; coordinates: unknown } | null;

function polygons(g: Geometry): Array<Array<Array<[number, number]>>> {
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates as Array<Array<[number, number]>>];
  if (g.type === 'MultiPolygon') return g.coordinates as Array<Array<Array<[number, number]>>>;
  return [];
}

const quantile = (sorted: readonly number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]!;

/**
 * A ZIP's value and change for `metric` at `month` (an ISO month end), or the latest
 * when `month` is null or the region's latest month. Past months use the published
 * series; metrics without a ZIP series have no past months (null).
 */
export function zipValueAt(area: RegionArea, dates: readonly string[], metric: MetricRegistryEntry, month: string | null): { value: number | null; change: number | null } {
  const latest = area.latest[metric.key];
  if (month === null || month.slice(0, 7) === dates[dates.length - 1]?.slice(0, 7)) return { value: latest?.value ?? null, change: latest?.yoy ?? null };
  const i = dates.findIndex((d) => d.slice(0, 7) === month.slice(0, 7));
  const series = area.series[metric.key];
  if (i < 0 || !series) return { value: null, change: null };
  return { value: series[i] ?? null, change: changeAt(series, i, metric.change_kind) };
}

export function hasZipHistory(region: RegionOutput, metric: MetricRegistryEntry, month: string | null): boolean {
  if (month === null || month.slice(0, 7) === region.data_through.slice(0, 7)) return true;
  return Boolean(region.zips[0]?.series[metric.key]) && region.dates.some((d) => d.slice(0, 7) === month.slice(0, 7));
}

export function zipLayer(region: RegionOutput, geometry: RegionGeometry, metric: MetricRegistryEntry, colorBy: 'yoy' | 'value', month: string | null, colors: { stops: DivergingStops; low: RGB; high: RGB }): ZipLayer {
  const shown = hasZipHistory(region, metric, month) ? month : null;
  const byZip = new Map(region.zips.map((z) => [z.id, { ...zipValueAt(z, region.dates, metric, shown), low: z.low_sample }]));
  // Scales come from well-sampled ZIPs only, so one or two odd sales can't stretch them.
  const sampled = [...byZip.values()].filter((v) => !v.low);
  const values = sampled.map((v) => v.value).filter((v): v is number => v != null).sort((a, b) => a - b);
  // The 90th percentile of |YoY|: one ZIP's +100% luxury mix shift mustn't gray out the rest (beyond it: the end colors).
  const bound = robustBound(sampled.map((v) => v.change), 0.9, 0);
  const low = values.length ? quantile(values, 0.05) : 0;
  const high = values.length ? quantile(values, 0.95) : 1;
  const features: ZipFeature[] = [];
  const cities: CityOutline[] = [];
  const labels: ZipLayer['labels'] = [];
  for (const f of geometry.features as Array<{ geometry: Geometry; properties: Record<string, unknown> }>) {
    const p = f.properties;
    if (p.kind === 'zip') {
      const zip = String(p.id);
      const v = byZip.get(zip);
      if (!v) continue; // a ZIP not reporting this month
      const color = colorBy === 'yoy' ? divergingColor(v.change, bound, colors.stops) : v.value == null ? colors.stops.mid : sequentialColor(high > low ? (v.value - low) / (high - low) : 0.5, colors.low, colors.high);
      for (const polygon of polygons(f.geometry)) features.push({ zip, city: (p.city as string) ?? null, polygon, value: v.value, change: v.change, color, lowSample: v.low });
      if (typeof p.lat === 'number' && typeof p.lon === 'number') labels.push({ zip, lat: p.lat, lon: p.lon, text: zip });
    } else if (p.kind === 'city') {
      cities.push({ id: String(p.id), name: String(p.name), paths: polygons(f.geometry).flat(), lat: (p.lat as number) ?? null, lon: (p.lon as number) ?? null });
    }
  }
  return { features, cities, labels, month: shown ?? region.data_through, scale: colorBy === 'yoy' ? { kind: 'yoy', bound, clamped: sampled.some((v) => v.change != null && Math.abs(v.change) > bound) } : { kind: 'value', low, high } };
}

/** The ZIP (and its city) whose shape contains a point, or null. */
export function placeAt(layer: ZipLayer, lat: number, lon: number): { zip: string; city: string | null } | null {
  for (const f of layer.features) {
    const outer = f.polygon[0];
    if (outer && pointInPolygon(lon, lat, outer)) return { zip: f.zip, city: f.city };
  }
  return null;
}

// ---------- the panel ----------

export type RankKey = 'median_sale_price' | 'median_sale_price_yoy' | 'median_dom' | 'homes_sold';

/**
 * Areas ordered for a ranking list: price and growth high → low, days on market low →
 * high, sales high → low. Low-sample areas (the agent's flag) are left out, as in its ranks.
 */
export function ranked(areas: readonly RegionArea[], key: RankKey): RegionArea[] {
  const get = (a: RegionArea) => (key === 'median_sale_price_yoy' ? a.latest.median_sale_price?.yoy : a.latest[key]?.value) ?? null;
  const asc = key === 'median_dom';
  return [...areas].filter((a) => !a.low_sample && get(a) != null).sort((a, b) => (asc ? get(a)! - get(b)! : get(b)! - get(a)!) || a.name.localeCompare(b.name));
}

export interface Drill {
  level: 'region' | 'city' | 'zip';
  area: RegionArea;
  city: RegionArea | null;
  /** The region, then the city, then the ZIP (each with the URL params that open it). */
  crumbs: Array<{ label: string; city: string | null; zip: string | null }>;
  /** Children to list: the region's cities, a city's ZIPs, or nothing for a ZIP. */
  children: RegionArea[];
}

/** The panel's focus from `?city=<GEOID>&zip=<ZIP>` (a ZIP implies its city). Unknown ids fall back to the region. */
export function drill(region: RegionOutput, cityId: string | null, zipId: string | null): Drill {
  const zip = zipId ? (region.zips.find((z) => z.id === zipId) ?? null) : null;
  const city = zip ? (region.cities.find((c) => c.name === zip.city) ?? null) : cityId ? (region.cities.find((c) => c.id === cityId) ?? null) : null;
  const crumbs: Drill['crumbs'] = [{ label: region.name.replace(/,\s*[A-Z]{2}$/, ''), city: null, zip: null }];
  if (city) crumbs.push({ label: city.name, city: city.id, zip: null });
  if (zip) crumbs.push({ label: zip.id, city: city?.id ?? null, zip: zip.id });
  if (zip) return { level: 'zip', area: zip, city, crumbs, children: [] };
  if (city) return { level: 'city', area: city, city, crumbs, children: region.zips.filter((z) => city.zips.includes(z.id)) };
  return { level: 'region', area: region.summary, city: null, crumbs, children: region.cities };
}

/** Area-search inputs from the region's ZIPs (the same shape as county files). */
export function zipAreaInputs(region: RegionOutput) {
  return region.zips.map((z) => ({
    name: z.city ? `${z.id} · ${z.city}` : z.id,
    lat: z.lat ?? null,
    lon: z.lon ?? null,
    median_sale_price: z.latest.median_sale_price?.value ?? null,
    median_sale_price_yoy: z.latest.median_sale_price?.yoy ?? null,
    inventory: z.latest.inventory?.value ?? null,
    homes_sold: z.latest.homes_sold?.value ?? null,
  }));
}
