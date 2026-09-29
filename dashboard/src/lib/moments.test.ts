import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventsOutputSchema } from '../data/schema.gen';
import { momentLabel, railMoments, rateMarkers, thinMoments, type NationalEvent } from './moments';

const sample = EventsOutputSchema.parse(JSON.parse(readFileSync(resolve(__dirname, '../../sample-data/events.json'), 'utf8')));
const ev = (date: string, kind: NationalEvent['kind'], value: number, metric: NationalEvent['metric'] = 'mortgage30'): NationalEvent => ({ date, kind, value, metric, prominence: null });

describe('moments (the published event rail)', () => {
  it('labels each kind plainly', () => {
    expect(momentLabel(ev('2023-10-26', 'rate_high', 7.79))).toBe('30-yr high 7.79% · Oct 2023');
    expect(momentLabel(ev('2023-03-31', 'price_yoy_turn_down', -0.0189, 'median_sale_price'))).toBe('U.S. prices turn down (−1.9% YoY) · Mar 2023');
    expect(momentLabel(ev('2021-03-31', 'inventory_yoy_low', -0.3376, 'inventory'))).toBe("Inventory's steepest drop (−33.8% YoY) · Mar 2021");
  });

  it('places events on their calendar month, drops the rest, and features the axis extremes', () => {
    const dates = ['2023-09-30', '2023-10-31', '2023-11-30', '2024-01-31', '2024-05-31'];
    const got = railMoments([ev('2023-10-26', 'rate_high', 7.79), ev('2024-05-02', 'rate_high', 7.22), ev('2024-01-18', 'rate_low', 6.6), ev('2012-11-21', 'rate_low', 3.31), ev('2024-01-31', 'price_yoy_high', 0.05, 'median_sale_price')], dates);
    expect(got.map((m) => [m.index, m.kind, m.showLabel])).toEqual([
      [1, 'high', true],
      [3, 'low', true],
      [3, 'high', false],
      [4, 'high', false],
    ]);
  });

  it('marks rate turns inside a weekly window only', () => {
    const got = rateMarkers(sample.events, ['2023-10-05', '2026-09-24']);
    expect(got.map((m) => [m.date, m.kind, m.label])).toEqual([
      ['2023-10-26', 'high', '7.79%'],
      ['2024-01-18', 'low', '6.60%'],
      ['2024-05-02', 'high', '7.22%'],
      ['2024-09-26', 'low', '6.08%'],
      ['2025-01-16', 'high', '7.04%'],
      ['2026-02-26', 'low', '5.98%'],
    ]);
    expect(rateMarkers(sample.events, [])).toEqual([]);
  });

  it('on the sample 2012+ axis, features the 7.79% high and the 2.65% low', () => {
    const dates: string[] = [];
    for (let y = 2012; y <= 2026; y++) for (let m = 1; m <= 12; m++) if (y < 2026 || m <= 8) dates.push(`${y}-${String(m).padStart(2, '0')}-28`);
    const got = railMoments(sample.events, dates);
    expect(got).toHaveLength(sample.events.length);
    expect(got.filter((m) => m.showLabel).map((m) => m.label)).toEqual(['30-yr low 2.65% · Jan 2021', '30-yr high 7.79% · Oct 2023']);
  });
});

describe('thinning the rail', () => {
  it('keeps 24 px between markers: featured first, then prominent rate turns', () => {
    const m = (index: number, metric: NationalEvent['metric'], prominence: number | null, showLabel = false) => ({ index, showLabel, event: { ...ev('2020-01-01', 'rate_high', 1, metric), prominence } });
    const moments = [m(0, 'mortgage30', 0.6), m(1, 'mortgage30', 1.2), m(2, 'median_sale_price', null), m(50, 'mortgage30', 0.5, true), m(51, 'mortgage30', 3), m(100, 'inventory', null)];
    // 100 steps over 200 px: 2 px per step, so markers must be 12 steps apart.
    expect(thinMoments(moments, 100, 200).map((x) => x.index)).toEqual([1, 50, 100]);
    expect(thinMoments(moments, 100, 0)).toHaveLength(6); // unmeasured: keep all
  });

  it('on the sample 2012+ axis at 700 px, no two markers are closer than 24 px', () => {
    const dates: string[] = [];
    for (let y = 2012; y <= 2026; y++) for (let mo = 1; mo <= 12; mo++) if (y < 2026 || mo <= 8) dates.push(`${y}-${String(mo).padStart(2, '0')}-28`);
    const kept = thinMoments(railMoments(sample.events, dates), dates.length - 1, 700);
    const xs = kept.map((k) => (k.index / (dates.length - 1)) * 700);
    xs.slice(1).forEach((x, i) => expect(x - xs[i]!).toBeGreaterThanOrEqual(24));
    expect(kept.filter((k) => k.showLabel)).toHaveLength(2);
  });
});
