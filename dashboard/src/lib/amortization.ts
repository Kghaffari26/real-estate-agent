/**
 * Monthly principal & interest, the same formula as the agent (SPEC §5.2):
 * M = P·r(1+r)^n / ((1+r)^n − 1), r = annual rate / 12, n = years × 12.
 */
export function monthlyPayment(principal: number, annualRatePct: number, termYears: number): number | null {
  if (![principal, annualRatePct, termYears].every(Number.isFinite)) return null;
  if (principal < 0 || termYears <= 0 || annualRatePct < 0) return null;
  const n = Math.round(termYears * 12);
  if (principal === 0) return 0;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return principal / n;
  const growth = (1 + r) ** n;
  return (principal * r * growth) / (growth - 1);
}

export interface CalculatorInputs {
  price: number;
  downPaymentPct: number; // 0–100
  ratePct: number; // e.g. 7.03
  termYears: number;
  annualIncome?: number | null;
}

export interface CalculatorResult {
  loanAmount: number;
  monthlyPayment: number | null;
  /** Annual P&I ÷ annual household income (SPEC §5.2), or null without income. */
  paymentToIncome: number | null;
}

export function calculate(inputs: CalculatorInputs): CalculatorResult {
  const down = Math.min(Math.max(inputs.downPaymentPct, 0), 100) / 100;
  const loanAmount = Math.max(inputs.price, 0) * (1 - down);
  const payment = monthlyPayment(loanAmount, inputs.ratePct, inputs.termYears);
  const income = inputs.annualIncome;
  const paymentToIncome =
    payment !== null && typeof income === 'number' && income > 0 ? (payment * 12) / income : null;
  return { loanAmount, monthlyPayment: payment, paymentToIncome };
}

/** Round to cents the way the agent publishes payment_now. */
export function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Total interest paid over the full term at a fixed monthly payment. */
export function totalInterest(loanAmount: number, monthlyPayment: number, termYears: number): number {
  return Math.max(monthlyPayment * Math.round(termYears * 12) - loanAmount, 0);
}
