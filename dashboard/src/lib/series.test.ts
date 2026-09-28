import { describe, expect, it } from 'vitest';
import { alignToDates, hasData, indexTo100, mergeOnDates, numericSeries, rangeStart, seriesDates, toRows } from './series';

const dates = Array.from({ length: 36 }, (_, i) => {
  const y = 2023 + Math.floor((i + 5) / 12);
  const m = ((i + 5) % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}-28`;
});

describe('series helpers', () => {
  it('reads dates and numeric columns defensively', () => {
    expect(seriesDates({ dates: ['2026-01-31'] })).toEqual(['2026-01-31']);
    expect(seriesDates({ dates: [1, 2] })).toEqual([]);
    expect(seriesDates(undefined)).toEqual([]);
    expect(numericSeries({ x: [1, null, 'a'] }, 'x')).toEqual([1, null, null]);
    expect(numericSeries({ x: [1] }, 'y')).toBeNull();
    expect(hasData([null, null])).toBe(false);
    expect(hasData([null, 2])).toBe(true);
  });

  it('computes range starts from the last date', () => {
    expect(dates[0]).toBe('2023-06-28');
    expect(dates[35]).toBe('2026-05-28');
    expect(rangeStart(dates, 'All')).toBe(0);
    expect(rangeStart(dates, '3Y')).toBe(0);
    expect(dates[rangeStart(dates, '1Y')]).toBe('2025-05-28');
  });

  it('indexes to 100 from the first non-null value', () => {
    expect(indexTo100([null, 200, 250, null])).toEqual([null, 100, 125, null]);
    expect(indexTo100([null, null])).toEqual([null, null]);
  });

  it('zips rows', () => {
    expect(toRows(['a', 'b'], { x: [1, null] })).toEqual([
      { date: 'a', x: 1 },
      { date: 'b', x: null },
    ]);
  });

  it('aligns weekly values to month ends', () => {
    const weeks = ['2026-04-23', '2026-04-30', '2026-05-07', '2026-05-28'];
    const values = [6.8, 6.9, 7.0, 7.1];
    expect(alignToDates(['2026-03-31', '2026-04-30', '2026-05-31'], weeks, values)).toEqual([null, 6.9, 7.1]);
    expect(alignToDates(['2026-12-31'], weeks, values)).toEqual([null]);
  });

  it('merges columns on the union of dates', () => {
    const rows = mergeOnDates({ a: { dates: ['1', '2'], values: [1, 2] }, b: { dates: ['2', '3'], values: [5, 6] } });
    expect(rows).toEqual([
      { date: '1', a: 1, b: null },
      { date: '2', a: 2, b: 5 },
      { date: '3', a: null, b: 6 },
    ]);
  });
});
