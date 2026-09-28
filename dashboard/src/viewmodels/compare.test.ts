import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndexOutputSchema, MetroDetailOutputSchema } from '../data/schema.gen';
import { formatValue } from '../lib/format';
import { buildRegistry } from '../lib/metrics';
import { comparableMetrics, compareRows, compareTable, leaderIndex } from './compare';

const read = (p: string) => JSON.parse(readFileSync(resolve(__dirname, '../../sample-data', p), 'utf8'));
const registry = buildRegistry(IndexOutputSchema.parse(read('latest.json')).metric_registry);
const a = MetroDetailOutputSchema.parse(read('metros/pittsburgh-pa.json'));
const b = MetroDetailOutputSchema.parse(read('metros/houston-tx.json'));

describe('compare view model', () => {
  it('lists chartable metrics', () => {
    const metrics = comparableMetrics([a, b], registry);
    expect(metrics[0]).toBe('median_sale_price');
    expect(metrics).not.toContain('permits_total');
  });

  it('overlays metros on shared dates and indexes to 100 at the first non-null month', () => {
    const rows = compareRows([a, b], 'median_sale_price', 'All', true);
    expect(rows.length).toBe(a.series.dates!.length);
    const first = rows.findIndex((r) => r['pittsburgh-pa'] !== null);
    expect(rows[first]!['pittsburgh-pa']).toBe(100);
    const raw = compareRows([a, b], 'median_sale_price', '1Y', false);
    expect(raw.length).toBe(13);
    expect(raw[raw.length - 1]!['pittsburgh-pa']).toBe(a.latest.median_sale_price!.value);
  });

  it('builds a side-by-side table with a leader per row', () => {
    const table = compareTable([a, b], registry);
    const price = table.find((r) => r.key === 'median_sale_price')!;
    expect(price.cells[0]!.value).toBe(formatValue(a.latest.median_sale_price!.value, 'currency'));
    expect(price.leaderLabel).toBe('Highest');
    const sold = table.find((r) => r.key === 'homes_sold')!;
    expect(sold.leaderLabel).toBe('Best'); // good_direction: up
    expect(table.find((r) => r.key === 'payment_now')!.leaderLabel).toBe('Lowest');
  });

  it('picks leaders by direction and skips ties and gaps', () => {
    expect(leaderIndex([1, 3, 2], 'up')).toBe(1);
    expect(leaderIndex([1, 3, 2], 'down')).toBe(0);
    expect(leaderIndex([3, 3], 'up')).toBeNull();
    expect(leaderIndex([3, null], 'up')).toBeNull();
  });
});
