import { describe, expect, it } from 'vitest';
import { bucketFor, divergingBuckets } from './scale';

describe('divergingBuckets', () => {
  const buckets = divergingBuckets([-0.1, 0, 0.05, null]);
  it('is symmetric around zero from the largest magnitude', () => {
    expect(buckets.map((b) => b.token)).toEqual(['scale-neg-strong', 'scale-neg', 'scale-zero', 'scale-pos', 'scale-pos-strong']);
    expect(buckets[2]!.min).toBeCloseTo(-0.02);
    expect(buckets[3]!.max).toBeCloseTo(0.06);
  });
  it('buckets values', () => {
    expect(bucketFor(buckets, -0.1)).toBe('scale-neg-strong');
    expect(bucketFor(buckets, -0.03)).toBe('scale-neg');
    expect(bucketFor(buckets, 0)).toBe('scale-zero');
    expect(bucketFor(buckets, 0.05)).toBe('scale-pos');
    expect(bucketFor(buckets, 0.5)).toBe('scale-pos-strong');
    expect(bucketFor(buckets, null)).toBe('scale-missing');
  });
  it('handles all-equal data', () => {
    expect(bucketFor(divergingBuckets([0, 0]), 0)).toBe('scale-zero');
  });
});
