import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AreasOutputSchema } from '../data/schema.gen';
import { COUNTY_REACH_MI, countySearch, metrosNearRing, milesBetween, type AreaCountyInput } from './area';

const county = (name: string, lat: number | null, lon: number | null, o: Partial<AreaCountyInput> = {}): AreaCountyInput => ({
  name,
  lat,
  lon,
  median_sale_price: 400_000,
  median_sale_price_yoy: 0.02,
  inventory: 100,
  homes_sold: 100,
  ...o,
});

describe('county search (finer geography)', () => {
  const center = { lat: 40, lon: -75 };

  it('keeps counties whose centroid is in the ring, weights by homes sold, dedupes across metros', () => {
    const r = countySearch(center, 50, [
      { slug: 'a', areas: [county('Near County, PA', 40.1, -75.1, { homes_sold: 300, median_sale_price: 500_000, median_sale_price_yoy: 0.04 }), county('Far County, PA', 42, -75), county('Unplaced County, PA', null, null)] },
      { slug: 'b', areas: [county('Near County, PA', 40.1, -75.1), county('Other County, NJ', 39.8, -74.8, { homes_sold: 100, median_sale_price: 300_000, median_sale_price_yoy: null, inventory: null })] },
    ]);
    expect(r.counties.map((c) => [c.name, c.metro])).toEqual([
      ['Near County, PA', 'a'],
      ['Other County, NJ', 'b'],
    ]);
    expect(r.price).toBeCloseTo((500_000 * 300 + 300_000 * 100) / 400, 6);
    expect(r.yoy).toBeCloseTo(0.04, 9); // the county without a YoY doesn't count toward it
    expect(r.inventory).toBe(100);
    expect(r.homesSold).toBe(400);
    expect(r.counties[0]!.miles).toBeCloseTo(milesBetween(center, { lat: 40.1, lon: -75.1 }), 9);
  });

  it('is empty (not zero) when nothing is inside', () => {
    expect(countySearch(center, 10, [{ slug: 'a', areas: [county('Far County, PA', 45, -75)] }])).toEqual({ counties: [], price: null, yoy: null, inventory: null, homesSold: 0 });
  });

  it('loads only metros that could reach the ring', () => {
    const metros = [
      { slug: 'in', lat: 40, lon: -75 },
      { slug: 'edge', lat: 40 + (60 + COUNTY_REACH_MI - 5) / 69, lon: -75 },
      { slug: 'out', lat: 45, lon: -75 },
    ];
    expect(metrosNearRing(center, 60, metros)).toEqual(['in', 'edge']);
  });

  it('works on a real sample file: counties around Philadelphia', () => {
    const phl = AreasOutputSchema.parse(JSON.parse(readFileSync(resolve(__dirname, '../../sample-data/areas/philadelphia-pa.json'), 'utf8')));
    const r = countySearch({ lat: 39.95, lon: -75.16 }, 25, [phl]);
    expect(r.counties.map((c) => c.name)).toContain('Philadelphia County, PA');
    expect(r.counties.every((c) => c.miles <= 25)).toBe(true);
    expect(r.price).not.toBeNull();
  });
});
