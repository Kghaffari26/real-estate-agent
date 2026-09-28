/** Metros table columns: ids, defaults and CSV values (pure). */
import type { Registry } from '../lib/metrics';
import type { MetroRow } from './metros';

/** Column ids are "<metric>.value" / "<metric>.yoy" plus fixed ones. */
export const DEFAULT_COLUMNS = [
  'median_sale_price.value',
  'median_sale_price.yoy',
  'inventory.yoy',
  'months_of_supply.value',
  'median_dom.value',
  'avg_sale_to_list.value',
  'price_drops.value',
] as const;

export function parseColumns(raw: string | null, available: readonly string[]): string[] {
  if (!raw) return DEFAULT_COLUMNS.filter((c) => available.includes(c));
  const picked = raw.split(',').filter((c) => available.includes(c));
  return picked.length ? picked : DEFAULT_COLUMNS.filter((c) => available.includes(c));
}

export function availableColumns(metrics: readonly string[]): string[] {
  return metrics.flatMap((k) => [`${k}.value`, `${k}.yoy`]);
}

/** CSV of the filtered rows: raw numbers (ratios as ratios), one value + YoY pair per metric. */
export function csvTable(rows: readonly MetroRow[], metrics: readonly string[], registry: Registry): { header: string[]; body: (string | number | null)[][] } {
  const header = ['slug', 'metro', 'temperature', 'temperature_label', 'market_type', 'flags', 'homes_sold_12m'];
  for (const k of metrics) header.push(`${k}`, `${k}_yoy${k.startsWith('permits_') ? '_12m' : ''}`);
  const body = rows.map((r) => {
    const out: (string | number | null)[] = [r.slug, r.name, r.temperatureScore, r.temperatureLabel, r.marketType, r.flags.join(' '), r.homesSold12m];
    for (const k of metrics) out.push(r.metrics[k]?.value ?? null, r.metrics[k]?.yoy ?? null);
    return out;
  });
  void registry;
  return { header, body };
}
