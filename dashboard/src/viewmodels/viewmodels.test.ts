import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndexOutputSchema, MetroDetailOutputSchema, type MetroDetailOutput } from '../data/schema.gen';
import { calculate, roundCents } from '../lib/amortization';
import { formatValue } from '../lib/format';
import { buildRegistry } from '../lib/metrics';
import { calculatorDefaults, componentReading, flagFacts, flagViews, formatFact, investigationView, metricTiles, temperatureBars } from './metro';
import { alertViews, heatCells, investigationSummaryViews, keyStatViews, moverRows, nationalMetricKeys } from './overview';

// Expectations are derived from the committed snapshot so refreshing it doesn't break tests.
const dir = resolve(__dirname, '../../sample-data');
const read = (p: string) => JSON.parse(readFileSync(resolve(dir, p), 'utf8'));
const index = IndexOutputSchema.parse(read('latest.json'));
const registry = buildRegistry(index.metric_registry);
const metros: MetroDetailOutput[] = readdirSync(resolve(dir, 'metros')).map((f) => MetroDetailOutputSchema.parse(read(`metros/${f}`)));
const investigated = metros.find((m) => m.investigation) ?? metros[0]!;
const flagged = metros.find((m) => m.flags.some((f) => Object.keys(f.facts).length)) ?? metros[0]!;

describe('overview view model', () => {
  it('formats key stats in display units', () => {
    const [price, rate] = keyStatViews(index.key_stats);
    expect(price!.value).toMatch(/^\$\d+K$/);
    expect(price!.deltaLabel).toBe('YoY');
    expect(rate!.value).toBe(formatValue(index.key_stats[1]!.value, 'percent', { scale: 'points' }));
    expect(rate!.deltaLabel).toBe('1 wk');
  });

  it('builds movers, alerts, heat cells and investigations', () => {
    const gains = moverRows(index.movers.price_gains, 'percent_signed');
    expect(gains[0]!.text).toBe(formatValue(index.movers.price_gains[0]!.value, 'percent_signed'));
    expect(gains[0]!.value).toBe(index.movers.price_gains[0]!.value);
    const alerts = alertViews(index);
    expect(alerts[0]!.metros.length).toBe(index.alerts.find((a) => a.flag === alerts[0]!.flag)!.metros.length);
    const legacy = alertViews({ ...index, alerts: index.alerts.map((a) => ({ ...a, metros: [] })) });
    expect(legacy[0]!.metros[0]!.name).not.toBe('');
    const cells = heatCells(index);
    expect(cells).toHaveLength(50);
    expect(cells[0]!.score! >= cells[49]!.score!).toBe(true);
    const inv = investigationSummaryViews(index, registry);
    expect(inv).toHaveLength(index.investigations.length);
    expect(nationalMetricKeys(index)[0]).toBe('median_sale_price');
  });
});

describe('metro view model', () => {
  it('builds KPI tiles from the registry', () => {
    const m = metros[0]!;
    const tiles = metricTiles(m, registry);
    const price = tiles.find((t) => t.key === 'median_sale_price')!;
    expect(price.raw).toBe(m.latest.median_sale_price!.value);
    expect(price.value).toBe(formatValue(m.latest.median_sale_price!.value, 'currency'));
    expect(['up', 'down', 'flat', null]).toContain(price.trend);
    const permits = tiles.find((t) => t.key === 'permits_total')!;
    expect(permits.permits).toBe(true);
    expect(tiles.find((t) => t.key === 'avg_sale_to_list')!.value).toMatch(/%$/);
    expect(tiles.find((t) => t.key === 'avg_sale_to_list')!.scale).toBe('ratio');
  });

  it('turns temperature components into signed contributions with readings', () => {
    const bars = temperatureBars(metros[0]!, registry);
    expect(bars).toHaveLength(6);
    const dom = bars.find((b) => b.key === 'median_dom')!;
    if (dom.z !== null) expect(dom.contribution).toBeCloseTo(-dom.z);
    expect(componentReading('median_dom', 1.2)).toBe('Homes take longer to sell than in most metros');
    expect(componentReading('median_dom', -1.2)).toBe('Homes sell faster than in most metros');
    expect(componentReading('price_drops', 0.1)).toBe('About typical for the tracked metros');
    expect(componentReading('x', null)).toBe('Not available this month');
  });

  it('formats flag facts by unit suffix', () => {
    expect(formatFact('rent_minus_value_yoy_pp', 0.0324)).toBe('+3.2 pp');
    expect(formatFact('payment_change_pct', 0.1627)).toBe('+16.3%');
    expect(formatFact('median_dom_yoy_days', 12)).toBe('+12 days');
    expect(formatFact('months_of_supply', 6.24)).toBe('6.2');
    const flag = flagged.flags.find((f) => Object.keys(f.facts).length)!;
    expect(flagFacts(flag, registry)[0]!.value).not.toBe('');
    expect(flagViews(flagged, registry)).toHaveLength(flagged.flags.length);
  });

  it('prefills the calculator so it reproduces payment_now', () => {
    const d = calculatorDefaults(metros[0]!)!;
    expect(d.price).toBe(metros[0]!.latest.median_sale_price!.value);
    expect(d.downPaymentPct).toBe(20);
    const r = calculate({ price: d.price, downPaymentPct: d.downPaymentPct, ratePct: d.ratePct, termYears: d.termYears });
    expect(roundCents(r.monthlyPayment!)).toBeCloseTo(d.publishedPayment!, 1);
  });

  it('reproduces payment_now for every sample metro (SPEC §13: site calculator matches)', () => {
    for (const m of metros) {
      const d = calculatorDefaults(m);
      if (!d) continue;
      const r = calculate({ price: d.price, downPaymentPct: d.downPaymentPct, ratePct: d.ratePct, termYears: d.termYears });
      expect(roundCents(r.monthlyPayment!), m.slug).toBeCloseTo(d.publishedPayment!, 1);
    }
  });

  it('maps the investigation', () => {
    const view = investigationView(investigated, registry);
    if (investigated.investigation) {
      expect(view!.triggerKind).toBe(investigated.investigation.trigger);
      expect(view!.citedMetrics.length).toBe(investigated.investigation.cited_metrics.length);
    }
    expect(investigationView({ investigation: null }, registry)).toBeNull();
  });
});
