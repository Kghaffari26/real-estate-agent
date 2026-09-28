/**
 * Metric metadata. Labels, formats and change kinds come from the published
 * `metric_registry` (never hardcoded per view); this module only adds the display
 * rules the registry leaves implicit (see DECISIONS.md, "unit scale").
 */
import type { MetricRegistryEntry } from '../data/schema.gen';
import type { Scale } from './format';

export type Registry = ReadonlyMap<string, MetricRegistryEntry>;

export function buildRegistry(entries: readonly MetricRegistryEntry[]): Registry {
  return new Map(entries.map((e) => [e.key, e]));
}

/** Registry label, or a humanized key when the registry doesn't list the metric. */
export function metricLabel(registry: Registry, key: string): string {
  return registry.get(key)?.label ?? humanize(key);
}

export function humanize(key: string): string {
  const text = key.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Values in the contract are ratios (0.968), except the FRED rate series, which are
 * published in percent (7.03). The registry marks them as format "percent" with
 * change_kind "diff" (a difference in rate points), which no ratio metric uses.
 */
export function valueScale(entry: MetricRegistryEntry | undefined): Scale {
  return entry?.format === 'percent' && entry.change_kind === 'diff' ? 'points' : 'ratio';
}

/** The display format for a metric's YoY/MoM change (mirrors agents metrics.py). */
export function deltaFormat(entry: MetricRegistryEntry | undefined, published?: string | null): string {
  if (published) return published;
  if (!entry) return 'percent_signed';
  if (entry.change_kind === 'ratio') return 'percent_signed';
  if (entry.change_kind === 'pp') return 'pp_signed';
  if (entry.format === 'days') return 'count_signed';
  if (entry.format === 'percent') return 'pp_signed';
  return 'decimal1';
}

/** Sentiment of a change given the metric's good_direction: 1 good, -1 bad, 0 neutral. */
export function sentiment(goodDirection: string | undefined, change: number | null | undefined): -1 | 0 | 1 {
  if (change === null || change === undefined || change === 0 || !goodDirection || goodDirection === 'neutral') return 0;
  const up = change > 0;
  return (goodDirection === 'up') === up ? 1 : -1;
}

/** Metro metrics offered in charts/tables, in registry order, filtered to those present. */
export function metroMetricKeys(registry: Registry, available: Iterable<string>): string[] {
  const have = new Set(available);
  return [...registry.keys()].filter((key) => have.has(key));
}

/** Registry keys that describe permits (rolling-12-month YoY, §5.1). */
export function isPermitMetric(key: string): boolean {
  return key.startsWith('permits_');
}

/** Temperature components (SPEC §5.3): sign is how the component enters the score. */
export const TEMPERATURE_COMPONENTS: ReadonlyArray<{ key: string; sign: 1 | -1 }> = [
  { key: 'avg_sale_to_list', sign: 1 },
  { key: 'sold_above_list', sign: 1 },
  { key: 'off_market_in_two_weeks', sign: 1 },
  { key: 'median_dom', sign: -1 },
  { key: 'price_drops', sign: -1 },
  { key: 'months_of_supply', sign: -1 },
];

export type TemperatureBand = 'hot' | 'warm' | 'balanced' | 'cool' | 'cold' | 'unknown';

/** Map the published label to a color band (the label itself comes from the agent). */
export function temperatureBand(label: string | null | undefined): TemperatureBand {
  switch ((label ?? '').toLowerCase()) {
    case 'hot':
      return 'hot';
    case 'warm':
      return 'warm';
    case 'balanced':
      return 'balanced';
    case 'cool':
      return 'cool';
    case 'cold':
      return 'cold';
    default:
      return 'unknown';
  }
}

/**
 * Human names for flag ids. The index lists metro flags by id only; metro files and
 * alerts carry the agent's own labels, which always take precedence (SPEC §5.4).
 */
export const FLAG_NAMES: Readonly<Record<string, string>> = {
  inventory_surge: 'Inventory surge',
  inventory_drop: 'Inventory drop',
  price_decline: 'Price decline',
  price_surge: 'Price surge',
  price_36m_high: '36-month price high',
  price_36m_low: '36-month price low',
  price_cuts_high: 'Price cuts at a high',
  slowing: 'Slowing sales',
  buyers_market: "Buyer's market",
  sellers_market: "Seller's market",
  rent_outpacing: 'Rent outpacing values',
  permits_boom: 'Permits boom',
  permits_bust: 'Permits bust',
  payment_jump: 'Payment jump',
};

export function flagName(id: string): string {
  return FLAG_NAMES[id] ?? humanize(id);
}
