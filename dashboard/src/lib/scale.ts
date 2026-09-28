/** Bucketed color scales for YoY (diverging) and magnitude (sequential). Pure. */
import { DIVERGING, SEQUENTIAL, type ColorToken } from './tokens';

export interface ScaleBucket {
  token: ColorToken;
  /** Inclusive lower bound (−Infinity for the first bucket). */
  min: number;
  /** Exclusive upper bound (Infinity for the last bucket). */
  max: number;
}

/**
 * Seven buckets symmetric around zero: a gray "about flat" band of ±10% of the
 * largest |value|, then light/mid/strong arms at 10–40%, 40–70% and ≥70%.
 */
export function divergingBuckets(values: readonly (number | null | undefined)[]): ScaleBucket[] {
  const finite = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const m = finite.length ? Math.max(...finite.map(Math.abs)) : 0;
  const t = [0.1, 0.4, 0.7].map((f) => f * m);
  const edges = [-Infinity, -t[2]!, -t[1]!, -t[0]!, t[0]!, t[1]!, t[2]!, Infinity];
  return DIVERGING.map((token, i) => ({ token, min: edges[i]!, max: edges[i + 1]! }));
}

export function bucketFor(buckets: readonly ScaleBucket[], value: number | null | undefined): ColorToken {
  if (typeof value !== 'number' || !Number.isFinite(value) || buckets.length === 0) return 'div-missing';
  const mid = buckets[Math.floor(buckets.length / 2)]!;
  if (mid.min === 0 && mid.max === 0) return mid.token; // every value identical
  return (buckets.find((b) => value >= b.min && value < b.max) ?? buckets[buckets.length - 1]!).token;
}

/** A 0–100 score to a sequential step (e.g. temperature → heat). */
export function sequentialToken(score: number | null | undefined): ColorToken | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  const i = Math.min(SEQUENTIAL.length - 1, Math.max(0, Math.floor((score / 100) * SEQUENTIAL.length)));
  return SEQUENTIAL[i]!;
}

/** Whether text on a sequential step should be light (dark steps) — per theme. */
export function inkOnSequential(token: ColorToken, dark: boolean): 'light' | 'dark' {
  const i = SEQUENTIAL.indexOf(token);
  // WCAG 4.5:1 either way: light theme steps 5–6 take light ink (step 4 #d16204 is
  // only 3.9:1 with white); dark theme (flipped ramp) steps 1–3 take light ink.
  return dark ? (i <= 2 ? 'light' : 'dark') : i >= 4 ? 'light' : 'dark';
}
