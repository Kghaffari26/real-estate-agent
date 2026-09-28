/** View model for Compare: overlay rows and the side-by-side table (pure). */
import type { MetroDetailOutput } from '../data/schema.gen';
import { formatValue } from '../lib/format';
import { deltaFormat, metricLabel, valueScale, type Registry } from '../lib/metrics';
import { indexTo100, mergeOnDates, numericSeries, rangeStart, seriesDates, type Range, type Row } from '../lib/series';

export const MAX_COMPARE = 3;

/** Metrics every compared metro can chart (registry order). */
export function comparableMetrics(metros: readonly MetroDetailOutput[], registry: Registry): string[] {
  return [...registry.keys()].filter(
    (key) => metros.length > 0 && metros.some((m) => numericSeries(m.series, key)?.some((v) => v !== null)),
  );
}

/** One column per metro (keyed by slug) for `metric`, optionally rebased to 100. */
export function compareRows(metros: readonly MetroDetailOutput[], metric: string, range: Range, indexed: boolean): Row[] {
  const columns = Object.fromEntries(
    metros.map((m) => {
      const dates = seriesDates(m.series);
      const start = rangeStart(dates, range);
      const values = (numericSeries(m.series, metric) ?? []).slice(start);
      return [m.slug, { dates: dates.slice(start), values: indexed ? indexTo100(values) : values }];
    }),
  );
  return mergeOnDates(columns);
}

export interface CompareTableRow {
  key: string;
  label: string;
  cells: { value: string; yoy: string; raw: number | null }[];
  /** Index of the leading metro, or null (ties, missing data, or text rows). */
  leader: number | null;
  /** What "leading" means for this row, e.g. "Highest", "Fastest". */
  leaderLabel: string;
}

/**
 * The leader per metric: for metrics with a good direction, the best value; for
 * neutral metrics, simply the highest (labelled as such, not as "best").
 */
export function leaderIndex(values: readonly (number | null)[], direction: 'up' | 'down' | 'neutral'): number | null {
  const present = values.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => typeof x.v === 'number');
  if (present.length < 2) return null;
  const pick = direction === 'down' ? Math.min(...present.map((x) => x.v)) : Math.max(...present.map((x) => x.v));
  const winners = present.filter((x) => x.v === pick);
  return winners.length === 1 ? winners[0]!.i : null;
}

export function compareTable(metros: readonly MetroDetailOutput[], registry: Registry): CompareTableRow[] {
  const keys = [...registry.keys()].filter((k) => metros.some((m) => k in m.latest && m.latest[k]?.value !== null));
  const temps = metros.map((m) => m.temperature.score);
  const rows: CompareTableRow[] = [
    {
      key: 'temperature',
      label: 'Temperature',
      cells: metros.map((m) => ({ value: m.temperature.score === null ? '—' : `${m.temperature.score} · ${m.temperature.label ?? '—'}`, yoy: '', raw: m.temperature.score })),
      leader: leaderIndex(temps, 'up'),
      leaderLabel: 'Hottest',
    },
    { key: 'market_type', label: 'Market type', cells: metros.map((m) => ({ value: m.market_type ?? '—', yoy: '', raw: null })), leader: null, leaderLabel: '' },
  ];
  for (const key of keys) {
    const entry = registry.get(key);
    const cells = metros.map((m) => {
      const v = m.latest[key];
      const yoy = v ? ('yoy_12m' in v ? v.yoy_12m : 'yoy' in v ? v.yoy : null) : null;
      const published = v && 'delta_format' in v ? v.delta_format : null;
      return {
        value: formatValue(v?.value, entry?.format, { scale: valueScale(entry) }),
        yoy: formatValue(yoy, deltaFormat(entry, published), { signed: true }),
        raw: v?.value ?? null,
      };
    });
    const dir = entry?.good_direction ?? 'neutral';
    rows.push({ key, label: metricLabel(registry, key), cells, leader: leaderIndex(cells.map((c) => c.raw), dir), leaderLabel: dir === 'up' ? 'Best' : dir === 'down' ? 'Best' : 'Highest' });
  }
  const payments = metros.map((m) => m.affordability?.payment_now ?? null);
  if (payments.some((p) => p !== null)) {
    rows.push({
      key: 'payment_now',
      label: 'Monthly payment (P&I)',
      cells: metros.map((m) => ({ value: formatValue(m.affordability?.payment_now, 'currency'), yoy: formatValue(m.affordability?.payment_change_pct, 'percent_signed'), raw: m.affordability?.payment_now ?? null })),
      leader: leaderIndex(payments, 'down'),
      leaderLabel: 'Lowest',
    });
  }
  return rows;
}
