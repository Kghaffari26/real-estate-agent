import { describe, expect, it } from 'vitest';
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
