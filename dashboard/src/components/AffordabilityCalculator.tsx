import { useId, useState } from 'react';
import { calculate } from '../lib/amortization';
import { formatValue } from '../lib/format';
import type { CalculatorDefaults } from '../viewmodels/metro';

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  step: string;
  min: string;
  max?: string;
  suffix?: string;
  hint?: string;
}

function NumberField({ label, value, onChange, step, min, max, suffix, hint }: FieldProps) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
        {suffix && <span className="muted"> ({suffix})</span>}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        className="input tabular-nums"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs muted">
          {hint}
        </p>
      )}
    </div>
  );
}

const TERMS = [15, 20, 30];

/** Monthly P&I (standard amortization, SPEC §5.2), prefilled from the metro's affordability block. */
export function AffordabilityCalculator({ defaults }: { defaults: CalculatorDefaults }) {
  const [price, setPrice] = useState(String(Math.round(defaults.price)));
  const [down, setDown] = useState(String(defaults.downPaymentPct));
  const [rate, setRate] = useState(String(defaults.ratePct));
  const [term, setTerm] = useState(String(defaults.termYears));
  const termId = useId();

  const num = (s: string) => (s.trim() === '' ? Number.NaN : Number(s));
  const result = calculate({
    price: num(price),
    downPaymentPct: num(down),
    ratePct: num(rate),
    termYears: num(term),
    annualIncome: defaults.income,
  });
  const valid = result.monthlyPayment !== null && Number.isFinite(result.loanAmount);

  const reset = () => {
    setPrice(String(Math.round(defaults.price)));
    setDown(String(defaults.downPaymentPct));
    setRate(String(defaults.ratePct));
    setTerm(String(defaults.termYears));
  };

  return (
    <form className="space-y-4" onSubmit={(e) => e.preventDefault()} aria-label="Mortgage payment calculator">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <NumberField label="Home price" suffix="$" value={price} onChange={setPrice} step="1000" min="0" hint="Prefilled with the latest median sale price" />
        <NumberField label="Down payment" suffix="%" value={down} onChange={setDown} step="1" min="0" max="100" />
        <NumberField label="Interest rate" suffix="% per year" value={rate} onChange={setRate} step="0.01" min="0" hint="Prefilled with the latest 30-yr fixed rate" />
        <div>
          <label htmlFor={termId} className="label">
            Term <span className="muted">(years)</span>
          </label>
          <select id={termId} className="input" value={term} onChange={(e) => setTerm(e.target.value)}>
            {[...new Set([...TERMS, defaults.termYears])].sort((a, b) => a - b).map((t) => (
              <option key={t} value={String(t)}>
                {t} years
              </option>
            ))}
          </select>
        </div>
      </div>
      <output className="block rounded-md bg-surface-muted p-3" aria-live="polite">
        {valid ? (
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div>
              <dt className="text-sm muted">Monthly principal &amp; interest</dt>
              <dd className="text-2xl font-semibold tabular-nums">{formatValue(result.monthlyPayment, 'currency')}</dd>
            </div>
            <div>
              <dt className="text-sm muted">Loan amount</dt>
              <dd className="tabular-nums">{formatValue(result.loanAmount, 'currency')}</dd>
            </div>
            <div>
              <dt className="text-sm muted">Payment-to-income</dt>
              <dd className="tabular-nums">
                {result.paymentToIncome !== null ? formatValue(result.paymentToIncome, 'ratio') : '—'}
                {defaults.income === null && <span className="block text-xs muted">Needs median household income (not in this data)</span>}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-negative">Enter a price, a down payment between 0 and 100%, a rate of 0 or more and a term.</p>
        )}
      </output>
      <div className="flex flex-wrap items-center gap-3 text-xs muted">
        <button type="button" className="btn" onClick={reset}>
          Reset to defaults
        </button>
        <span>Principal and interest only; excludes taxes, insurance and HOA dues. Not financial advice.</span>
      </div>
    </form>
  );
}
