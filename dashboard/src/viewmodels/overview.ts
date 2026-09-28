/** View model for the Overview page (pure). */
import type { IndexOutput, KeyStat } from '../data/schema.gen';
import type { AlertView } from '../components/data/AlertCards';
import type { InvestigationView } from '../components/data/InvestigationCard';
import type { RankedRow } from '../components/data/RankedBars';
import { formatValue } from '../lib/format';
import { metricLabel, type Registry } from '../lib/metrics';

export interface KeyStatView {
  label: string;
  value: string;
  delta: number | null;
  deltaFormat: string;
  goodDirection: string;
  deltaLabel: string;
}

/**
 * key_stats are agents-core KeyStats: values in display units (a rate of 7.03 is
 * 7.03%, a rate change of 0.08 is 0.08 pp), unlike metric ratios.
 */
export function keyStatViews(stats: readonly KeyStat[]): KeyStatView[] {
  return stats.map((s) => {
    const isRate = s.format === 'percent';
    return {
      label: s.label,
      value: formatValue(s.value, s.format, { scale: isRate ? 'points' : 'ratio' }),
      delta: s.delta,
      deltaFormat: s.delta_format ?? 'percent_signed',
      goodDirection: s.good_direction,
      // The agent's two stats: price is YoY, the rate change is week-over-week (§5.6).
      deltaLabel: s.delta_format === 'pp_signed' && isRate ? '1 wk' : 'YoY',
    };
  });
}

export function keyStatScale(stat: KeyStatView): 'ratio' | 'points' {
  return stat.deltaFormat === 'pp_signed' ? 'points' : 'ratio';
}

export function moverRows(entries: IndexOutput['movers']['price_gains'], format: string, scale: 'ratio' | 'points' = 'ratio'): RankedRow[] {
  return entries.map((e) => ({ slug: e.slug, name: e.name, value: e.value ?? null, text: formatValue(e.value, format, { scale }) }));
}

/** All metros for the heat grid, hottest first (ties by name). */
export function heatCells(index: Pick<IndexOutput, 'metros'>) {
  return [...index.metros]
    .map((m) => ({ slug: m.slug, name: m.name, score: m.temperature.score, label: m.temperature.label }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name));
}

export function alertViews(index: Pick<IndexOutput, 'alerts' | 'metros'>): AlertView[] {
  const names = new Map(index.metros.map((m) => [m.slug, m.name]));
  const order = { major: 0, notable: 1, info: 2 } as const;
  return [...index.alerts]
    .sort((a, b) => order[a.severity] - order[b.severity] || b.slugs.length - a.slugs.length)
    .map((a) => ({
      flag: a.flag,
      label: a.label,
      severity: a.severity,
      // 1.0.0 data has no per-metro figures: fall back to the slugs with the group label.
      metros: a.metros.length
        ? a.metros.map((m) => ({ slug: m.slug, name: m.name, label: m.label, severity: m.severity }))
        : a.slugs.map((slug) => ({ slug, name: names.get(slug) ?? slug, label: '', severity: a.severity })),
    }));
}

export function investigationSummaryViews(index: Pick<IndexOutput, 'investigations'>, registry: Registry): InvestigationView[] {
  return index.investigations.map((inv) => ({
    slug: inv.slug,
    name: inv.name,
    triggerLabel: inv.trigger_label,
    triggerKind: inv.trigger,
    text: inv.summary,
    citedMetrics: inv.cited_metrics.map((key) => ({ key, label: metricLabel(registry, key) })),
    narrativeSource: inv.narrative_source,
    stopReason: inv.stop_reason,
  }));
}

/** National series offered in the Overview chart: registry order, then anything else. */
export function nationalMetricKeys(index: Pick<IndexOutput, 'national' | 'metric_registry'>): string[] {
  const keys = Object.keys(index.national.series).filter((k) => k !== 'dates');
  const order = index.metric_registry.map((e) => e.key);
  return keys.sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
}
