/**
 * The weekly pulse (`pulse.json`, agent §6.6) for the ticker and the dossier. Pure:
 * every value and YoY is the agent's; this only picks, orders and shapes them.
 */
import type { PulseOutput } from '../data/schema.gen';

export const PULSE_METRICS = [
  { key: 'median_sale_price', label: 'Median sale price', format: 'currency' },
  { key: 'pending_sales', label: 'Pending sales', format: 'count' },
  { key: 'new_listings', label: 'New listings', format: 'count' },
  { key: 'active_listings', label: 'Active listings', format: 'count' },
] as const;

export type PulseKey = (typeof PULSE_METRICS)[number]['key'];

export interface TickerItem {
  slug: string;
  name: string;
  price: number | null;
  yoy: number | null;
  spark: Array<number | null>;
}

const last = <T,>(xs: readonly T[]): T | undefined => xs[xs.length - 1];

/**
 * One item per metro with a latest price, ordered by the latest window's price YoY
 * (fastest first; unknown YoY last, then by name).
 */
export function tickerItems(pulse: PulseOutput, names: ReadonlyMap<string, string>): TickerItem[] {
  return Object.entries(pulse.metros)
    .map(([slug, series]) => {
      const spark = series.median_sale_price ?? [];
      return { slug, name: names.get(slug) ?? slug, price: last(spark) ?? null, yoy: pulse.yoy[slug]?.median_sale_price ?? null, spark };
    })
    .filter((x) => x.price != null)
    .sort((a, b) => (b.yoy ?? -Infinity) - (a.yoy ?? -Infinity) || a.name.localeCompare(b.name));
}

export interface MetroPulseRow {
  key: PulseKey;
  label: string;
  format: string;
  values: Array<number | null>;
  latest: number | null;
  yoy: number | null;
}

/** One metro's four weekly series, or null when the pulse doesn't cover it. */
export function metroPulse(pulse: PulseOutput, slug: string): { weeks: string[]; windowWeeks: number; rows: MetroPulseRow[] } | null {
  const series = pulse.metros[slug];
  if (!series) return null;
  const rows = PULSE_METRICS.map(({ key, label, format }) => {
    const values = series[key] ?? pulse.weeks.map(() => null);
    return { key, label, format, values, latest: last(values) ?? null, yoy: pulse.yoy[slug]?.[key] ?? null };
  });
  return rows.every((r) => r.values.every((v) => v == null)) ? null : { weeks: pulse.weeks, windowWeeks: pulse.window_weeks, rows };
}
