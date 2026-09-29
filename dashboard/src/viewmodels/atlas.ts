/**
 * Explore atlas view model (pure): metros with display positions, the metric list,
 * per-month column data and area-search inputs. Every figure is a published value
 * or, for past months, read from the published series (see lib/timeline.ts).
 */
import type { AreaMetro } from '../lib/area';
import { divergingBound, divergingColor, extentOf, heightOf, sequentialColor, type DivergingStops, type Extent, type RGB } from '../lib/columns';
import { spreadOverlapping } from '../lib/geo';
import { changeAt, type Timeline } from '../lib/timeline';
import type { IndexOutput, MetricRegistryEntry } from '../data/schema.gen';

export type LayerStyle = 'columns' | 'bubbles' | 'heat' | 'flat';
export const LAYER_STYLES: readonly LayerStyle[] = ['columns', 'bubbles', 'heat', 'flat'];
export type ColorBy = 'yoy' | 'value';
export const COLOR_BY: readonly ColorBy[] = ['yoy', 'value'];

export interface AtlasMetro {
  slug: string;
  name: string;
  /** Display position (metros sharing a CBSA centroid are fanned out). */
  lat: number;
  lon: number;
  /** The true centroid, for distances. */
  trueLat: number;
  trueLon: number;
  homesSold12m: number | null;
  temperature: number | null;
  temperatureLabel: string | null;
  marketType: string | null;
  spark: Array<number | null>;
  latest: Record<string, { value: number | null; yoy: number | null }>;
}

export function atlasMetros(index: Pick<IndexOutput, 'metros'>): AtlasMetro[] {
  const located = index.metros.filter((m) => m.lat != null && m.lon != null);
  const spread = spreadOverlapping(located.map((m) => ({ slug: m.slug, lat: m.lat!, lon: m.lon!, weight: m.homes_sold_12m ?? 0 })));
  const pos = new Map(spread.map((p) => [p.slug, p]));
  return located.map((m) => {
    const latest: AtlasMetro['latest'] = {};
    for (const [k, v] of Object.entries(m.latest)) latest[k] = { value: v.value, yoy: 'yoy' in v ? v.yoy : v.yoy_12m };
    const p = pos.get(m.slug)!;
    return {
      slug: m.slug,
      name: m.name,
      lat: p.displayLat,
      lon: p.displayLon,
      trueLat: m.lat!,
      trueLon: m.lon!,
      homesSold12m: m.homes_sold_12m,
      temperature: m.temperature.score,
      temperatureLabel: m.temperature.label,
      marketType: m.market_type,
      spark: m.spark,
      latest,
    };
  });
}

/** Metrics the atlas can show: registry entries most metros report, registry order. */
export function atlasMetrics(registry: readonly MetricRegistryEntry[], metros: readonly AtlasMetro[]): MetricRegistryEntry[] {
  return registry.filter((r) => metros.filter((m) => m.latest[r.key]?.value != null).length >= Math.ceil(metros.length / 2));
}

export interface ColumnDatum {
  slug: string;
  name: string;
  lon: number;
  lat: number;
  value: number | null;
  change: number | null;
  /** 0…1, null when the metro has no value this month. */
  height: number | null;
  color: RGB;
  homesSold12m: number | null;
}

export interface ColumnInputs {
  metros: readonly AtlasMetro[];
  metric: MetricRegistryEntry;
  /** Month on the axis; the last month uses published values. */
  monthIndex: number;
  isLatest: boolean;
  timeline: Timeline | null;
  colorBy: ColorBy;
  stops: DivergingStops;
  /** Ramp for color-by-value. */
  low: RGB;
  high: RGB;
}

export interface ColumnSet {
  columns: ColumnDatum[];
  extent: Extent | null;
  bound: number;
}

export function columnSet({ metros, metric, monthIndex, isLatest, timeline, colorBy, stops, low, high }: ColumnInputs): ColumnSet {
  const kind = metric.change_kind;
  const at = (m: AtlasMetro) => {
    if (isLatest || !timeline) return m.latest[metric.key] ?? { value: null, yoy: null };
    const s = timeline.metros[m.slug];
    return { value: s?.[monthIndex] ?? null, yoy: changeAt(s, monthIndex, kind) };
  };
  // Scales span the whole history once it's loaded, so scrubbing is comparable month to month.
  const allValues = timeline ? Object.values(timeline.metros).flat() : metros.map((m) => m.latest[metric.key]?.value ?? null);
  const extent = extentOf([...allValues, ...metros.map((m) => m.latest[metric.key]?.value ?? null)]);
  const changes: Array<number | null> = metros.map((m) => m.latest[metric.key]?.yoy ?? null);
  if (timeline) for (const s of Object.values(timeline.metros)) for (let i = 12; i < s.length; i++) changes.push(changeAt(s, i, kind));
  const bound = divergingBound(changes);
  const columns = metros.map((m) => {
    const { value, yoy } = at(m);
    const height = heightOf(value, extent);
    return {
      slug: m.slug,
      name: m.name,
      lon: m.lon,
      lat: m.lat,
      value,
      change: yoy,
      height,
      color: colorBy === 'yoy' ? divergingColor(yoy, bound, stops) : sequentialColor(height, low, high),
      homesSold12m: m.homesSold12m,
    };
  });
  return { columns, extent, bound };
}

/** Area-search inputs from the latest published values (true centroids). */
export function areaMetros(metros: readonly AtlasMetro[]): AreaMetro[] {
  return metros.map((m) => ({
    slug: m.slug,
    name: m.name,
    lat: m.trueLat,
    lon: m.trueLon,
    homesSold12m: m.homesSold12m,
    price: m.latest.median_sale_price?.value ?? null,
    yoy: m.latest.median_sale_price?.yoy ?? null,
    inventory: m.latest.inventory?.value ?? null,
    temperatureLabel: m.temperatureLabel,
  }));
}

/** Screen-space lasso: which points fall inside a polygon (even-odd rule). */
export function pointInPolygon(x: number, y: number, poly: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

export interface Camera {
  lon: number;
  lat: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

export const DEFAULT_CAMERA: Camera = { lon: -96.2, lat: 37.4, zoom: 3.35, pitch: 45, bearing: -12 };
export const MOBILE_CAMERA: Camera = { lon: -96.8, lat: 42.5, zoom: 2.05, pitch: 25, bearing: 0 };

export function parseCamera(raw: string | null | undefined): Camera | null {
  if (!raw) return null;
  const n = raw.split(',').map(Number);
  if (n.length !== 5 || n.some((x) => !Number.isFinite(x))) return null;
  const [lon, lat, zoom, pitch, bearing] = n as [number, number, number, number, number];
  if (Math.abs(lat) > 85 || Math.abs(lon) > 180 || zoom < 0 || zoom > 20 || pitch < 0 || pitch > 85) return null;
  return { lon, lat, zoom, pitch, bearing };
}

export function formatCamera(c: Camera): string {
  return [c.lon.toFixed(3), c.lat.toFixed(3), c.zoom.toFixed(2), Math.round(c.pitch), Math.round(c.bearing)].join(',');
}
