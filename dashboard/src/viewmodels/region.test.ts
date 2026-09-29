import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RegionGeometrySchema, RegionOutputSchema, type MetricRegistryEntry } from '../data/schema.gen';
import { drill, hasZipHistory, ranked, zipAreaInputs, zipLayer, zipValueAt } from './region';

const read = (p: string) => JSON.parse(readFileSync(resolve(__dirname, '../../sample-data', p), 'utf8'));
const region = RegionOutputSchema.parse(read('regions/orange-county.json'));
const geometry = RegionGeometrySchema.parse(read('regions/orange-county.geo.json'));
const metric = (key: string, change_kind: 'ratio' | 'pp' | 'diff' = 'ratio') => ({ key, change_kind }) as MetricRegistryEntry;
const PRICE = metric('median_sale_price');
const colors = { stops: { cool2: [0, 0, 255], cool1: [100, 100, 255], mid: [128, 128, 128], hot1: [255, 100, 100], hot2: [255, 0, 0] }, low: [10, 10, 10], high: [250, 250, 250] } as const;

describe('region view model (v3 R2)', () => {
  it('shows the agent’s latest values, and past months from the published series', () => {
    const z = region.zips.find((a) => a.id === '92618')!;
    expect(zipValueAt(z, region.dates, PRICE, null)).toEqual({ value: z.latest.median_sale_price!.value, change: z.latest.median_sale_price!.yoy });
    const i = region.dates.length - 13;
    const past = zipValueAt(z, region.dates, PRICE, region.dates[i]!);
    expect(past.value).toBe(z.series.median_sale_price![i]);
    expect(past.change).toBeCloseTo(z.series.median_sale_price![i]! / z.series.median_sale_price![i - 12]! - 1, 12);
    // A metric without a ZIP series has no past months; a month outside the 36 has none either.
    expect(hasZipHistory(region, metric('sold_above_list', 'pp'), region.dates[i]!)).toBe(false);
    expect(hasZipHistory(region, PRICE, '2015-06-30')).toBe(false);
    expect(zipValueAt(z, region.dates, PRICE, '2015-06-30')).toEqual({ value: null, change: null });
  });

  it('builds one feature per polygon for reporting ZIPs, city outlines and labels', () => {
    const layer = zipLayer(region, geometry, PRICE, 'value', null, colors as never);
    const zips = new Set(layer.features.map((f) => f.zip));
    expect(zips.size).toBeGreaterThan(80);
    expect([...zips].every((z) => region.zips.some((a) => a.id === z))).toBe(true);
    expect(layer.cities.map((c) => c.name)).toContain('Irvine');
    expect(layer.scale.kind).toBe('value');
    // Value colors stretch between the 5th and 95th percentile: the priciest ZIP is at the top of the ramp.
    const top = ranked(region.zips, 'median_sale_price')[0]!;
    expect(layer.features.find((f) => f.zip === top.id)!.color).toEqual([250, 250, 250]);
    const yoy = zipLayer(region, geometry, PRICE, 'yoy', null, colors as never);
    expect(yoy.scale.kind).toBe('yoy');
    // A month without ZIP history for the metric falls back to the latest month.
    expect(zipLayer(region, geometry, metric('sold_above_list', 'pp'), 'value', region.dates[5]!, colors as never).month).toBe(region.data_through);
  });

  it('ranks: price and growth high to low, days on market low to high', () => {
    const byPrice = ranked(region.cities, 'median_sale_price');
    expect(byPrice[0]!.latest.median_sale_price!.value!).toBeGreaterThanOrEqual(byPrice[1]!.latest.median_sale_price!.value!);
    const byDays = ranked(region.zips, 'median_dom');
    expect(byDays[0]!.latest.median_dom!.value!).toBeLessThanOrEqual(byDays.at(-1)!.latest.median_dom!.value!);
    // ranks agree with the agent's
    expect(ranked(region.zips, 'median_sale_price')[0]!.ranks.median_sale_price).toBe(1);
  });

  it('drills region → city → ZIP from the URL, falling back on unknown ids', () => {
    expect(drill(region, null, null)).toMatchObject({ level: 'region', children: region.cities });
    const irvine = region.cities.find((c) => c.name === 'Irvine')!;
    const c = drill(region, irvine.id, null);
    expect(c.level).toBe('city');
    expect(c.children.map((z) => z.id).sort()).toEqual([...irvine.zips].sort());
    const z = drill(region, null, '92618');
    expect(z.level).toBe('zip');
    expect(z.crumbs.map((x) => x.label)).toEqual(['Orange County', 'Irvine', '92618']);
    expect(drill(region, 'nope', 'nope').level).toBe('region');
  });

  it('feeds area search the ZIPs with their centroids', () => {
    const inputs = zipAreaInputs(region);
    expect(inputs).toHaveLength(region.zips.length);
    expect(inputs.find((x) => x.name.startsWith('92618'))!.name).toBe('92618 · Irvine');
  });
});
