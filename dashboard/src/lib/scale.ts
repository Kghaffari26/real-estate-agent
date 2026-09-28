/** A diverging, bucketed color scale for YoY values on the map and its legend. */
import type { ColorToken } from './tokens';

export interface ScaleBucket {
  token: ColorToken;
  /** Inclusive lower bound (−Infinity for the first bucket). */
  min: number;
  /** Exclusive upper bound (Infinity for the last bucket). */
  max: number;
}

/**
 * Five buckets symmetric around zero, sized from the data: the "near zero" band is
 * ±20% of the largest absolute value, the strong bands start at ±60%.
 */
export function divergingBuckets(values: readonly (number | null | undefined)[]): ScaleBucket[] {
  const finite = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const maxAbs = finite.length ? Math.max(...finite.map(Math.abs)) : 0;
  const t1 = maxAbs * 0.2;
  const t2 = maxAbs * 0.6;
  return [
    { token: 'scale-neg-strong', min: -Infinity, max: -t2 },
    { token: 'scale-neg', min: -t2, max: -t1 },
    { token: 'scale-zero', min: -t1, max: t1 },
    { token: 'scale-pos', min: t1, max: t2 },
    { token: 'scale-pos-strong', min: t2, max: Infinity },
  ];
}

export function bucketFor(buckets: readonly ScaleBucket[], value: number | null | undefined): ColorToken {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'scale-missing';
  if (buckets.length === 0) return 'scale-missing';
  // Zero range (every value identical): everything is "near zero".
  const zero = buckets.find((b) => b.token === 'scale-zero');
  if (zero && zero.min === 0 && zero.max === 0) return 'scale-zero';
  const hit = buckets.find((b) => value >= b.min && value < b.max);
  return hit?.token ?? buckets[buckets.length - 1]!.token;
}
