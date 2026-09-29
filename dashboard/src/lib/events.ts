/**
 * The time machine's "moments" rail: national mortgage-rate highs and lows found in
 * code, not picked by hand. A point is a high (low) when it is the extreme of its
 * neighborhood and its topographic prominence is at least `minProminence`:
 * how far it stands above (below) the higher of the two lowest (highest) points
 * separating it from a more extreme point on either side, or from the ends.
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
  let leftBase = v;
  for (let j = i - 1; j >= 0; j--) {
    if (values[j]! > v) break;
    leftBase = Math.min(leftBase, values[j]!);
  }
  let rightBase = v;
  for (let j = i + 1; j < values.length; j++) {
    if (values[j]! > v) break;
    rightBase = Math.min(rightBase, values[j]!);
  }
  return v - Math.max(leftBase, rightBase);
}

function peaks(values: readonly number[], window: number, minProminence: number): Array<{ index: number; prominence: number }> {
  const out: Array<{ index: number; prominence: number }> = [];
  for (let i = 0; i < values.length; i++) {
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
  return [...highs, ...lows]
    .map(({ index, prominence: prom, kind }) => ({ kind, index: idx[index]!, date: dates[idx[index]!]!, value: vals[index]!, prominence: Number(prom.toFixed(4)) }))
    .sort((a, b) => a.index - b.index);
}
