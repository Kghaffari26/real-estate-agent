/** Map view model: positions (de-overlapped), bubble sizes and YoY colors. Pure. */
import type { MapPoint } from '../components/map';
import type { LegendStep } from '../components/map/MapLegend';
import { formatValue } from '../lib/format';
import { bubbleRadius, spreadOverlapping } from '../lib/geo';
import { deltaFormat, metricLabel, type Registry } from '../lib/metrics';
import { bucketFor, divergingBuckets } from '../lib/scale';
import type { MetroRow } from './metros';

export function mapPoints(rows: readonly MetroRow[], registry: Registry, metric: string): MapPoint[] {
  const entry = registry.get(metric);
  const fmt = deltaFormat(entry);
  const buckets = divergingBuckets(rows.map((r) => r.metrics[metric]?.yoy));
  const maxSold = Math.max(...rows.map((r) => r.homesSold12m ?? 0), 1);
  const located = rows.filter((r) => r.lat !== null && r.lon !== null);
  const spread = spreadOverlapping(located.map((r) => ({ slug: r.slug, lat: r.lat!, lon: r.lon!, weight: r.homesSold12m ?? 0 })));
  const pos = new Map(spread.map((p) => [p.slug, p]));
  return located.map((r) => {
    const p = pos.get(r.slug)!;
    const yoy = r.metrics[metric]?.yoy;
    return {
      slug: r.slug,
      name: r.name,
      lat: p.displayLat,
      lon: p.displayLon,
      color: bucketFor(buckets, yoy),
      radius: bubbleRadius(r.homesSold12m, maxSold),
      lines: [
        `${metricLabel(registry, metric)} YoY: ${formatValue(yoy, fmt, { signed: true })}`,
        `Homes sold (12 mo): ${formatValue(r.homesSold12m, 'count')}`,
        `Temperature: ${r.temperatureScore ?? '—'}${r.temperatureLabel ? ` (${r.temperatureLabel})` : ''}`,
      ],
    };
  });
}

export function legendSteps(rows: readonly MetroRow[], registry: Registry, metric: string): LegendStep[] {
  const fmt = deltaFormat(registry.get(metric));
  const f = (v: number) => formatValue(v, fmt, { signed: true, decimals: fmt === 'percent_signed' || fmt === 'pp_signed' ? 1 : undefined });
  const buckets = divergingBuckets(rows.map((r) => r.metrics[metric]?.yoy));
  return [
    ...buckets.map((b) => ({
      color: b.token,
      label: b.min === -Infinity ? `< ${f(b.max)}` : b.max === Infinity ? `≥ ${f(b.min)}` : b.token === 'div-mid' ? `About flat (±${f(Math.abs(b.max)).replace(/^\+/, '')})` : `${f(b.min)} to ${f(b.max)}`,
    })),
    { color: 'div-missing' as const, label: 'No data' },
  ];
}

export function sizeLegend(rows: readonly MetroRow[]): { r: number; label: string }[] {
  const maxSold = Math.max(...rows.map((r) => r.homesSold12m ?? 0), 1);
  const marks = [10_000, 50_000].filter((v) => v < maxSold);
  return [...marks, maxSold].map((v) => ({ r: bubbleRadius(v, maxSold), label: formatValue(v, 'count_signed_thousands').replace('+', '') }));
}
