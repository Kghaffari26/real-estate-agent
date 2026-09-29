/** Formatting for the atlas, built on the contract formatters (lib/format.ts). */
import type { MetricRegistryEntry } from '../data/schema.gen';
import { formatDelta, formatValue } from '../lib/format';
import { deltaFormat, valueScale } from '../lib/metrics';

export const fmtMetric = (entry: MetricRegistryEntry | undefined, v: number | null | undefined) => formatValue(v, entry?.format, { scale: valueScale(entry) });
export const fmtChange = (entry: MetricRegistryEntry | undefined, v: number | null | undefined) => formatDelta(v, deltaFormat(entry), { scale: valueScale(entry) });
export const signOf = (v: number | null | undefined): -1 | 0 | 1 => (v == null || v === 0 ? 0 : v > 0 ? 1 : -1);
export const toneClass = (v: number | null | undefined) => (signOf(v) > 0 ? 'text-mp-hot-2' : signOf(v) < 0 ? 'text-mp-cool-2' : 'text-mp-ink-2');

export const TEMPERATURE_ORDER = ['Cold', 'Cool', 'Balanced', 'Warm', 'Hot'] as const;
export const TEMPERATURE_TONE: Record<string, string> = {
  Cold: 'bg-mp-cool-2',
  Cool: 'bg-mp-cool-1',
  Balanced: 'bg-mp-mid',
  Warm: 'bg-mp-hot-1',
  Hot: 'bg-mp-hot-2',
};
