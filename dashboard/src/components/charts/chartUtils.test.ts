import { describe, expect, it } from 'vitest';
import { extremes, resolveLabelCollisions } from './chartUtils';

describe('extremes', () => {
  it('finds high, low and latest, skipping nulls', () => {
    const rows = [{ date: 'a', v: 3 }, { date: 'b', v: 9 }, { date: 'c', v: 1 }, { date: 'd', v: 5 }, { date: 'e', v: null }];
    expect(extremes(rows, 'v')).toEqual({ high: { index: 1, value: 9 }, low: { index: 2, value: 1 }, latest: { index: 3, value: 5 } });
    expect(extremes([{ date: 'a', v: null }], 'v')).toEqual({ high: null, low: null, latest: null });
  });
});

describe('resolveLabelCollisions', () => {
  it('keeps order and spacing and stays in bounds', () => {
    const out = resolveLabelCollisions([100, 104, 50], 14, 0, 200);
    expect(out[2]).toBe(50);
    expect(out[1]! - out[0]!).toBeGreaterThanOrEqual(14);
    const clamped = resolveLabelCollisions([195, 198], 14, 0, 200);
    expect(Math.max(...clamped)).toBeLessThanOrEqual(200);
  });
});
