/**
 * Metro dossier view model (pure): the main chart's series for a metric, range and
 * mode, and the instrument list. Levels are published values (metro file, or the §6.4
 * timeline for "All"); YoY for past months is derived from those levels with the
 * agent's rule (lib/timeline changeAt); the latest month's YoY is the published one.
 */
import type { MetricRegistryEntry, MetroDetailOutput } from '../data/schema.gen';
import { indexTo100 } from '../lib/series';
import { changeAt, type Timeline } from '../lib/timeline';

export type ChartRange = '1Y' | '3Y' | 'All';
export type ChartMode = 'level' | 'yoy';

export interface ChartInputs {
  detail: Pick<MetroDetailOutput, 'slug' | 'series' | 'latest'>;
  metric: MetricRegistryEntry;
  range: ChartRange;
  mode: ChartMode;
  indexed: boolean;
  /** National series (index `national.series`), same monthly dates as the metro file. */
  national: Record<string, ReadonlyArray<string | number | null>> | null;
  /** The metric's §6.4 timeline, when published and loaded (for "All"). */
  timeline: Timeline | null;
}

export interface ChartData {
  dates: string[];
  metro: Array<number | null>;
  /** U.S. line, only when indexing to the U.S. and the national series exists. */
  national: Array<number | null> | null;
  /** Whether indexing is possible for this metric/range (a national series over the range). */
  canIndex: boolean;
  /** Where "All" reaches (e.g. "since January 2012" vs "36 months"). */
  span: 'timeline' | 'metro-file';
}

const nums = (xs: ReadonlyArray<string | number | null> | undefined): Array<number | null> => (xs ?? []).map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null));

export function dossierChart({ detail, metric, range, mode, indexed, national, timeline }: ChartInputs): ChartData {
  const useTimeline = range === 'All' && timeline != null && timeline.metros[detail.slug] != null;
  const allDates = useTimeline ? timeline!.dates : ((detail.series.dates ?? []) as string[]);
  const allValues = useTimeline ? timeline!.metros[detail.slug]! : nums(detail.series[metric.key]);
  const months = range === '1Y' ? 12 : range === '3Y' ? 36 : allDates.length;
  const start = Math.max(0, allDates.length - months);
  const dates = allDates.slice(start);

  let metro: Array<number | null>;
  if (mode === 'yoy') {
    metro = dates.map((_, i) => changeAt(allValues, start + i, metric.change_kind));
    // The latest month's change is the published one (identical rule, exact value).
    const published = detail.latest[metric.key];
    if (published && 'yoy' in published && published.yoy != null && dates.length) metro[metro.length - 1] = published.yoy;
  } else metro = allValues.slice(start);

  // Indexing needs the U.S. series on the same dates (metro-file ranges only).
  const natAll = national?.[metric.key];
  const natDates = (national?.dates ?? []) as string[];
  const canIndex = mode === 'level' && natAll != null && dates.every((d) => natDates.includes(d));
  let nationalLine: Array<number | null> | null = null;
  if (indexed && canIndex) {
    const nat = nums(natAll);
    nationalLine = indexTo100(dates.map((d) => nat[natDates.indexOf(d)] ?? null));
    metro = indexTo100(metro);
  }
  return { dates, metro, national: nationalLine, canIndex, span: useTimeline ? 'timeline' : 'metro-file' };
}

/** The dossier's instruments, in reading order (only metrics the metro reports). */
export const INSTRUMENT_KEYS = [
  'median_sale_price',
  'homes_sold',
  'new_listings',
  'inventory',
  'months_of_supply',
  'median_dom',
  'avg_sale_to_list',
  'sold_above_list',
  'price_drops',
  'off_market_in_two_weeks',
] as const;
