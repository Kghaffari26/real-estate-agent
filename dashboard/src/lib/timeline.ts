/**
 * Per-metro history for the time machine: one metric, every metro, month by month.
 * Source: `timeline/<metric>.json` once the agent publishes it (spec §8.2 E1),
 * otherwise assembled from the metro files' 36-month series.
 *
 * Past months have no published YoY, so `changeAt` derives it from the series
 * (value vs 12 months earlier, same rule the agent uses: a ratio for ratio metrics,
 * a difference otherwise). The latest month always uses the published figure.
 */
export interface Timeline {
  dates: string[];
  metros: Record<string, Array<number | null>>;
}

type SeriesMap = Record<string, ReadonlyArray<string | number | null>>;

export function timelineFromSeries(files: ReadonlyArray<{ slug: string; series: SeriesMap }>, metric: string): Timeline {
  // Use the longest date axis; files normally share one.
  let dates: string[] = [];
  for (const f of files) {
    const d = (f.series.dates ?? []) as string[];
    if (d.length > dates.length) dates = [...d];
  }
  const metros: Timeline['metros'] = {};
  for (const f of files) {
    const own = (f.series.dates ?? []) as string[];
    const values = (f.series[metric] ?? []) as Array<number | null>;
    const byDate = new Map(own.map((d, i) => [d, typeof values[i] === 'number' && Number.isFinite(values[i]) ? values[i] : null]));
    metros[f.slug] = dates.map((d) => byDate.get(d) ?? null);
  }
  return { dates, metros };
}

export function valueAt(t: Timeline | null, slug: string, i: number): number | null {
  return t?.metros[slug]?.[i] ?? null;
}

/** Change vs 12 months earlier: a ratio for `ratio` metrics, a difference otherwise. */
export function changeAt(series: ReadonlyArray<number | null> | undefined, i: number, kind: 'ratio' | 'pp' | 'diff'): number | null {
  if (!series || i < 12) return null;
  const now = series[i];
  const then = series[i - 12];
  if (now == null || then == null) return null;
  if (kind === 'ratio') return then === 0 ? null : now / then - 1;
  return now - then;
}

/** Index of the month `ym` (YYYY-MM) in `dates`, or the last month. */
export function monthIndex(dates: readonly string[], ym: string | null | undefined): number {
  if (!ym) return dates.length - 1;
  const i = dates.findIndex((d) => d.slice(0, 7) === ym);
  return i >= 0 ? i : dates.length - 1;
}

/** Months the time machine skips at a timeline's start, so every month on its axis has a year-ago value. */
export const YOY_LEAD = 12;

/** `months` consecutive month-end ISO dates from `start` (a month end), e.g. a TimelineRef's axis. */
export function monthEnds(start: string, months: number): string[] {
  const [y, m] = start.split('-').map(Number) as [number, number];
  return Array.from({ length: Math.max(0, months) }, (_, i) => {
    const month = m - 1 + i;
    const last = new Date(Date.UTC(y, month + 1, 0)); // day 0 of the next month
    return last.toISOString().slice(0, 10);
  });
}
