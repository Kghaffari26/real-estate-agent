import { describe, expect, it } from 'vitest';
import { houseScale, HOUSE_SCALE_MAX, HOUSE_SCALE_MIN, regionOf, statesOf, temperatureDrivers, temperatureLight } from './dossier';

describe('house scale', () => {
  it('is price / U.S. median, clamped to 0.6–1.6', () => {
    expect(houseScale(413_543, 398_596)).toBeCloseTo(413_543 / 398_596, 12);
    expect(houseScale(1_220_700, 398_596)).toBe(HOUSE_SCALE_MAX);
    expect(houseScale(100_000, 398_596)).toBe(HOUSE_SCALE_MIN);
    expect(houseScale(null, 398_596)).toBe(1);
    expect(houseScale(400_000, 0)).toBe(1);
    expect(houseScale(-5, 398_596)).toBe(1);
  });
});

describe('temperature light', () => {
  const stops = { cold: [0, 0, 255], neutral: [128, 128, 128], warm: [255, 128, 0] } as Parameters<typeof temperatureLight>[1];
  it('leans cold below 50 and warm above, neutral at 50 or unknown', () => {
    expect(temperatureLight(0, stops)).toEqual({ rim: [0, 0, 255], lean: 1, side: -1 });
    expect(temperatureLight(100, stops)).toEqual({ rim: [255, 128, 0], lean: 1, side: 1 });
    expect(temperatureLight(50, stops)).toEqual({ rim: [128, 128, 128], lean: 0, side: 0 });
    expect(temperatureLight(75, stops).rim).toEqual([192, 128, 64]);
    expect(temperatureLight(null, stops).lean).toBe(0);
  });
});

describe('regions', () => {
  it('maps a metro to its plate region by its first state', () => {
    expect(regionOf('Austin, TX')).toBe('Southwest');
    expect(regionOf('Oakland, CA')).toBe('West');
    expect(regionOf('Kansas City, MO-KS')).toBe('Midwest');
    expect(regionOf('Nassau County, NY')).toBe('Northeast');
    expect(regionOf('Miami, FL')).toBe('South');
    expect(regionOf('Nowhere')).toBeNull();
    expect(statesOf('Kansas City, MO-KS')).toBe('MO-KS');
  });
});

describe('temperature drivers', () => {
  it('reads signed components as plain sentences, strongest first', () => {
    const d = temperatureDrivers({ median_dom: -1.778, price_drops: 0.4, sold_above_list: -1.041 });
    expect(d.map((x) => x.label)).toEqual(['Homes take longer to sell', 'Fewer homes sell over asking', 'Fewer listings cut their price']);
    expect(temperatureDrivers(null)).toEqual([]);
  });
});
