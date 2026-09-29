/**
 * Area search (spec M3): which metros sit inside a ring, and their aggregate.
 *
 * The aggregate is a *homes-sold-weighted mean of metro medians*, not a median of
 * all sales in the ring (the data has no sale-level records); the UI labels it as
 * weighted. Weights are each metro's `homes_sold_12m`. A metro without a weight or a
 * value is listed but doesn't count toward that figure, and the result reports the
 * weight it rests on.
 */
import { geoCircle } from 'd3-geo';

export const EARTH_RADIUS_MI = 3958.8;

export interface LatLon {
  lat: number;
  lon: number;
}

export interface AreaMetro extends LatLon {
  slug: string;
  name: string;
  homesSold12m: number | null;
  price: number | null;
  yoy: number | null;
  inventory: number | null;
  temperatureLabel: string | null;
}

export interface AreaResult {
  center: LatLon;
  radiusMi: number;
  /** Metros inside the ring, nearest first, with their distance in miles. */
  metros: Array<AreaMetro & { miles: number }>;
  /** Weighted mean of median sale prices (null when nothing inside has a price and a weight). */
  price: number | null;
  yoy: number | null;
  /** Sum of active inventory over metros that report it. */
  inventory: number | null;
  /** Homes sold (12 months) across the ring: the weight the aggregates rest on. */
  homesSold12m: number;
  /** Count of metros per temperature label ("Cold", "Balanced"…). */
  temperatures: Record<string, number>;
}

const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in miles (haversine). */
export function milesBetween(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

function weightedMean(items: readonly AreaMetro[], pick: (m: AreaMetro) => number | null): number | null {
  let sum = 0;
  let weight = 0;
  for (const m of items) {
    const v = pick(m);
    const w = m.homesSold12m;
    if (v == null || !Number.isFinite(v) || w == null || !(w > 0)) continue;
    sum += v * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : null;
}

export function areaSearch(center: LatLon, radiusMi: number, metros: readonly AreaMetro[]): AreaResult {
  const inside = metros
    .map((m) => ({ ...m, miles: milesBetween(center, m) }))
    .filter((m) => m.miles <= radiusMi)
    .sort((a, b) => a.miles - b.miles || a.name.localeCompare(b.name));
  const inv = inside.filter((m) => m.inventory != null && Number.isFinite(m.inventory));
  const temperatures: Record<string, number> = {};
  for (const m of inside) {
    const key = m.temperatureLabel ?? 'Unknown';
    temperatures[key] = (temperatures[key] ?? 0) + 1;
  }
  return {
    center,
    radiusMi,
    metros: inside,
    price: weightedMean(inside, (m) => m.price),
    yoy: weightedMean(inside, (m) => m.yoy),
    inventory: inv.length ? inv.reduce((s, m) => s + (m.inventory as number), 0) : null,
    homesSold12m: inside.reduce((s, m) => s + (m.homesSold12m != null && m.homesSold12m > 0 ? m.homesSold12m : 0), 0),
    temperatures,
  };
}

/** The ring as a closed [lon, lat] polygon for the map (a geodesic circle). */
export function ringPolygon(center: LatLon, radiusMi: number, steps = 96): Array<[number, number]> {
  const degrees = (radiusMi / EARTH_RADIUS_MI) * (180 / Math.PI);
  const poly = geoCircle()
    .center([center.lon, center.lat])
    .radius(degrees)
    .precision(360 / steps)();
  return (poly.coordinates[0] as Array<[number, number]>).map(([x, y]) => [x, y]);
}

/** `?pin=lat,lon` → a point, or null when it isn't a valid coordinate. */
export function parsePin(raw: string | null | undefined): LatLon | null {
  if (!raw) return null;
  const [a, b] = raw.split(',').map(Number);
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a < -90 || a > 90 || b < -180 || b > 180) return null;
  return { lat: a, lon: b };
}

export function formatPin(p: LatLon): string {
  return `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
}

export const RADIUS_MIN = 10;
export const RADIUS_MAX = 250;
export const RADIUS_DEFAULT = 75;

export function parseRadius(raw: string | null | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= RADIUS_MIN && n <= RADIUS_MAX ? n : RADIUS_DEFAULT;
}

// ---------- counties (agent §6.7 `areas/<slug>.json`) ----------

/** How far a county centroid can sit from its metro's center; wider than any tracked metro. */
export const COUNTY_REACH_MI = 90;

export interface AreaCountyInput {
  name: string;
  lat: number | null;
  lon: number | null;
  median_sale_price: number | null;
  median_sale_price_yoy: number | null;
  inventory: number | null;
  homes_sold: number | null;
}

export interface AreaCounty extends LatLon {
  name: string;
  metro: string;
  miles: number;
  price: number | null;
  yoy: number | null;
  inventory: number | null;
  homesSold: number | null;
}

export interface CountyResult {
  /** Counties whose centroid is inside the ring, most homes sold first. */
  counties: AreaCounty[];
  /** Homes-sold-weighted mean of county medians (the latest month's sales are the weights). */
  price: number | null;
  yoy: number | null;
  inventory: number | null;
  homesSold: number;
}

/** Metros whose county files could reach into the ring (load only these). */
export function metrosNearRing(center: LatLon, radiusMi: number, metros: ReadonlyArray<LatLon & { slug: string }>): string[] {
  return metros.filter((m) => milesBetween(center, m) <= radiusMi + COUNTY_REACH_MI).map((m) => m.slug);
}

/**
 * Counties inside the ring, from the metros' published county files. A county is in
 * when its Gazetteer centroid is; one without a centroid can't be placed and is left
 * out. Aggregates are homes-sold-weighted like the metro figures (labelled weighted).
 */
export function countySearch(center: LatLon, radiusMi: number, files: ReadonlyArray<{ slug: string; areas: readonly AreaCountyInput[] }>): CountyResult {
  const seen = new Set<string>();
  const counties: AreaCounty[] = [];
  for (const f of files) {
    for (const a of f.areas) {
      if (a.lat == null || a.lon == null || seen.has(a.name)) continue;
      const miles = milesBetween(center, { lat: a.lat, lon: a.lon });
      if (miles > radiusMi) continue;
      seen.add(a.name);
      counties.push({ name: a.name, metro: f.slug, lat: a.lat, lon: a.lon, miles, price: a.median_sale_price, yoy: a.median_sale_price_yoy, inventory: a.inventory, homesSold: a.homes_sold });
    }
  }
  counties.sort((a, b) => (b.homesSold ?? -1) - (a.homesSold ?? -1) || a.name.localeCompare(b.name));
  const weighted = (pick: (c: AreaCounty) => number | null) => {
    let sum = 0;
    let w = 0;
    for (const c of counties) {
      const v = pick(c);
      if (v == null || !Number.isFinite(v) || c.homesSold == null || !(c.homesSold > 0)) continue;
      sum += v * c.homesSold;
      w += c.homesSold;
    }
    return w > 0 ? sum / w : null;
  };
  const inv = counties.filter((c) => c.inventory != null);
  return {
    counties,
    price: weighted((c) => c.price),
    yoy: weighted((c) => c.yoy),
    inventory: inv.length ? inv.reduce((s, c) => s + (c.inventory as number), 0) : null,
    homesSold: counties.reduce((s, c) => s + (c.homesSold != null && c.homesSold > 0 ? c.homesSold : 0), 0),
  };
}
