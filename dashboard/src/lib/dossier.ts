/**
 * Metro dossier helpers (pure; tested): the 3D house's scale and temperature light,
 * the region a metro's plate belongs to, and plain-language temperature drivers.
 * Nothing here computes a market figure: they map published values to visuals.
 */

/** House scale = the metro's median price / the U.S. median, clamped to 0.6–1.6× (spec M5). */
export const HOUSE_SCALE_MIN = 0.6;
export const HOUSE_SCALE_MAX = 1.6;

export function houseScale(price: number | null | undefined, usMedian: number | null | undefined): number {
  if (price == null || usMedian == null || !Number.isFinite(price) || !Number.isFinite(usMedian) || usMedian <= 0 || price <= 0) return 1;
  return Math.min(HOUSE_SCALE_MAX, Math.max(HOUSE_SCALE_MIN, price / usMedian));
}

export type RGB = [number, number, number];

export interface LightStops {
  cold: RGB;
  neutral: RGB;
  warm: RGB;
}

export interface TemperatureLight {
  /** Rim light color: cool for a cold market, warm for a hot one. */
  rim: RGB;
  /** 0 (neutral) … 1 (fully cold or hot): how strongly the light leans. */
  lean: number;
  /** −1 cold … +1 hot, from the 0–100 score around 50. */
  side: number;
}

const lerp = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((k) => Math.round(a[k]! + (b[k]! - a[k]!) * t)) as RGB;

/** The house's light from the market temperature (always shown as a number beside it). */
export function temperatureLight(score: number | null | undefined, stops: LightStops): TemperatureLight {
  if (score == null || !Number.isFinite(score)) return { rim: stops.neutral, lean: 0, side: 0 };
  const side = Math.max(-1, Math.min(1, (score - 50) / 50));
  return { rim: side < 0 ? lerp(stops.neutral, stops.cold, -side) : lerp(stops.neutral, stops.warm, side), lean: Math.abs(side), side };
}

export type Region = 'West' | 'Southwest' | 'Midwest' | 'South' | 'Northeast';

const REGION_OF: Record<string, Region> = {};
const assign = (region: Region, states: string) => states.split(' ').forEach((s) => (REGION_OF[s] = region));
assign('West', 'WA OR CA ID MT WY CO UT AK HI');
assign('Southwest', 'AZ NM TX OK NV');
assign('Midwest', 'ND SD NE KS MN IA MO WI IL IN MI OH');
assign('South', 'AR LA MS AL TN KY GA FL SC NC VA WV DC MD DE');
assign('Northeast', 'PA NJ NY CT RI MA VT NH ME');

/** The plate region from a metro name ("Austin, TX", "Kansas City, MO-KS": the first state). */
export function regionOf(name: string): Region | null {
  const m = name.match(/,\s*([A-Z]{2})(?:-[A-Z]{2})*\s*$/);
  return m ? (REGION_OF[m[1]!] ?? null) : null;
}

/** The state code(s) of a metro name ("Kansas City, MO-KS" → "MO-KS"). */
export function statesOf(name: string): string | null {
  return name.match(/,\s*([A-Z]{2}(?:-[A-Z]{2})*)\s*$/)?.[1] ?? null;
}

// Temperature components are published signed: positive heats the market.
const DRIVERS: Record<string, [hot: string, cold: string]> = {
  avg_sale_to_list: ['Homes sell closer to asking', 'Homes sell further below asking'],
  sold_above_list: ['More homes sell over asking', 'Fewer homes sell over asking'],
  off_market_in_two_weeks: ['More homes go under contract within two weeks', 'Fewer homes go under contract quickly'],
  median_dom: ['Homes sell faster', 'Homes take longer to sell'],
  price_drops: ['Fewer listings cut their price', 'More listings cut their price'],
  months_of_supply: ['Supply is tight', 'Supply is building'],
};

export interface Driver {
  key: string;
  value: number;
  label: string;
}

/** The temperature's components as plain sentences, strongest first. */
export function temperatureDrivers(components: Record<string, number> | null | undefined): Driver[] {
  return Object.entries(components ?? {})
    .filter(([, v]) => Number.isFinite(v))
    .map(([key, value]) => ({ key, value, label: DRIVERS[key]?.[value >= 0 ? 0 : 1] ?? key }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}
