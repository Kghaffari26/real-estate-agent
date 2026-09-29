/**
 * Column heights and colors for the atlas (pure; tested).
 *
 * Height encodes the metric's level, min→max across every metro (and, once history
 * is loaded, every month), so a column's rise and fall while scrubbing is comparable.
 * It is not zero-based: $229K–$1.22M would otherwise be indistinguishable. The floor
 * keeps the smallest value visible. Color encodes YoY on one symmetric diverging
 * scale (§5.3), or the level on a one-hue ramp.
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

export const HEIGHT_FLOOR = 0.06;

/** 0…1 height: HEIGHT_FLOOR at the minimum, 1 at the maximum, null when there's no value. */
export function heightOf(value: number | null | undefined, extent: Extent | null): number | null {
  if (value == null || !Number.isFinite(value) || !extent) return null;
  if (extent.max === extent.min) return 1;
  const t = (value - extent.min) / (extent.max - extent.min);
  return HEIGHT_FLOOR + (1 - HEIGHT_FLOOR) * Math.min(1, Math.max(0, t));
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

/** One-hue ramp for "color by value": dim → accent. */
export function sequentialColor(h: number | null, low: RGB, high: RGB): RGB {
  return h == null ? low : lerp(low, high, h);
}

/** Reads an `--mp-*` channel triplet ("92 225 230") into RGB. */
export function parseChannels(raw: string, fallback: RGB = [136, 136, 136]): RGB {
  const parts = raw.trim().split(/\s+/).map(Number);
  return parts.length >= 3 && parts.every((n) => Number.isFinite(n)) ? ([parts[0], parts[1], parts[2]] as RGB) : fallback;
}
