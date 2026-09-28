import { describe, expect, it } from 'vitest';
import { calculate, monthlyPayment, roundCents } from './amortization';

// Shared vectors with the agent's tests/test_affordability.py (SPEC §5.2, §11).
const VECTORS: Array<[number, number, number, number]> = [
  [400000, 6.5, 30, 2528.27],
  [300000, 7.0, 30, 1995.91],
  [200000, 5.0, 15, 1581.59],
];

describe('monthlyPayment', () => {
  it.each(VECTORS)('P=%d at %d%% over %dy → %d', (principal, rate, term, expected) => {
    expect(roundCents(monthlyPayment(principal, rate, term)!)).toBe(expected);
  });

  it('handles a zero rate and invalid input', () => {
    expect(monthlyPayment(360000, 0, 30)).toBe(1000);
    expect(monthlyPayment(0, 7, 30)).toBe(0);
    expect(monthlyPayment(100000, 7, 0)).toBeNull();
    expect(monthlyPayment(Number.NaN, 7, 30)).toBeNull();
  });
});

describe('calculate', () => {
  it('reproduces the published payment_now with default inputs (Pittsburgh sample)', () => {
    // affordability.payment_now = 1468.10 for price 275,000, 20% down, 7.03%, 30y.
    const result = calculate({ price: 275000, downPaymentPct: 20, ratePct: 7.03, termYears: 30 });
    expect(result.loanAmount).toBe(220000);
    expect(roundCents(result.monthlyPayment!)).toBe(1468.1);
    expect(result.paymentToIncome).toBeNull();
  });

  it('computes payment-to-income when income exists', () => {
    const result = calculate({ price: 500000, downPaymentPct: 20, ratePct: 6.5, termYears: 30, annualIncome: 100000 });
    expect(result.paymentToIncome).toBeCloseTo((2528.27 * 12) / 100000, 4);
  });

  it('clamps the down payment', () => {
    expect(calculate({ price: 100, downPaymentPct: 150, ratePct: 5, termYears: 30 }).loanAmount).toBe(0);
  });
});

describe('totalInterest', () => {
  it('is payments minus principal', async () => {
    const { totalInterest } = await import('./amortization');
    expect(roundCents(totalInterest(400000, 2528.27, 30))).toBe(510177.2);
    expect(totalInterest(100, 1, 1)).toBe(0);
  });
});
