import { describe, expect, it } from 'vitest';
import { createTimeStore } from '../state/timeStore';
import { areaSearch, milesBetween, parsePin, parseRadius, ringPolygon, type AreaMetro } from './area';
import { divergingBound, divergingColor, extentOf, heightOf, HEIGHT_FLOOR, parseChannels } from './columns';
import { changeAt, monthIndex, timelineFromSeries } from './timeline';

const metro = (slug: string, lat: number, lon: number, o: Partial<AreaMetro> = {}): AreaMetro => ({
  slug,
  name: slug,
  lat,
  lon,
  homesSold12m: 1000,
  price: 400_000,
  yoy: 0.02,
  inventory: 5000,
  temperatureLabel: 'Balanced',
  ...o,
});

describe('area search', () => {
  const philly = { lat: 39.95, lon: -75.16 };
  const metros = [
    metro('philadelphia', 39.95, -75.16, { homesSold12m: 3000, price: 300_000, yoy: 0.04, temperatureLabel: 'Balanced' }),
    metro('new-york', 40.71, -74.0, { homesSold12m: 1000, price: 700_000, yoy: 0.0, temperatureLabel: 'Hot' }),
    metro('pittsburgh', 40.44, -79.99, { homesSold12m: 9999 }), // ~255 mi away
  ];

  it('measures great-circle miles', () => {
    expect(milesBetween(philly, { lat: 40.71, lon: -74.0 })).toBeCloseTo(80.5, 0);
    expect(milesBetween(philly, philly)).toBe(0);
  });

  it('keeps metros inside the ring, nearest first, weighted by homes sold', () => {
    const r = areaSearch(philly, 100, metros);
    expect(r.metros.map((m) => m.slug)).toEqual(['philadelphia', 'new-york']);
    expect(r.price).toBeCloseTo((300_000 * 3000 + 700_000 * 1000) / 4000, 6);
    expect(r.yoy).toBeCloseTo((0.04 * 3000) / 4000, 10);
    expect(r.inventory).toBe(10_000);
    expect(r.homesSold12m).toBe(4000);
    expect(r.temperatures).toEqual({ Balanced: 1, Hot: 1 });
  });

  it('returns nulls for an empty ring', () => {
    const r = areaSearch({ lat: 0, lon: 0 }, 50, metros);
    expect(r.metros).toEqual([]);
    expect([r.price, r.yoy, r.inventory]).toEqual([null, null, null]);
    expect(r.homesSold12m).toBe(0);
  });

  it('with one metro, the aggregate is that metro', () => {
    const r = areaSearch(philly, 10, metros);
    expect(r.metros).toHaveLength(1);
    expect(r.price).toBe(300_000);
    expect(r.yoy).toBe(0.04);
  });

  it('lists metros without weights or values but leaves them out of the averages', () => {
    const r = areaSearch(philly, 100, [metros[0]!, metro('x', 40.0, -75.2, { homesSold12m: null, price: 9e9 }), metro('y', 40.0, -75.1, { price: null, inventory: null })]);
    expect(r.metros).toHaveLength(3);
    expect(r.price).toBeCloseTo((300_000 * 3000) / 3000, 6); // x has no weight, y no price
    expect(r.inventory).toBe(5000 + 5000); // philadelphia + x
  });

  it('draws a closed geodesic ring and parses URL state', () => {
    const ring = ringPolygon(philly, 100, 48);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (const [lon, lat] of ring.slice(0, -1)) expect(milesBetween(philly, { lat, lon })).toBeCloseTo(100, 0);
    expect(parsePin('39.95,-75.16')).toEqual(philly);
    expect(parsePin('95,0')).toBeNull();
    expect(parsePin('abc')).toBeNull();
    expect(parseRadius('120')).toBe(120);
    expect(parseRadius('9')).toBe(75);
    expect(parseRadius(null)).toBe(75);
  });
});

describe('column scale', () => {
  it('normalizes heights min→max with a visible floor', () => {
    const e = extentOf([229_000, null, 1_220_000, 500_000, Number.NaN]);
    expect(e).toEqual({ min: 229_000, max: 1_220_000 });
    expect(heightOf(229_000, e)).toBe(HEIGHT_FLOOR);
    expect(heightOf(1_220_000, e)).toBe(1);
    expect(heightOf(2_000_000, e)).toBe(1); // clamped
    expect(heightOf(null, e)).toBeNull();
    expect(heightOf(5, { min: 5, max: 5 })).toBe(1);
    expect(extentOf([null])).toBeNull();
  });

  it('colors YoY on a symmetric diverging scale', () => {
    const s = { cool2: [0, 0, 255], cool1: [100, 100, 255], mid: [128, 128, 128], hot1: [255, 150, 100], hot2: [255, 0, 0] } as const;
    const stops = { cool2: [...s.cool2], cool1: [...s.cool1], mid: [...s.mid], hot1: [...s.hot1], hot2: [...s.hot2] } as Parameters<typeof divergingColor>[2];
    const b = divergingBound([-0.063, 0.086, null]);
    expect(b).toBe(0.086);
    expect(divergingColor(0, b, stops)).toEqual([128, 128, 128]);
    expect(divergingColor(0.086, b, stops)).toEqual([255, 0, 0]);
    expect(divergingColor(-0.2, b, stops)).toEqual([0, 0, 255]); // clamped
    expect(divergingColor(null, b, stops)).toEqual([128, 128, 128]);
    expect(divergingBound([])).toBe(1);
    expect(parseChannels(' 92 225 230 ')).toEqual([92, 225, 230]);
    expect(parseChannels('bad')).toEqual([136, 136, 136]);
  });
});

describe('timeline', () => {
  const files = [
    { slug: 'a', series: { dates: ['2025-01-31', '2025-02-28'], price: [100, 110] } },
    { slug: 'b', series: { dates: ['2025-02-28'], price: [7] } },
  ];

  it('aligns every metro on the longest date axis', () => {
    const t = timelineFromSeries(files, 'price');
    expect(t.dates).toEqual(['2025-01-31', '2025-02-28']);
    expect(t.metros).toEqual({ a: [100, 110], b: [null, 7] });
    expect(monthIndex(t.dates, '2025-01')).toBe(0);
    expect(monthIndex(t.dates, '1999-01')).toBe(1);
    expect(monthIndex(t.dates, null)).toBe(1);
  });

  it('derives the 12-month change by the metric kind', () => {
    const s = [...Array(12).fill(null), 110] as Array<number | null>;
    s[0] = 100;
    expect(changeAt(s, 12, 'ratio')).toBeCloseTo(0.1, 10);
    expect(changeAt(s, 12, 'diff')).toBe(10);
    expect(changeAt(s, 11, 'ratio')).toBeNull();
    expect(changeAt([0, ...Array(11).fill(1), 5], 12, 'ratio')).toBeNull();
  });
});

describe('time store', () => {
  it('clamps manual steps, wraps playback and restarts from the end', () => {
    const s = createTimeStore();
    s.getState().setCount(36);
    expect(s.getState().index).toBe(35);
    s.getState().step(1);
    expect(s.getState().index).toBe(35);
    s.getState().step(1, true);
    expect(s.getState().index).toBe(0);
    s.getState().step(-1);
    expect(s.getState().index).toBe(0);
    s.getState().setIndex(99);
    expect(s.getState().index).toBe(35);
    s.getState().setPlaying(true);
    expect(s.getState()).toMatchObject({ playing: true, index: 0 });
    s.getState().togglePlaying();
    expect(s.getState().playing).toBe(false);
    s.getState().setCount(24, 5);
    expect(s.getState().index).toBe(5);
  });
});
