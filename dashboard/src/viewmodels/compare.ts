/** View model for Compare: the arena's series and the side-by-side table (pure). */
import type { MetricRegistryEntry, MetroDetailOutput } from '../data/schema.gen';
import type { Timeline } from '../lib/timeline';
import { dossierChart, type ChartRange } from './dossier';
import { formatValue } from '../lib/format';
import { deltaFormat, metricLabel, valueScale, type Registry } from '../lib/metrics';
import { indexTo100, numericSeries } from '../lib/series';

export const MAX_COMPARE = 3;

/** Metrics every compared metro can chart (registry order). */
export function comparableMetrics(metros: readonly MetroDetailOutput[], registry: Registry): string[] {
  return [...registry.keys()].filter(
    (key) => metros.length > 0 && metros.some((m) => numericSeries(m.series, key)?.some((v) => v !== null)),
  );
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

// ---------- v2 arena ----------

export interface ArenaSeries {
  dates: string[];
  lines: Array<{ slug: string; values: Array<number | null> }>;
  span: 'timeline' | 'metro-file';
}

/**
 * One metric for every compared metro on one date axis: the metro files' months, or
 * the §6.4 timeline for "All" when it's loaded. Indexed rebases each line to 100 at
 * its first value in the range (same rule as v1's compare and the dossier).
 */
export function arenaSeries(metros: readonly MetroDetailOutput[], metric: MetricRegistryEntry, range: ChartRange, indexed: boolean, timeline: Timeline | null): ArenaSeries {
  const charts = metros.map((m) => ({ slug: m.slug, c: dossierChart({ detail: m, metric, range, mode: 'level', indexed: false, national: null, timeline }) }));
  const longest = charts.reduce<string[]>((a, x) => (x.c.dates.length > a.length ? x.c.dates : a), []);
  const lines = charts.map(({ slug, c }) => {
    const byDate = new Map(c.dates.map((d, i) => [d, c.metro[i] ?? null]));
    const values = longest.map((d) => byDate.get(d) ?? null);
    return { slug, values: indexed ? indexTo100(values) : values };
  });
  return { dates: longest, lines, span: charts.every((x) => x.c.span === 'timeline') && charts.length > 0 ? 'timeline' : 'metro-file' };
}
