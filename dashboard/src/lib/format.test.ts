import { describe, expect, it } from 'vitest';
import {
  formatAxis,
  formatDate,
  formatDateTime,
  formatDelta,
  formatMonth,
  formatMonthTick,
  formatUsd,
  formatValue,
  MISSING,
} from './format';

describe('formatValue', () => {
  it('renders missing values as a dash', () => {
    expect(formatValue(null, 'currency')).toBe(MISSING);
    expect(formatValue(undefined, 'percent')).toBe(MISSING);
    expect(formatValue(Number.NaN, 'count')).toBe(MISSING);
  });

  it('currency: whole dollars, grouped', () => {
    expect(formatValue(441000, 'currency')).toBe('$441,000');
    expect(formatValue(1636.94, 'currency')).toBe('$1,637');
    expect(formatValue(-2500, 'currency')).toBe('−$2,500');
  });

  it('currency_compact', () => {
    expect(formatValue(449846, 'currency_compact')).toBe('$450K');
    expect(formatValue(431200, 'currency_compact')).toBe('$431K');
    expect(formatValue(1_250_000, 'currency_compact')).toBe('$1.25M');
    expect(formatValue(12_500, 'currency_compact')).toBe('$12.5K');
    expect(formatValue(950, 'currency_compact')).toBe('$950');
  });

  it('percent: ratio scale by default, points scale for rates', () => {
    expect(formatValue(0.968, 'percent')).toBe('96.8%');
    expect(formatValue(0.3688, 'percent')).toBe('36.9%');
    expect(formatValue(7.03, 'percent', { scale: 'points' })).toBe('7.03%');
    expect(formatValue(0.968, 'percent', { decimals: 0 })).toBe('97%');
  });

  it('ratio renders as a percent', () => {
    expect(formatValue(0.266, 'ratio')).toBe('26.6%');
  });

  it('percent_signed', () => {
    expect(formatValue(0.021, 'percent_signed')).toBe('+2.1%');
    expect(formatValue(-0.031, 'percent_signed')).toBe('−3.1%');
    expect(formatValue(0, 'percent_signed')).toBe('0.0%');
  });

  it('pp_signed: ratio differences and rate-point differences', () => {
    expect(formatValue(0.009, 'pp_signed')).toBe('+0.9 pp');
    expect(formatValue(-0.0052, 'pp_signed')).toBe('−0.5 pp');
    expect(formatValue(0.08, 'pp_signed', { scale: 'points' })).toBe('+0.08 pp');
    expect(formatValue(-0.07, 'pp_signed', { scale: 'points' })).toBe('−0.07 pp');
  });

  it('count and count_signed', () => {
    expect(formatValue(12880, 'count')).toBe('12,880');
    expect(formatValue(1460440.4, 'count')).toBe('1,460,440');
    expect(formatValue(9, 'count_signed')).toBe('+9');
    expect(formatValue(-5, 'count_signed')).toBe('−5');
    expect(formatValue(0, 'count_signed')).toBe('0');
  });

  it('count_signed_thousands', () => {
    expect(formatValue(12_400, 'count_signed_thousands')).toBe('+12.4K');
    expect(formatValue(-1_500, 'count_signed_thousands')).toBe('−1.5K');
  });

  it('decimal1 (signed on request)', () => {
    expect(formatValue(5.8, 'decimal1')).toBe('5.8');
    expect(formatValue(3.142008895, 'decimal1')).toBe('3.1');
    expect(formatValue(-0.15, 'decimal1')).toBe('−0.2');
    expect(formatValue(0.7, 'decimal1', { signed: true })).toBe('+0.7');
  });

  it('days', () => {
    expect(formatValue(61, 'days')).toBe('61 days');
    expect(formatValue(1, 'days')).toBe('1 day');
    expect(formatValue(-3, 'days', { signed: true })).toBe('−3 days');
  });

  it('unknown formats fall back to a plain number', () => {
    expect(formatValue(336.663, 'index')).toBe('337');
    expect(formatValue(3.25, undefined)).toBe('3.25');
  });
});

describe('formatDelta', () => {
  it('always signs', () => {
    expect(formatDelta(0.7, 'decimal1')).toBe('+0.7');
    expect(formatDelta(7, 'count_signed')).toBe('+7');
    expect(formatDelta(0.0225, 'pp_signed')).toBe('+2.3 pp');
    expect(formatDelta(null, 'pp_signed')).toBe(MISSING);
  });
});

describe('formatAxis', () => {
  it('is compact', () => {
    expect(formatAxis(450000, 'currency')).toBe('$450K');
    expect(formatAxis(1_460_000, 'count')).toBe('1.46M');
    expect(formatAxis(0.25, 'percent')).toBe('25%');
    expect(formatAxis(6.5, 'percent', 'points')).toBe('6.5%');
    expect(formatAxis(102.345, 'index')).toBe('102');
  });
});

describe('dates', () => {
  it('formats calendar dates without timezone drift', () => {
    expect(formatMonth('2026-05-31')).toBe('May 2026');
    expect(formatMonth('2026-05-31', true)).toBe('May 2026');
    expect(formatMonth('2026-01-31', true)).toBe('January 2026');
    expect(formatDate('2026-09-24')).toBe('Sep 24, 2026');
    expect(formatMonthTick('2023-06-30')).toBe("Jun '23");
    expect(formatDateTime('2026-09-28T22:05:51Z')).toBe('Sep 28, 2026, 22:05 UTC');
    expect(formatMonth(null)).toBe(MISSING);
    expect(formatDateTime('nope')).toBe(MISSING);
  });
});

describe('formatUsd', () => {
  it('keeps small costs precise', () => {
    expect(formatUsd(0.0647)).toBe('$0.0647');
    expect(formatUsd(1.5)).toBe('$1.50');
    expect(formatUsd(null)).toBe(MISSING);
  });
});
