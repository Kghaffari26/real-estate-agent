import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndexOutputSchema } from '../data/schema.gen';
import { buildRegistry } from '../lib/metrics';
import { buildMetroRows, filterRows, metricCell, metricColumns, metricsWithData, sortRows } from './metros';

const index = IndexOutputSchema.parse(JSON.parse(readFileSync(resolve(__dirname, '../../sample-data/latest.json'), 'utf8')));
const rows = buildMetroRows(index);
const registry = buildRegistry(index.metric_registry);

describe('metros view model', () => {
  it('builds one row per metro with permits using yoy_12m', () => {
    expect(rows).toHaveLength(50);
    expect(metricCell({ value: 10, yoy_12m: 0.2 })).toEqual({ value: 10, yoy: 0.2 });
    expect(metricCell({ value: 10, yoy: -0.1 })).toEqual({ value: 10, yoy: -0.1 });
    expect(metricCell(undefined)).toEqual({ value: null, yoy: null });
  });

  it('derives metric columns from the registry and the data', () => {
    const columns = metricColumns(registry, rows);
    expect(columns[0]).toBe('median_sale_price');
    expect(columns).not.toContain('mortgage30');
    // Permits are published as null while the BPS source is disabled.
    expect(metricsWithData(columns, rows)).not.toContain('permits_total');
  });

  it('filters by text, market type, flag and temperature', () => {
    const none = { query: '', marketType: '', flag: '', temperature: '' };
    expect(filterRows(rows, { ...none, query: 'pittsburgh' }).map((r) => r.slug)).toEqual(['pittsburgh-pa']);
    const sellers = filterRows(rows, { ...none, marketType: "Seller's market" });
    expect(sellers.length).toBeGreaterThan(0);
    expect(sellers.every((r) => r.marketType === "Seller's market")).toBe(true);
    expect(filterRows(rows, { ...none, flag: 'payment_jump' }).every((r) => r.flags.includes('payment_jump'))).toBe(true);
  });

  it('sorts numbers and strings with nulls last', () => {
    const byYoy = sortRows(rows, 'median_sale_price.yoy', 'desc');
    expect(byYoy[0]!.slug).toBe(index.movers.price_gains[0]!.slug);
    const byName = sortRows(rows, 'name', 'asc');
    expect(byName[0]!.name.localeCompare(byName[1]!.name)).toBeLessThanOrEqual(0);
    const withNull = sortRows([{ ...rows[0]!, temperatureScore: null }, rows[1]!], 'temperature', 'asc');
    expect(withNull[1]!.temperatureScore).toBeNull();
  });
});
