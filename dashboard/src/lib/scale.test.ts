import { describe, expect, it } from 'vitest';
import { bucketFor, divergingBuckets, inkOnSequential, sequentialToken } from './scale';

describe('divergingBuckets', () => {
  const buckets = divergingBuckets([-0.1, 0, 0.05, null]);
  it('has seven steps symmetric around a gray midpoint', () => {
    expect(buckets.map((b) => b.token)).toEqual(['div-neg-3', 'div-neg-2', 'div-neg-1', 'div-mid', 'div-pos-1', 'div-pos-2', 'div-pos-3']);
    expect(buckets[3]!.min).toBeCloseTo(-0.01);
    expect(buckets[3]!.max).toBeCloseTo(0.01);
  });
  it('buckets values', () => {
    expect(bucketFor(buckets, -0.1)).toBe('div-neg-3');
    expect(bucketFor(buckets, -0.05)).toBe('div-neg-2');
    expect(bucketFor(buckets, -0.02)).toBe('div-neg-1');
    expect(bucketFor(buckets, 0)).toBe('div-mid');
    expect(bucketFor(buckets, 0.05)).toBe('div-pos-2');
    expect(bucketFor(buckets, 0.5)).toBe('div-pos-3');
    expect(bucketFor(buckets, null)).toBe('div-missing');
  });
  it('handles all-equal data', () => {
    expect(bucketFor(divergingBuckets([0, 0]), 0)).toBe('div-mid');
  });
});

describe('sequential', () => {
  it('maps a 0–100 score to six steps', () => {
    expect(sequentialToken(0)).toBe('seq-1');
    expect(sequentialToken(50)).toBe('seq-4');
    expect(sequentialToken(100)).toBe('seq-6');
    expect(sequentialToken(null)).toBeNull();
  });
  it('picks readable ink per theme', () => {
    expect(inkOnSequential('seq-1', false)).toBe('dark');
    expect(inkOnSequential('seq-4', false)).toBe('dark');
    expect(inkOnSequential('seq-5', false)).toBe('light');
    expect(inkOnSequential('seq-6', false)).toBe('light');
    expect(inkOnSequential('seq-1', true)).toBe('light');
    expect(inkOnSequential('seq-6', true)).toBe('dark');
  });
});
