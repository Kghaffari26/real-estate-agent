import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PulseOutputSchema, type PulseOutput } from '../data/schema.gen';
import { metroPulse, tickerItems } from './pulse';

const sample = PulseOutputSchema.parse(JSON.parse(readFileSync(resolve(__dirname, '../../sample-data/pulse.json'), 'utf8')));
const tiny: PulseOutput = {
  window_weeks: 4,
  weeks: ['2026-09-06', '2026-09-13', '2026-09-20'],
  metros: {
    a: { median_sale_price: [1, 2, 300000], new_listings: [1, 1, 1], pending_sales: [null, null, null], active_listings: [5, 5, 5] },
    b: { median_sale_price: [1, 2, 200000], new_listings: [1, 1, 1], pending_sales: [2, 2, 2], active_listings: [5, 5, 5] },
    c: { median_sale_price: [1, 2, null], new_listings: [null, null, null], pending_sales: [null, null, null], active_listings: [null, null, null] },
    d: { median_sale_price: [9, 9, 9], new_listings: [null, null, null], pending_sales: [null, null, null], active_listings: [null, null, null] },
  },
  yoy: { a: { median_sale_price: 0.01 }, b: { median_sale_price: 0.05 }, c: { median_sale_price: 0.2 }, d: { median_sale_price: null } },
};

describe('pulse view model', () => {
  it('orders the ticker by price YoY, drops metros without a latest price, names them', () => {
    const got = tickerItems(tiny, new Map([['a', 'Alpha'], ['b', 'Beta']]));
    expect(got.map((x) => [x.slug, x.name, x.price, x.yoy])).toEqual([
      ['b', 'Beta', 200000, 0.05],
      ['a', 'Alpha', 300000, 0.01],
      ['d', 'd', 9, null],
    ]);
  });

  it('gives one metro its four series with the agent’s YoY', () => {
    const p = metroPulse(tiny, 'a')!;
    expect(p.rows.map((r) => [r.key, r.latest, r.yoy])).toEqual([
      ['median_sale_price', 300000, 0.01],
      ['pending_sales', null, null],
      ['new_listings', 1, null],
      ['active_listings', 5, null],
    ]);
    expect(p.windowWeeks).toBe(4);
    expect(metroPulse(tiny, 'zz')).toBeNull();
  });

  it('covers all 50 sample metros with 12 weeks', () => {
    expect(sample.weeks).toHaveLength(12);
    expect(tickerItems(sample, new Map())).toHaveLength(50);
    expect(metroPulse(sample, 'austin-tx')!.rows[0]!.values).toHaveLength(12);
  });
});
