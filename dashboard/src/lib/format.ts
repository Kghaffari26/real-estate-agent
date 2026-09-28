/**
 * Formatting for every `format` / `delta_format` in the contract (agents-core's
 * StatFormat plus the metric registry's formats). Pure functions, unit-tested.
 *
 * Unit convention (a contract gap, see DECISIONS.md): values are in one of two scales.
 * - 'ratio' (default): shares and changes are ratios (0.968 → 96.8%, 0.009 → +0.9 pp).
 *   Used for every metric value/yoy/mom, alert figure and mover.
 * - 'points': already in percent units (6.18 → 6.18%, -0.07 → −0.07 pp).
 *   Used for mortgage rates and `key_stats` (agents-core KeyStat convention).
 */
export type Scale = 'ratio' | 'points';

export const STAT_FORMATS = [
  'currency_compact',
  'currency',
  'percent',
  'percent_signed',
  'pp_signed',
  'count',
  'count_signed',
  'count_signed_thousands',
  'decimal1',
  'days',
  'ratio',
] as const;
export type StatFormat = (typeof STAT_FORMATS)[number];

export const MISSING = '—';
const MINUS = '−'; // U+2212, typographic minus

export interface FormatOptions {
  scale?: Scale;
  /** Override decimal places for percent/pp formats. */
  decimals?: number;
  /** Always show the sign, even for unsigned formats (used for deltas). */
  signed?: boolean;
}

function isNum(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function withSign(text: string, value: number, signed: boolean): string {
  if (!signed) return value < 0 ? `${MINUS}${text}` : text;
  if (value > 0) return `+${text}`;
  if (value < 0) return `${MINUS}${text}`;
  return text;
}

// Intl.NumberFormat construction is expensive; toLocaleString builds one per call.
const formatters = new Map<number, Intl.NumberFormat>();

function grouped(value: number, decimals = 0): string {
  let f = formatters.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    formatters.set(decimals, f);
  }
  return f.format(value);
}

function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${trim(abs / 1e9)}B`;
  if (abs >= 1e6) return `${trim(abs / 1e6)}M`;
  if (abs >= 1e3) return `${trim(abs / 1e3)}K`;
  return grouped(abs);
}

/** 1 significant decimal below 100 (431.2K), none above (1.61M → "1.61M" keeps 3 sig figs). */
function trim(value: number): string {
  const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return Number(value.toFixed(decimals)).toString();
}

function toPercentUnits(value: number, scale: Scale): number {
  return scale === 'ratio' ? value * 100 : value;
}

/** Format a number for display. `null`/`undefined`/NaN render as an em dash. */
export function formatValue(
  value: number | null | undefined,
  format: string | null | undefined,
  options: FormatOptions = {},
): string {
  if (!isNum(value)) return MISSING;
  const scale = options.scale ?? 'ratio';
  const signed = options.signed ?? false;
  const abs = Math.abs(value);

  switch (format) {
    case 'currency':
      return withSign(`$${grouped(Math.round(abs))}`, value, signed);
    case 'currency_compact':
      return withSign(`$${compact(abs)}`, value, signed);
    case 'percent':
    case 'ratio': {
      const decimals = options.decimals ?? (scale === 'points' ? 2 : 1);
      return withSign(`${grouped(toPercentUnits(abs, scale), decimals)}%`, value, signed);
    }
    case 'percent_signed': {
      const decimals = options.decimals ?? 1;
      return withSign(`${grouped(toPercentUnits(abs, scale), decimals)}%`, value, true);
    }
    case 'pp_signed': {
      const decimals = options.decimals ?? (scale === 'points' ? 2 : 1);
      return withSign(`${grouped(toPercentUnits(abs, scale), decimals)} pp`, value, true);
    }
    case 'count':
      return withSign(grouped(Math.round(abs)), value, signed);
    case 'count_signed':
      return withSign(grouped(Math.round(abs)), value, true);
    case 'count_signed_thousands':
      return withSign(compact(abs), value, true);
    case 'decimal1':
      return withSign(grouped(abs, 1), value, signed);
    case 'days': {
      const days = Math.round(abs);
      return withSign(`${grouped(days)} ${days === 1 ? 'day' : 'days'}`, value, signed);
    }
    default:
      return withSign(grouped(abs, abs < 10 && abs % 1 !== 0 ? 2 : 0), value, signed);
  }
}

/** A change, always signed (decimal1/days/count deltas still show "+"). */
export function formatDelta(
  value: number | null | undefined,
  format: string | null | undefined,
  options: Omit<FormatOptions, 'signed'> = {},
): string {
  return formatValue(value, format, { ...options, signed: true });
}

/** Axis ticks: compact and short. */
export function formatAxis(value: number, format: string | null | undefined, scale: Scale = 'ratio'): string {
  if (!Number.isFinite(value)) return '';
  switch (format) {
    case 'currency':
    case 'currency_compact':
      return `$${compact(Math.abs(value))}`.replace(/^/, value < 0 ? MINUS : '');
    case 'count':
      return (value < 0 ? MINUS : '') + compact(Math.abs(value));
    case 'percent':
    case 'ratio':
      return `${Number(toPercentUnits(value, scale).toFixed(scale === 'points' ? 2 : 1))}%`;
    case 'decimal1':
      return value.toFixed(1);
    case 'index':
      return value.toFixed(0);
    default:
      return String(Number(value.toFixed(2)));
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function parseIsoDate(iso: string | null | undefined): { y: number; m: number; d: number } | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** "2026-05-31" → "May 2026" (no timezone shifts: parsed as a calendar date). */
export function formatMonth(iso: string | null | undefined, long = false): string {
  const p = parseIsoDate(iso);
  if (!p) return MISSING;
  return `${(long ? MONTHS_LONG : MONTHS)[p.m - 1]} ${p.y}`;
}

/** "2026-09-24" → "Sep 24, 2026". */
export function formatDate(iso: string | null | undefined): string {
  const p = parseIsoDate(iso);
  if (!p) return MISSING;
  return `${MONTHS[p.m - 1]} ${p.d}, ${p.y}`;
}

/** Short tick label: "May '26". */
export function formatMonthTick(iso: string): string {
  const p = parseIsoDate(iso);
  if (!p) return iso;
  return `${MONTHS[p.m - 1]} '${String(p.y).slice(2)}`;
}

/** "2026-09-28T22:05:51Z" → "Sep 28, 2026, 22:05 UTC". */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return MISSING;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return MISSING;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

/** Small dollar amounts with cents precision (run costs): 0.0647 → "$0.0647". */
export function formatUsd(value: number | null | undefined): string {
  if (!isNum(value)) return MISSING;
  return `$${value < 1 ? value.toFixed(4) : value.toFixed(2)}`;
}
