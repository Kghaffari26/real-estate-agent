/**
 * Column heights and colors for the atlas (pure; tested).
 *
 * Heights are proportional:
 * - value metrics start from zero: height = value / max, where max spans every metro
 *   (and, once history is loaded, every month) so scrubbing is comparable. Tiny values
 *   get a small visible stub (MIN_STUB); above it, height is exactly proportional.
 * - YoY is centered on zero: height = change / bound in [-1, 1], where bound is the
 *   largest |change|. Rising metros grow up, falling ones grow down.
 * Color encodes YoY on one symmetric diverging scale (§5.3), or the level on a one-hue ramp.
 */
export interface Extent {
  min: number;
  max: number;
}

export function extentOf(values: Iterable<number | null | undefined>): Extent | null {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min === Infinity ? null : { min, max };
}

/** Smallest visible height for a positive value (a stub, so near-zero values still show). */
export const MIN_STUB = 0.03;

/** 0…1 from zero: value / max. Null without a value; 0 for zero or negative values. */
export function valueHeight(value: number | null | undefined, max: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || max == null || !(max > 0)) return null;
  if (value <= 0) return 0;
  return Math.max(MIN_STUB, Math.min(1, value / max));
}

/** −1…1 centered on zero: change / bound (clamped). Null without a change. */
export function changeHeight(change: number | null | undefined, bound: number): number | null {
  if (change == null || !Number.isFinite(change) || !(bound > 0)) return null;
  return Math.max(-1, Math.min(1, change / bound));
}

/**
 * A robust symmetric bound for long histories: the `q` quantile of |change| (default
 * the 98th percentile), so one extreme month in 14 years of 50 metros can't wash the
 * scale out; changes beyond it clamp to the end colors. Small sets use the exact max.
 */
export function robustBound(changes: Iterable<number | null | undefined>, q = 0.98, minCount = 200): number {
  const abs: number[] = [];
  for (const c of changes) if (c != null && Number.isFinite(c)) abs.push(Math.abs(c));
  if (abs.length < minCount) return divergingBound(abs);
  abs.sort((a, b) => a - b);
  return abs[Math.min(abs.length - 1, Math.floor(q * (abs.length - 1)))] || divergingBound(abs);
}

/** Symmetric bound for the diverging scale: the largest |change|, never zero. */
export function divergingBound(changes: Iterable<number | null | undefined>): number {
  let m = 0;
  for (const c of changes) if (c != null && Number.isFinite(c)) m = Math.max(m, Math.abs(c));
  return m || 1;
}

export type RGB = [number, number, number];

const lerp = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((k) => Math.round(a[k]! + (b[k]! - a[k]!) * t)) as RGB;

export interface DivergingStops {
  cool2: RGB;
  cool1: RGB;
  mid: RGB;
  hot1: RGB;
  hot2: RGB;
}

/** -bound → cool2, 0 → mid, +bound → hot2 (piecewise linear through cool1/hot1). */
export function divergingColor(change: number | null | undefined, bound: number, s: DivergingStops): RGB {
  if (change == null || !Number.isFinite(change)) return s.mid;
  const t = Math.max(-1, Math.min(1, change / bound));
  if (t < 0) return t < -0.5 ? lerp(s.cool1, s.cool2, (-t - 0.5) * 2) : lerp(s.mid, s.cool1, -t * 2);
  return t > 0.5 ? lerp(s.hot1, s.hot2, (t - 0.5) * 2) : lerp(s.mid, s.hot1, t * 2);
}

/** One-hue ramp for "color by value": dim → accent, by the value's share of the max. */
export function sequentialColor(share: number | null, low: RGB, high: RGB): RGB {
  return share == null ? low : lerp(low, high, Math.max(0, Math.min(1, share)));
}

/** Reads an `--mp-*` channel triplet ("92 225 230") into RGB. */
export function parseChannels(raw: string, fallback: RGB = [136, 136, 136]): RGB {
  const parts = raw.trim().split(/\s+/).map(Number);
  return parts.length >= 3 && parts.every((n) => Number.isFinite(n)) ? ([parts[0], parts[1], parts[2]] as RGB) : fallback;
}
