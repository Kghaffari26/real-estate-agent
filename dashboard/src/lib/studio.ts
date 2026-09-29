/**
 * Affordability studio (spec M6), pure: the payment and its parts for the studio's
 * inputs, with the same formula as the agent (lib/amortization.ts, SPEC §5.2). The
 * published assumptions are the defaults and the "Reset to published" target; the
 * year-ago house and payment are the agent's published figures.
 */
import { calculate, totalInterest } from './amortization';
import { houseScale } from './dossier';

export interface StudioInputs {
  price: number;
  downPaymentPct: number; // 0–100
  ratePct: number; // e.g. 7.03
  termYears: number;
}

export interface StudioResult {
  payment: number | null;
  loan: number;
  down: number;
  principal: number;
  /** Interest paid over the full term at this payment. */
  interest: number;
  total: number;
  /** Annual P&I ÷ household income, null without income. */
  paymentToIncome: number | null;
  houseScale: number;
}

export function studio(inputs: StudioInputs, usMedian: number | null, income: number | null): StudioResult {
  const r = calculate({ ...inputs, annualIncome: income });
  const down = Math.max(inputs.price, 0) - r.loanAmount;
  const interest = r.monthlyPayment == null ? 0 : Math.max(0, totalInterest(r.loanAmount, r.monthlyPayment, inputs.termYears));
  return {
    payment: r.monthlyPayment,
    loan: r.loanAmount,
    down,
    principal: r.loanAmount,
    interest,
    total: down + r.loanAmount + interest,
    paymentToIncome: r.paymentToIncome,
    houseScale: houseScale(inputs.price, usMedian),
  };
}

export const PRICE_MIN = 50_000;
export const PRICE_MAX = 3_000_000;
export const RATE_MIN = 2;
export const RATE_MAX = 10;
export const TERMS = [15, 20, 30] as const;

const num = (raw: string | null | undefined) => (raw == null || raw === '' ? NaN : Number(raw));

/** URL → inputs (`?price=&down=&rate=&term=`), falling back to the published defaults field by field. */
export function parseStudio(params: URLSearchParams, defaults: StudioInputs): StudioInputs {
  const price = num(params.get('price'));
  const down = num(params.get('down'));
  const rate = num(params.get('rate'));
  const term = num(params.get('term'));
  return {
    price: Number.isFinite(price) && price >= PRICE_MIN && price <= PRICE_MAX ? price : defaults.price,
    downPaymentPct: Number.isFinite(down) && down >= 0 && down <= 100 ? down : defaults.downPaymentPct,
    ratePct: Number.isFinite(rate) && rate >= RATE_MIN && rate <= RATE_MAX ? rate : defaults.ratePct,
    termYears: (TERMS as readonly number[]).includes(term) ? term : defaults.termYears,
  };
}

/** Inputs → URL params, omitting any that equal the published default (short, shareable URLs). */
export function studioParams(inputs: StudioInputs, defaults: StudioInputs): Record<string, string | null> {
  const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  return {
    price: same(inputs.price, defaults.price) ? null : String(Math.round(inputs.price)),
    down: same(inputs.downPaymentPct, defaults.downPaymentPct) ? null : String(inputs.downPaymentPct),
    rate: same(inputs.ratePct, defaults.ratePct) ? null : inputs.ratePct.toFixed(2),
    term: same(inputs.termYears, defaults.termYears) ? null : String(inputs.termYears),
  };
}
