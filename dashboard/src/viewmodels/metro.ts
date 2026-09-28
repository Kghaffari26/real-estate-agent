/** View model for the metro detail page (pure). */
import type { FlagOut, MetroDetailOutput } from '../data/schema.gen';
import type { InvestigationView } from '../components/data/InvestigationCard';
import type { ComponentBar } from '../components/data/TemperatureComponents';
import type { FlagView } from '../components/data/FlagCards';
import { formatValue } from '../lib/format';
import { deltaFormat, isPermitMetric, metricLabel, TEMPERATURE_COMPONENTS, valueScale, type Registry } from '../lib/metrics';

export interface MetricTileView {
  key: string;
  label: string;
  value: string;
  raw: number | null;
  scale: 'ratio' | 'points';
  format: string;
  yoy: number | null;
  mom: number | null;
  deltaFormat: string;
  trend: 'up' | 'down' | 'flat' | null;
  high36: boolean;
  low36: boolean;
  goodDirection: string;
  note: string | null;
  permits: boolean;
}

export function metricTiles(metro: Pick<MetroDetailOutput, 'latest'>, registry: Registry): MetricTileView[] {
  const keys = [...registry.keys()].filter((k) => k in metro.latest);
  return keys.map((key) => {
    const entry = registry.get(key);
    const m = metro.latest[key]!;
    const permits = 'yoy_12m' in m || isPermitMetric(key);
    const full = 'mom' in m ? m : null;
    return {
      key,
      label: metricLabel(registry, key),
      value: formatValue(m.value, entry?.format, { scale: valueScale(entry) }),
      raw: m.value ?? null,
      scale: valueScale(entry),
      format: entry?.format ?? 'count',
      yoy: 'yoy_12m' in m ? m.yoy_12m : 'yoy' in m ? (m.yoy ?? null) : null,
      mom: full?.mom ?? null,
      deltaFormat: deltaFormat(entry, full?.delta_format),
      trend: full?.trend_3m ?? null,
      high36: full?.high_36m === true,
      low36: full?.low_36m === true,
      goodDirection: entry?.good_direction ?? 'neutral',
      note: permits ? 'YoY on a rolling 12-month sum' : (entry?.note ?? null),
      permits,
    };
  });
}

/** Plain-language readings of a component's z-score (higher / lower than the other metros). */
const READINGS: Record<string, { high: string; low: string }> = {
  avg_sale_to_list: { high: 'Homes sell closer to asking than in most metros', low: 'Homes sell further below asking than in most metros' },
  sold_above_list: { high: 'More homes sell above the original list price', low: 'Fewer homes sell above the original list price' },
  off_market_in_two_weeks: { high: 'More listings go under contract within two weeks', low: 'Fewer listings go under contract within two weeks' },
  median_dom: { high: 'Homes take longer to sell than in most metros', low: 'Homes sell faster than in most metros' },
  price_drops: { high: 'More listings have price cuts than in most metros', low: 'Fewer listings have price cuts than in most metros' },
  months_of_supply: { high: 'More supply relative to sales than most metros', low: 'Tighter supply than most metros' },
};

export function componentReading(key: string, z: number | null): string {
  if (z === null) return 'Not available this month';
  if (Math.abs(z) < 0.25) return 'About typical for the tracked metros';
  const r = READINGS[key];
  return r ? (z > 0 ? r.high : r.low) : z > 0 ? 'Higher than most metros' : 'Lower than most metros';
}

/** Temperature components as signed contributions (z × sign): positive = hotter (SPEC §5.3). */
export function temperatureBars(metro: Pick<MetroDetailOutput, 'temperature'>, registry: Registry): ComponentBar[] {
  const components: Record<string, number | null> = metro.temperature.components ?? {};
  return TEMPERATURE_COMPONENTS.map(({ key, sign }) => {
    const z = typeof components[key] === 'number' ? components[key]! : null;
    return { key, label: metricLabel(registry, key), z, contribution: z === null ? null : z * sign, reading: componentReading(key, z) };
  });
}

export function flagViews(metro: Pick<MetroDetailOutput, 'flags'>, registry: Registry): FlagView[] {
  return metro.flags.map((f) => ({ id: f.id, label: f.label, severity: f.severity, facts: flagFacts(f, registry) }));
}

/**
 * Format a flag fact by its key's unit suffix. The facts dict carries no formats
 * (a contract gap); the keys come from agents/real_estate/flags.py.
 */
export function formatFact(key: string, value: number): string {
  if (key.endsWith('_pp')) return formatValue(value, 'pp_signed');
  if (key.endsWith('_days')) return formatValue(value, 'days', { signed: true });
  if (key.endsWith('_yoy') || key.endsWith('_yoy_12m') || key.endsWith('_pct')) return formatValue(value, 'percent_signed');
  return formatValue(value, 'decimal1');
}

const FACT_LABELS: Readonly<Record<string, string>> = {
  inventory_yoy: 'Inventory YoY',
  median_sale_price_yoy: 'Median sale price YoY',
  price_drops_yoy_pp: 'Price drops YoY',
  median_dom_yoy_days: 'Days on market YoY',
  months_of_supply: 'Months of supply',
  rent_minus_value_yoy_pp: 'Rent YoY minus home value YoY',
  permits_yoy_12m: 'Permits YoY (12-month sum)',
  payment_change_pct: 'Monthly payment YoY',
};

export function flagFacts(flag: FlagOut, registry: Registry): { label: string; value: string }[] {
  return Object.entries(flag.facts).map(([key, value]) => ({
    label: FACT_LABELS[key] ?? registry.get(key)?.label ?? key.replace(/_/g, ' '),
    value: formatFact(key, value),
  }));
}

export function investigationView(metro: Pick<MetroDetailOutput, 'investigation'>, registry: Registry): InvestigationView | null {
  const inv = metro.investigation;
  if (!inv) return null;
  return {
    slug: inv.slug,
    name: inv.name,
    triggerLabel: inv.trigger_label,
    triggerKind: inv.trigger,
    text: inv.explanation,
    citedMetrics: inv.cited_metrics.map((key) => ({ key, label: metricLabel(registry, key) })),
    narrativeSource: inv.narrative_source,
    reused: inv.reused,
    stopReason: inv.stop_reason,
    steps: inv.steps,
    toolsCalled: inv.tools_called,
    generatedAt: inv.generated_at,
  };
}

export interface CalculatorDefaults {
  price: number;
  downPaymentPct: number;
  ratePct: number;
  termYears: number;
  income: number | null;
  publishedPayment: number | null;
}

/**
 * Prefill from the affordability block (§5.2): the price is the latest median sale
 * price, down payment and term from `assumptions`, the rate is `rate_now`.
 */
export function calculatorDefaults(metro: Pick<MetroDetailOutput, 'affordability' | 'latest'>): CalculatorDefaults | null {
  const a = metro.affordability;
  const price = metro.latest.median_sale_price?.value;
  const rate = a?.assumptions.rate_now;
  if (!a || typeof price !== 'number' || typeof rate !== 'number') return null;
  return {
    price,
    downPaymentPct: (a.assumptions.down_payment_pct ?? 0.2) * 100,
    ratePct: rate,
    termYears: a.assumptions.term_years ?? 30,
    income: a.median_household_income ?? null,
    publishedPayment: a.payment_now,
  };
}
