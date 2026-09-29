/**
 * The time machine's "moments" rail: national mortgage-rate highs and lows found in
 * code, not picked by hand. A point is a high (low) when it is the extreme of its
 * neighborhood and its prominence is at least `minProminence`: how far it stands
 * above (below) the higher (lower) of the lowest (highest) points on either side
 * before more extreme ground or the series end. The first and last points are never
 * local turns, but the window's overall high and low are always included.
 */
export interface RateEvent {
  kind: 'high' | 'low';
  index: number;
  date: string;
  value: number;
  prominence: number;
}

export interface EventOptions {
  /** Minimum prominence in the series' own units (percentage points for rates). */
  minProminence?: number;
  /** Points on each side a candidate must beat (or tie). */
  window?: number;
}

function prominence(values: readonly number[], i: number): number {
  const v = values[i]!;
  // Walk each way until higher ground (or the end), tracking the lowest point passed.
  // The peak's prominence is its height above the higher of those two lows.
  const low = (step: -1 | 1): number => {
    let min = v;
    for (let j = i + step; j >= 0 && j < values.length && values[j]! <= v; j += step) min = Math.min(min, values[j]!);
    return min;
  };
  return v - Math.max(low(-1), low(1));
}

function peaks(values: readonly number[], window: number, minProminence: number): Array<{ index: number; prominence: number }> {
  const out: Array<{ index: number; prominence: number }> = [];
  // The first and last points can't be confirmed turns: the series may keep going that way.
  for (let i = 1; i < values.length - 1; i++) {
    const v = values[i]!;
    let isMax = true;
    for (let j = Math.max(0, i - window); j <= Math.min(values.length - 1, i + window); j++) {
      if (j === i) continue;
      // Strictly greater on the left, greater-or-equal on the right: a plateau counts once (its first point).
      if ((j < i && values[j]! >= v) || (j > i && values[j]! > v)) {
        isMax = false;
        break;
      }
    }
    if (!isMax) continue;
    const p = prominence(values, i);
    if (p >= minProminence) out.push({ index: i, prominence: p });
  }
  return out;
}

export function detectRateEvents(dates: readonly string[], values: readonly (number | null)[], options: EventOptions = {}): RateEvent[] {
  const { minProminence = 0.25, window = 4 } = options;
  const idx: number[] = [];
  const vals: number[] = [];
  values.forEach((v, i) => {
    if (typeof v === 'number' && Number.isFinite(v)) {
      idx.push(i);
      vals.push(v);
    }
  });
  if (vals.length < 3) return [];
  const highs = peaks(vals, window, minProminence).map((p) => ({ ...p, kind: 'high' as const }));
  const lows = peaks(vals.map((v) => -v), window, minProminence).map((p) => ({ ...p, kind: 'low' as const }));
  // The window's overall high and low are moments even near its edges (when the range is meaningful).
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const iHi = vals.indexOf(hi);
  const iLo = vals.indexOf(lo);
  if (hi - lo >= minProminence) {
    if (!highs.some((h) => h.index === iHi)) highs.push({ index: iHi, prominence: hi - lo, kind: 'high' });
    if (!lows.some((l) => l.index === iLo)) lows.push({ index: iLo, prominence: hi - lo, kind: 'low' });
  }
  return [...highs, ...lows]
    .map(({ index, prominence: prom, kind }) => ({ kind, index: idx[index]!, date: dates[idx[index]!]!, value: vals[index]!, prominence: Number(prom.toFixed(4)) }))
    .sort((a, b) => a.index - b.index);
}
