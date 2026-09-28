/** Pure helpers for the Recharts layer (unit-tested). */
import type { Row } from '../../lib/series';

export interface Extremes {
  high: { index: number; value: number } | null;
  low: { index: number; value: number } | null;
  latest: { index: number; value: number } | null;
}

export function extremes(rows: readonly Row[], key: string): Extremes {
  let high: Extremes['high'] = null;
  let low: Extremes['low'] = null;
  let latest: Extremes['latest'] = null;
  rows.forEach((row, index) => {
    const v = row[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    if (!high || v > high.value) high = { index, value: v };
    if (!low || v < low.value) low = { index, value: v };
    latest = { index, value: v };
  });
  return { high, low, latest };
}

/**
 * Nudge end labels apart vertically so none overlap (min `gap` px), keeping them
 * inside [top, bottom]. Input and output are in the same order.
 */
export function resolveLabelCollisions(ys: readonly number[], gap: number, top: number, bottom: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const placed = order.map((o) => o.y);
  for (let k = 1; k < placed.length; k++) placed[k] = Math.max(placed[k]!, placed[k - 1]! + gap);
  const overflow = placed.length ? placed[placed.length - 1]! - bottom : 0;
  if (overflow > 0) for (let k = 0; k < placed.length; k++) placed[k] = placed[k]! - overflow;
  for (let k = 0; k < placed.length; k++) placed[k] = Math.max(placed[k]!, top + k * gap);
  const out = new Array<number>(ys.length);
  order.forEach((o, k) => (out[o.i] = placed[k]!));
  return out;
}

/** Right margin reserved for direct end labels (shared so synced charts line up). */
export function endLabelMargin(series: readonly { label: string; shortLabel?: string }[]): number {
  if (series.length === 0 || series.length > 4) return 12;
  if (series.length === 1) return 72;
  return Math.min(112, Math.round(18 + 6.8 * Math.max(...series.map((s) => (s.shortLabel ?? s.label).length))));
}
