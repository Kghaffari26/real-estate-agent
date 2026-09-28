import { describe, expect, it } from 'vitest';
import type { MetricRegistryEntry } from '../data/schema.gen';
import { buildRegistry, deltaFormat, flagName, metricLabel, metroMetricKeys, sentiment, temperatureBand, valueScale } from './metrics';

const entry = (over: Partial<MetricRegistryEntry>): MetricRegistryEntry => ({
  key: 'x',
  label: 'X',
  format: 'count',
  change_kind: 'ratio',
  good_direction: 'neutral',
  source: 'redfin',
  note: null,
  ...over,
});

describe('metrics', () => {
  const registry = buildRegistry([
    entry({ key: 'median_sale_price', label: 'Median sale price', format: 'currency' }),
    entry({ key: 'avg_sale_to_list', label: 'Sale-to-list ratio', format: 'percent', change_kind: 'pp' }),
    entry({ key: 'median_dom', format: 'days', change_kind: 'diff' }),
    entry({ key: 'months_of_supply', format: 'decimal1', change_kind: 'diff' }),
    entry({ key: 'mortgage30', format: 'percent', change_kind: 'diff', source: 'fred' }),
  ]);

  it('labels from the registry, humanized otherwise', () => {
    expect(metricLabel(registry, 'median_sale_price')).toBe('Median sale price');
    expect(metricLabel(registry, 'new_thing')).toBe('New thing');
  });

  it('derives the unit scale: ratios except FRED rates', () => {
    expect(valueScale(registry.get('avg_sale_to_list'))).toBe('ratio');
    expect(valueScale(registry.get('mortgage30'))).toBe('points');
    expect(valueScale(undefined)).toBe('ratio');
  });

  it('derives delta formats like the agent, preferring the published one', () => {
    expect(deltaFormat(registry.get('median_sale_price'))).toBe('percent_signed');
    expect(deltaFormat(registry.get('avg_sale_to_list'))).toBe('pp_signed');
    expect(deltaFormat(registry.get('median_dom'))).toBe('count_signed');
    expect(deltaFormat(registry.get('months_of_supply'))).toBe('decimal1');
    expect(deltaFormat(registry.get('mortgage30'))).toBe('pp_signed');
    expect(deltaFormat(registry.get('median_dom'), 'days')).toBe('days');
  });

  it('scores sentiment against good_direction', () => {
    expect(sentiment('up', 0.1)).toBe(1);
    expect(sentiment('up', -0.1)).toBe(-1);
    expect(sentiment('down', 0.1)).toBe(-1);
    expect(sentiment('neutral', 0.1)).toBe(0);
    expect(sentiment('up', null)).toBe(0);
  });

  it('orders metro metrics by the registry', () => {
    expect(metroMetricKeys(registry, ['median_dom', 'median_sale_price', 'zzz'])).toEqual(['median_sale_price', 'median_dom']);
  });

  it('maps temperature labels and flag names', () => {
    expect(temperatureBand('Hot')).toBe('hot');
    expect(temperatureBand(null)).toBe('unknown');
    expect(flagName('payment_jump')).toBe('Payment jump');
    expect(flagName('brand_new_flag')).toBe('Brand new flag');
  });
});
