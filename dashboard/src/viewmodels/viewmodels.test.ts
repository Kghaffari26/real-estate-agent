import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IndexOutputSchema, MetroDetailOutputSchema } from '../data/schema.gen';
import { calculate, roundCents } from '../lib/amortization';
import { buildRegistry } from '../lib/metrics';
import { calculatorDefaults, flagFacts, formatFact, investigationView, metricTiles, temperatureRows } from './metro';
import { alertViews, investigationSummaryViews, keyStatViews, moverRows, nationalMetricKeys } from './overview';

const read = (p: string) => JSON.parse(readFileSync(resolve(__dirname, '../../sample-data', p), 'utf8'));
const index = IndexOutputSchema.parse(read('latest.json'));
const registry = buildRegistry(index.metric_registry);
const metro = MetroDetailOutputSchema.parse(read('metros/pittsburgh-pa.json'));

describe('overview view model', () => {
  it('formats key stats in display units', () => {
    const [price, rate] = keyStatViews(index.key_stats);
    expect(price!.value).toMatch(/^\$\d+K$/);
    expect(price!.deltaLabel).toBe('YoY');
    expect(rate!.value).toBe('7.03%');
    expect(rate!.deltaLabel).toBe('1 wk');
  });

  it('builds movers, alerts and investigations', () => {
    expect(moverRows(index.movers.price_gains, 'percent_signed')[0]!.value).toBe('+7.8%');
    const alerts = alertViews(index);
    expect(alerts[0]!.metros.length).toBe(index.alerts[0]!.metros.length);
    const legacy = alertViews({ ...index, alerts: index.alerts.map((a) => ({ ...a, metros: [] })) });
    expect(legacy[0]!.metros[0]!.name).not.toBe('');
    const inv = investigationSummaryViews(index, registry);
    expect(inv[0]!.citedMetrics[0]!.label).toBe('Median sale price');
    expect(nationalMetricKeys(index)[0]).toBe('median_sale_price');
  });
});

describe('metro view model', () => {
  it('builds KPI tiles from the registry', () => {
    const tiles = metricTiles(metro, registry);
    const price = tiles.find((t) => t.key === 'median_sale_price')!;
    expect(price.value).toBe('$275,000');
    expect(price.high36).toBe(true);
    expect(price.trend).toBe('up');
    const permits = tiles.find((t) => t.key === 'permits_total')!;
    expect(permits.value).toBe('—');
    expect(permits.permits).toBe(true);
    expect(tiles.find((t) => t.key === 'avg_sale_to_list')!.value).toMatch(/%$/);
  });

  it('lists temperature components with signs', () => {
    const rows = temperatureRows(metro, registry);
    expect(rows).toHaveLength(6);
    expect(rows.find((r) => r.key === 'median_dom')!.sign).toBe(-1);
  });

  it('formats flag facts by unit suffix', () => {
    expect(formatFact('rent_minus_value_yoy_pp', 0.0324)).toBe('+3.2 pp');
    expect(formatFact('payment_change_pct', 0.1627)).toBe('+16.3%');
    expect(formatFact('median_dom_yoy_days', 12)).toBe('+12 days');
    expect(formatFact('months_of_supply', 6.24)).toBe('6.2');
    const jump = metro.flags.find((f) => f.id === 'payment_jump')!;
    expect(flagFacts(jump, registry)).toEqual([{ label: 'Monthly payment YoY', value: '+16.3%' }]);
  });

  it('prefills the calculator so it reproduces payment_now', () => {
    const d = calculatorDefaults(metro)!;
    expect(d).toMatchObject({ price: 275000, downPaymentPct: 20, ratePct: 7.03, termYears: 30 });
    const r = calculate({ price: d.price, downPaymentPct: d.downPaymentPct, ratePct: d.ratePct, termYears: d.termYears });
    expect(roundCents(r.monthlyPayment!)).toBe(d.publishedPayment);
  });

  it('reproduces payment_now for every sample metro (SPEC §13: site calculator matches)', async () => {
    const { readdirSync } = await import('node:fs');
    for (const file of readdirSync(resolve(__dirname, '../../sample-data/metros'))) {
      const m = MetroDetailOutputSchema.parse(read(`metros/${file}`));
      const d = calculatorDefaults(m);
      if (!d) continue;
      const r = calculate({ price: d.price, downPaymentPct: d.downPaymentPct, ratePct: d.ratePct, termYears: d.termYears });
      expect(roundCents(r.monthlyPayment!), file).toBeCloseTo(d.publishedPayment!, 1);
    }
  });

  it('maps the investigation', () => {
    const view = investigationView(metro, registry)!;
    expect(view.triggerKind).toBe('top_mover');
    expect(view.text.length).toBeGreaterThan(100);
    expect(investigationView({ investigation: null }, registry)).toBeNull();
  });
});
