import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndexOutputSchema, MetroDetailOutputSchema } from '../data/schema.gen';
import { buildRegistry } from '../lib/metrics';
import { comparableMetrics, compareRows, compareTable } from './compare';

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

  it('overlays metros on shared dates and indexes to 100', () => {
    const rows = compareRows([a, b], 'median_sale_price', 'All', true);
    expect(rows.length).toBe(36);
    // The sample's first two metro months are null; the base is the first non-null month.
    const first = rows.findIndex((r) => r['pittsburgh-pa'] !== null);
    expect(rows[first]!['pittsburgh-pa']).toBe(100);
    expect(rows[first]!['houston-tx']).toBe(100);
    const raw = compareRows([a, b], 'median_sale_price', '1Y', false);
    expect(raw.length).toBe(13);
    expect(raw[raw.length - 1]!['pittsburgh-pa']).toBe(275000);
  });

  it('builds a side-by-side table', () => {
    const table = compareTable([a, b], registry);
    const price = table.find((r) => r.key === 'median_sale_price')!;
    expect(price.cells[0]!.value).toBe('$275,000');
    expect(price.cells[0]!.yoy).toBe('+7.8%');
    expect(table.find((r) => r.key === 'payment_now')).toBeDefined();
  });
});
