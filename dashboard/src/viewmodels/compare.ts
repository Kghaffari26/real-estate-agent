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
  cells: { value: string; yoy: string }[];
}

export function compareTable(metros: readonly MetroDetailOutput[], registry: Registry): CompareTableRow[] {
  const keys = [...registry.keys()].filter((k) => metros.some((m) => k in m.latest));
  const rows: CompareTableRow[] = [
    {
      key: 'temperature',
      label: 'Temperature',
      cells: metros.map((m) => ({ value: m.temperature.score === null ? '—' : `${m.temperature.score} (${m.temperature.label ?? '—'})`, yoy: '' })),
    },
    { key: 'market_type', label: 'Market type', cells: metros.map((m) => ({ value: m.market_type ?? '—', yoy: '' })) },
  ];
  for (const key of keys) {
    const entry = registry.get(key);
    rows.push({
      key,
      label: metricLabel(registry, key),
      cells: metros.map((m) => {
        const v = m.latest[key];
        const yoy = v ? ('yoy_12m' in v ? v.yoy_12m : 'yoy' in v ? v.yoy : null) : null;
        const published = v && 'delta_format' in v ? v.delta_format : null;
        return {
          value: formatValue(v?.value, entry?.format, { scale: valueScale(entry) }),
          yoy: formatValue(yoy, deltaFormat(entry, published), { signed: true }),
        };
      }),
    });
  }
  const payments = metros.map((m) => m.affordability?.payment_now ?? null);
  if (payments.some((p) => p !== null)) {
    rows.push({ key: 'payment_now', label: 'Monthly payment (P&I)', cells: metros.map((m) => ({ value: formatValue(m.affordability?.payment_now, 'currency'), yoy: formatValue(m.affordability?.payment_change_pct, 'percent_signed') })) });
  }
  return rows;
}
