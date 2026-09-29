/** Pure helpers that turn the contract's column-oriented series into chart rows. */

export type Range = '1Y' | '3Y' | 'All';
export const RANGES: readonly Range[] = ['1Y', '3Y', 'All'];

export type SeriesMap = Record<string, readonly (string | number | null)[]>;

/** The shared `dates` column, or [] when missing/malformed. */
export function seriesDates(series: SeriesMap | null | undefined): string[] {
  const dates = series?.dates;
  return Array.isArray(dates) && dates.every((d) => typeof d === 'string') ? (dates as string[]) : [];
}

/** A numeric column aligned with `dates`, or null when absent/not numeric. */
export function numericSeries(series: SeriesMap | null | undefined, key: string): (number | null)[] | null {
  const values = series?.[key];
  if (!Array.isArray(values) || key === 'dates') return null;
  return values.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null));
}

/** True when a column has at least one number. */
export function hasData(values: readonly (number | null)[] | null): boolean {
  return Boolean(values?.some((v) => v !== null));
}

function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number) as [number, number];
  const [yb, mb] = b.split('-').map(Number) as [number, number];
  return (yb - ya) * 12 + (mb - ma);
}

/** Index of the first date inside `range`, measured back from the last date. */
export function rangeStart(dates: readonly string[], range: Range): number {
  if (range === 'All' || dates.length === 0) return 0;
  const months = range === '1Y' ? 12 : 36;
  const last = dates[dates.length - 1]!;
  const index = dates.findIndex((d) => monthsBetween(d, last) <= months);
  return Math.max(index, 0);
}

/** Rebase a column so its first non-null value is 100. */
export function indexTo100(values: readonly (number | null)[]): (number | null)[] {
  const base = values.find((v): v is number => v !== null && v !== 0);
  if (base === undefined) return values.map(() => null);
  return values.map((v) => (v === null ? null : (v / base) * 100));
}

export type Row = { date: string } & Record<string, number | null | string>;

/** Zip `dates` and named columns into rows (one object per date). */
export function toRows(dates: readonly string[], columns: Record<string, readonly (number | null)[]>): Row[] {
  return dates.map((date, i) => {
    const row: Row = { date };
    for (const [key, values] of Object.entries(columns)) row[key] = values[i] ?? null;
    return row;
  });
}

/**
 * Align a weekly series (e.g. mortgage rates) to month-end dates: each month takes the
 * last weekly value on or before it, if that value is within `maxGapDays`.
 */
export function alignToDates(
  targetDates: readonly string[],
  sourceDates: readonly string[],
  sourceValues: readonly (number | null)[],
  maxGapDays = 31,
): (number | null)[] {
  const day = 86_400_000;
  const src = sourceDates
    .map((d, i) => ({ t: Date.parse(d), v: sourceValues[i] ?? null }))
    .filter((p) => !Number.isNaN(p.t) && p.v !== null)
    .sort((a, b) => a.t - b.t);
  return targetDates.map((d) => {
    const t = Date.parse(d);
    let found: number | null = null;
    let foundT = -Infinity;
    for (const p of src) {
      if (p.t > t) break;
      found = p.v;
      foundT = p.t;
    }
    return found !== null && t - foundT <= maxGapDays * day ? found : null;
  });
}

/** Merge several (dates, values) columns on the union of their dates. */
export function mergeOnDates(
  columns: Record<string, { dates: readonly string[]; values: readonly (number | null)[] }>,
): Row[] {
  const all = new Set<string>();
  Object.values(columns).forEach((c) => c.dates.forEach((d) => all.add(d)));
  const dates = [...all].sort();
  const lookup = Object.fromEntries(
    Object.entries(columns).map(([key, c]) => [key, new Map(c.dates.map((d, i) => [d, c.values[i] ?? null]))]),
  );
  return dates.map((date) => {
    const row: Row = { date };
    for (const key of Object.keys(columns)) row[key] = lookup[key]!.get(date) ?? null;
    return row;
  });
}
