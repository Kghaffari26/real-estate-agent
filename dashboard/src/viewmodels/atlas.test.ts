import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IndexOutputSchema } from '../data/schema.gen';

import { areaSearch } from '../lib/area';
import { timelineFromSeries } from '../lib/timeline';
import { areaMetros, atlasMetrics, atlasMetros, columnSet, formatCamera, parseCamera, pointInPolygon } from './atlas';

const index = IndexOutputSchema.parse(JSON.parse(readFileSync('sample-data/latest.json', 'utf8')));
const metros = atlasMetros(index);
const price = index.metric_registry.find((r) => r.key === 'median_sale_price')!;
const stops = { cool2: [0, 0, 255], cool1: [100, 100, 255], mid: [128, 128, 128], hot1: [255, 150, 100], hot2: [255, 0, 0] } as Parameters<typeof columnSet>[0]['stops'];
const base = { metros, metric: price, colorBy: 'yoy' as const, stops, low: [0, 0, 0] as [number, number, number], high: [255, 255, 255] as [number, number, number] };

describe('atlas view model', () => {
  it('places every metro at a distinct display position, keeping true centroids', () => {
    expect(metros).toHaveLength(50);
    expect(new Set(metros.map((m) => `${m.lat.toFixed(4)},${m.lon.toFixed(4)}`)).size).toBe(50);
    const phl = metros.find((m) => m.slug === 'philadelphia-pa')!;
    const mont = metros.find((m) => m.slug === 'montgomery-county-pa')!;
    expect([phl.trueLat, phl.trueLon]).toEqual([mont.trueLat, mont.trueLon]); // same CBSA centroid…
    expect([phl.lat, phl.lon]).not.toEqual([mont.lat, mont.lon]); // …fanned out for display
  });

  it('offers only metrics most metros report', () => {
    const keys = atlasMetrics(index.metric_registry, metros).map((m) => m.key);
    expect(keys).toContain('median_sale_price');
    expect(keys).toContain('inventory');
    expect(keys).not.toContain('permits_total'); // null everywhere in this run
    expect(keys).not.toContain('mortgage30'); // national only
  });

  it('uses published values and YoY at the latest month', () => {
    const set = columnSet({ ...base, monthIndex: 35, isLatest: true, timeline: null });
    const austin = set.columns.find((c) => c.slug === 'austin-tx')!;
    const published = index.metros.find((m) => m.slug === 'austin-tx')!.latest.median_sale_price!;
    expect(austin.value).toBe(published.value);
    expect(austin.change).toBe('yoy' in published ? published.yoy : null);
    expect(set.bound).toBeCloseTo(Math.max(...metros.map((m) => Math.abs(m.latest.median_sale_price!.yoy!))), 12);
    // From zero: height is the value's share of the largest value in scope.
    const max = Math.max(...set.columns.map((c) => c.value!));
    expect(austin.height).toBeCloseTo(austin.value! / max, 12);
    expect(Math.max(...set.columns.map((c) => c.height!))).toBe(1);
    // YoY heights: centered on zero, the largest |YoY| is full height, sign kept.
    const yoySet = columnSet({ ...base, monthIndex: 35, isLatest: true, timeline: null, heightBy: 'yoy' });
    const a2 = yoySet.columns.find((c) => c.slug === 'austin-tx')!;
    expect(a2.height).toBeCloseTo(a2.change! / yoySet.bound, 12);
    expect(a2.height!).toBeLessThan(0);
    expect(Math.max(...yoySet.columns.map((c) => Math.abs(c.height!)))).toBeCloseTo(1, 12);
  });

  it('reads past months from the history and derives their YoY', () => {
    const files = ['austin-tx', 'denver-co'].map((slug) => ({
      slug,
      series: JSON.parse(readFileSync(`sample-data/metros/${slug}.json`, 'utf8')).series,
    }));
    const timeline = timelineFromSeries(files, 'median_sale_price');
    const two = metros.filter((m) => m.slug === 'austin-tx' || m.slug === 'denver-co');
    const set = columnSet({ ...base, metros: two, monthIndex: 20, isLatest: false, timeline });
    const a = set.columns.find((c) => c.slug === 'austin-tx')!;
    expect(a.value).toBe(files[0]!.series.median_sale_price[20]);
    expect(a.change).toBeCloseTo(files[0]!.series.median_sale_price[20] / files[0]!.series.median_sale_price[8] - 1, 12);
    // before month 12 there is no year-ago value: neutral color, no change
    const early = columnSet({ ...base, metros: two, monthIndex: 3, isLatest: false, timeline }).columns[0]!;
    expect(early.change).toBeNull();
    expect(early.color).toEqual(stops.mid);
  });

  it('feeds area search the latest published values at true centroids', () => {
    const r = areaSearch({ lat: 39.9526, lon: -75.1652 }, 100, areaMetros(metros));
    expect(r.metros.map((m) => m.slug).sort()).toEqual(['baltimore-md', 'montgomery-county-pa', 'nassau-county-ny', 'new-brunswick-nj', 'new-york-ny', 'philadelphia-pa']);
    // Independently: Σ(price × homes sold) / Σ(homes sold) over the six index entries.
    const six = index.metros.filter((m) => r.metros.some((x) => x.slug === m.slug));
    const w = six.reduce((s, m) => s + m.homes_sold_12m!, 0);
    expect(r.price).toBeCloseTo(six.reduce((s, m) => s + m.latest.median_sale_price!.value! * m.homes_sold_12m!, 0) / w, 6);
  });

  it('lassoes in screen space and round-trips the camera', () => {
    const square: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    expect(pointInPolygon(5, 5, square)).toBe(true);
    expect(pointInPolygon(15, 5, square)).toBe(false);
    const cam = { lon: -96.2, lat: 37.4, zoom: 3.35, pitch: 45, bearing: -12 };
    expect(parseCamera(formatCamera(cam))).toEqual(cam);
    expect(parseCamera('1,2,3')).toBeNull();
    expect(parseCamera('0,95,3,10,0')).toBeNull();
  });
});
