import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MetroDetailOutputSchema } from '../data/schema.gen';
import { calculatorDefaults } from '../viewmodels/metro';
import { monthlyPayment, roundCents } from './amortization';
import { HOUSE_SCALE_MAX } from './dossier';
import { parseStudio, studio, studioParams } from './studio';

const files = readdirSync('sample-data/metros').filter((f) => f.endsWith('.json'));
const metros = files.map((f) => MetroDetailOutputSchema.parse(JSON.parse(readFileSync(`sample-data/metros/${f}`, 'utf8'))));

describe('the calculator reproduces every published payment (spec §7.4)', () => {
  it(`all ${files.length} metros: payment_now and payment_year_ago to the cent`, () => {
    expect(files.length).toBe(50);
    let checked = 0;
    for (const m of metros) {
      const d = calculatorDefaults(m);
      const a = m.affordability;
      if (!d || !a) continue;
      const r = studio({ price: d.price, downPaymentPct: d.downPaymentPct, ratePct: d.ratePct, termYears: d.termYears }, null, null);
      expect(roundCents(r.payment!), m.slug).toBe(a.payment_now);
      if (a.payment_year_ago != null && a.assumptions.price_year_ago != null && a.assumptions.rate_year_ago != null) {
        const ago = monthlyPayment(a.assumptions.price_year_ago * (1 - (a.assumptions.down_payment_pct ?? 0.2)), a.assumptions.rate_year_ago, a.assumptions.term_years ?? 30);
        expect(roundCents(ago!), `${m.slug} year ago`).toBe(a.payment_year_ago);
      }
      checked++;
    }
    expect(checked).toBe(50);
  });
});

describe('studio', () => {
  const inputs = { price: 413_543, downPaymentPct: 20, ratePct: 7.03, termYears: 30 };

  it('splits the price into down payment, principal and total interest', () => {
    const r = studio(inputs, 398_596, null);
    expect(r.down).toBeCloseTo(413_543 * 0.2, 6);
    expect(r.principal).toBeCloseTo(413_543 * 0.8, 6);
    expect(r.interest).toBeCloseTo(r.payment! * 360 - r.principal, 6);
    expect(r.total).toBeCloseTo(r.down + r.payment! * 360, 6);
    expect(r.houseScale).toBeCloseTo(413_543 / 398_596, 12);
    expect(r.paymentToIncome).toBeNull();
    expect(studio({ ...inputs, price: 5_000_000 }, 398_596, null).houseScale).toBe(HOUSE_SCALE_MAX);
    expect(studio(inputs, 398_596, 80_000).paymentToIncome).toBeCloseTo((r.payment! * 12) / 80_000, 12);
  });

  it('a 0% rate has no interest; 100% down has no loan', () => {
    expect(studio({ ...inputs, ratePct: 0 }, null, null).interest).toBe(0);
    const cash = studio({ ...inputs, downPaymentPct: 100 }, null, null);
    expect([cash.loan, cash.payment, cash.interest]).toEqual([0, 0, 0]);
  });

  it('round-trips URL state, keeping the defaults out of the URL', () => {
    const p = studioParams({ ...inputs, ratePct: 6.5 }, inputs);
    expect(p).toEqual({ price: null, down: null, rate: '6.50', term: null });
    const back = parseStudio(new URLSearchParams({ rate: '6.50', term: '15', price: 'abc', down: '150' }), inputs);
    expect(back).toEqual({ ...inputs, ratePct: 6.5, termYears: 15 });
    expect(parseStudio(new URLSearchParams({ term: '25', price: '10' }), inputs)).toEqual(inputs);
  });
});
