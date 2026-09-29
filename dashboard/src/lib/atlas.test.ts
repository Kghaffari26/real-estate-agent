import { describe, expect, it } from 'vitest';
import { detectRateEvents } from './events';
import { fromPosition, toPosition } from './sliderScale';

describe('slider scale', () => {
  it('maps linear values to 0…1 and back', () => {
    expect(toPosition(15, 10, 20)).toBe(0.5);
    expect(fromPosition(0.5, 10, 20)).toBe(15);
    expect(toPosition(5, 10, 20)).toBe(0); // clamped
    expect(toPosition(3, 3, 3)).toBe(0); // empty range
  });

  it('gives the radius slider a logarithmic feel', () => {
    // 10→250 mi: the midpoint is the geometric mean, 50 mi
    expect(fromPosition(0.5, 10, 250, 'log')).toBeCloseTo(50, 6);
    expect(toPosition(50, 10, 250, 'log')).toBeCloseTo(0.5, 6);
    expect(toPosition(10, 10, 250, 'log')).toBe(0);
    expect(toPosition(250, 10, 250, 'log')).toBe(1);
    // equal ratios get equal travel
    expect(toPosition(25, 10, 250, 'log') - toPosition(10, 10, 250, 'log')).toBeCloseTo(toPosition(250, 10, 250, 'log') - toPosition(100, 10, 250, 'log'), 6);
  });

  it('snaps to the step without leaving the range', () => {
    expect(fromPosition(0.503, 10, 250, 'log', 5)).toBe(50);
    expect(fromPosition(1, 10, 250, 'log', 7)).toBe(250);
    expect(fromPosition(0.333, 0, 1, 'linear', 0.1)).toBe(0.3);
  });

  it('rejects a log scale that starts at zero', () => {
    expect(() => toPosition(1, 0, 10, 'log')).toThrow();
  });
});

describe('rate events', () => {
  const dates = Array.from({ length: 13 }, (_, i) => `2024-${String(i + 1).padStart(2, '0')}`);

  it('finds prominent highs and lows, oldest first', () => {
    const values = [6.5, 6.9, 7.4, 7.0, 6.6, 6.2, 6.0, 6.3, 6.8, 7.1, 6.9, 6.7, 6.8];
    const events = detectRateEvents(dates, values, { window: 2, minProminence: 0.25 });
    expect(events.map((e) => [e.kind, e.date, e.value])).toEqual([
      ['high', '2024-03', 7.4],
      ['low', '2024-07', 6.0],
      ['high', '2024-10', 7.1],
    ]);
    // the Oct high stands 0.4 above the lowest point (6.7) between it and the series end
    expect(events[2]!.prominence).toBeCloseTo(0.4, 6);
  });

  it('keeps a peak at the start of the series (no higher ground before it)', () => {
    const values = [7.6, 7.79, 7.5, 7.2, 6.9, 6.6, 6.8, 7.0, 7.04, 6.9, 6.5, 6.2, 6.0];
    const highs = detectRateEvents(dates, values, { window: 2, minProminence: 0.25 }).filter((e) => e.kind === 'high');
    expect(highs.map((e) => [e.date, e.value])).toEqual([
      ['2024-02', 7.79],
      ['2024-09', 7.04],
    ]);
    // the Jun dip (then +0.44 pp) is a trough; the window's low is a moment even as the last point
    expect(detectRateEvents(dates, values, { window: 2 }).filter((e) => e.kind === 'low').map((e) => e.date)).toEqual(['2024-06', '2024-13']);
  });

  it('ignores wiggles below the prominence threshold', () => {
    const values = [7.0, 7.05, 7.0, 7.08, 7.02, 7.06, 7.0, 7.04, 7.01, 7.03, 7.0, 7.05, 7.02];
    expect(detectRateEvents(dates, values, { window: 1, minProminence: 0.25 })).toEqual([]);
  });

  it('skips gaps, counts a plateau once and tolerates short input', () => {
    const values = [6.0, null, 7.0, 7.0, 6.2, null, 6.1, 6.9, 6.9, 6.0, 5.5, 5.9, 6.4];
    const events = detectRateEvents(dates, values, { window: 2, minProminence: 0.3 });
    expect(events.filter((e) => e.kind === 'high').map((e) => e.date)).toEqual(['2024-03', '2024-08']);
    expect(events.filter((e) => e.kind === 'low').map((e) => e.date)).toEqual(['2024-07', '2024-11']);
    expect(detectRateEvents(['a', 'b'], [1, 2])).toEqual([]);
  });
});
