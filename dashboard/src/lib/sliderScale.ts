/**
 * Position ↔ value mapping for sliders. `log` gives the radius slider (10–250 mi)
 * its "logarithmic feel": equal thumb travel is an equal ratio, so 10→25 mi gets as
 * much room as 100→250 mi. Positions are 0…1.
 */
export type SliderScale = 'linear' | 'log';

export function toPosition(value: number, min: number, max: number, scale: SliderScale = 'linear'): number {
  const v = Math.min(max, Math.max(min, value));
  if (scale === 'log') {
    if (min <= 0) throw new Error('log scale needs min > 0');
    return Math.log(v / min) / Math.log(max / min);
  }
  return max === min ? 0 : (v - min) / (max - min);
}

export function fromPosition(position: number, min: number, max: number, scale: SliderScale = 'linear', step = 0): number {
  const p = Math.min(1, Math.max(0, position));
  const raw = scale === 'log' ? min * (max / min) ** p : min + p * (max - min);
  if (!step) return raw;
  const snapped = Math.round(raw / step) * step;
  // Snap without leaving the range; keep float noise out of the result.
  return Math.min(max, Math.max(min, Number(snapped.toFixed(10))));
}
