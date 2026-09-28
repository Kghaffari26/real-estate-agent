import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndexOutputSchema } from '../data/schema.gen';
import { isStale } from '../lib/labels';
import { buildRegistry } from '../lib/metrics';
import { availableColumns, csvTable, DEFAULT_COLUMNS, parseColumns } from './columns';
import { legendSteps, mapPoints, sizeLegend } from './map';
import { buildMetroRows } from './metros';

const index = IndexOutputSchema.parse(JSON.parse(readFileSync(resolve(__dirname, '../../sample-data/latest.json'), 'utf8')));
const registry = buildRegistry(index.metric_registry);
const rows = buildMetroRows(index);

describe('map view model', () => {
  it('places every metro, spreads shared centroids, sizes by homes sold', () => {
    const points = mapPoints(rows, registry, 'median_sale_price');
    expect(points).toHaveLength(50);
    const keys = new Set(points.map((p) => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`));
    expect(keys.size).toBe(50); // no two markers on the same spot
    const biggest = [...rows].sort((a, b) => (b.homesSold12m ?? 0) - (a.homesSold12m ?? 0))[0]!;
    expect(points.find((p) => p.slug === biggest.slug)!.radius).toBe(20);
    expect(points.every((p) => p.color.startsWith('div-'))).toBe(true);
    expect(points[0]!.lines[0]).toMatch(/YoY/);
  });

  it('builds a 7-step legend plus no data, and a size key', () => {
    const steps = legendSteps(rows, registry, 'median_sale_price');
    expect(steps).toHaveLength(8);
    expect(steps[3]!.label).toMatch(/^About flat \(±\d/);
    expect(sizeLegend(rows).length).toBeGreaterThan(1);
  });
});

describe('table columns', () => {
  const available = availableColumns(['median_sale_price', 'inventory', 'months_of_supply', 'median_dom', 'avg_sale_to_list', 'price_drops']);
  it('defaults, validates and exports', () => {
    expect(parseColumns(null, available)).toEqual([...DEFAULT_COLUMNS]);
    expect(parseColumns('inventory.value,bogus', available)).toEqual(['inventory.value']);
    expect(parseColumns('bogus', available)).toEqual([...DEFAULT_COLUMNS]);
    const { header, body } = csvTable(rows.slice(0, 2), ['median_sale_price'], registry);
    expect(header).toContain('median_sale_price_yoy');
    expect(body[0]![0]).toBe(rows[0]!.slug);
  });
});

describe('staleness', () => {
  it('reads the agent warning', () => {
    expect(isStale(['Redfin data runs through May 2026 (120 days old, …)'])).toBe(true);
    expect(isStale(['permits fetch skipped'])).toBe(false);
  });
});
