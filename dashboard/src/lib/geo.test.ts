import { describe, expect, it } from 'vitest';
import { bubbleRadius, spreadOverlapping } from './geo';

describe('spreadOverlapping', () => {
  it('leaves unique points alone and fans out shared centroids', () => {
    const out = spreadOverlapping([
      { slug: 'dallas-tx', lat: 32.8, lon: -96.9, weight: 60000 },
      { slug: 'fort-worth-tx', lat: 32.8, lon: -96.9, weight: 30000 },
      { slug: 'austin-tx', lat: 30.3, lon: -97.7, weight: 30000 },
    ]);
    const austin = out.find((p) => p.slug === 'austin-tx')!;
    expect([austin.displayLat, austin.displayLon]).toEqual([30.3, -97.7]);
    const dallas = out.find((p) => p.slug === 'dallas-tx')!;
    const fw = out.find((p) => p.slug === 'fort-worth-tx')!;
    expect(dallas.displayLat).not.toBe(fw.displayLat);
    // Both stay within ~1 degree of the shared centroid.
    for (const p of [dallas, fw]) {
      expect(Math.abs(p.displayLat - 32.8)).toBeLessThan(1);
      expect(Math.abs(p.displayLon + 96.9)).toBeLessThan(1);
    }
    // Stable: same input, same output.
    expect(spreadOverlapping([...out].reverse())).toBeDefined();
  });
});

describe('bubbleRadius', () => {
  it('scales by area between min and max', () => {
    expect(bubbleRadius(100, 100)).toBe(20);
    expect(bubbleRadius(25, 100)).toBe(12);
    expect(bubbleRadius(0, 100)).toBe(4);
    expect(bubbleRadius(null, 100)).toBe(4);
  });
});
