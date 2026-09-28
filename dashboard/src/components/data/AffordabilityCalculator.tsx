import { RotateCcw } from 'lucide-react';
import { useId, useState } from 'react';
import { calculate, totalInterest } from '../../lib/amortization';
import { formatValue } from '../../lib/format';
import { color } from '../../lib/tokens';
import type { CalculatorDefaults } from '../../viewmodels/metro';

interface SliderFieldProps {
  label: string;
  unit: string;
  value: string;
  onChange: (value: string) => void;
  min: number;
  max: number;
  step: number;
  hint?: string;
  display?: (n: number) => string;
}

/** A range slider paired with a number input; both edit the same value. */
function SliderField({ label, unit, value, onChange, min, max, step, hint, display }: SliderFieldProps) {
  const id = useId();
  const n = Number(value);
  const clamped = Number.isFinite(n) ? Math.min(Math.max(n, min), max) : min;
  return (
    <div>
      <div className="mb-1.5 flex items-end justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-text-2">
          {label} <span className="text-text-3">({unit})</span>
        </label>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          className="input num h-7 w-28 text-right"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
      </div>
      <input
        type="range"
        className="w-full accent-accent"
        min={min}
        max={max}
        step={step}
        value={clamped}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${label} slider`}
        aria-valuetext={display ? display(clamped) : String(clamped)}
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-0.5 text-2xs text-text-3">
          {hint}
        </p>
      )}
    </div>
  );
}

const TERMS = [15, 20, 30];

/** Monthly P&I (SPEC §5.2's formula), prefilled from the affordability block, with a lifetime cost breakdown. */
export function AffordabilityCalculator({ defaults }: { defaults: CalculatorDefaults }) {
  const init = () => ({ price: String(Math.round(defaults.price)), down: String(defaults.downPaymentPct), rate: String(defaults.ratePct), term: String(defaults.termYears) });
  const [v, setV] = useState(init);
  const termId = useId();
  const num = (s: string) => (s.trim() === '' ? Number.NaN : Number(s));
  const inputs = { price: num(v.price), downPaymentPct: num(v.down), ratePct: num(v.rate), termYears: num(v.term), annualIncome: defaults.income };
  const r = calculate(inputs);
  const valid = r.monthlyPayment !== null && Number.isFinite(r.loanAmount) && Number.isFinite(inputs.price);
  const interest = valid ? totalInterest(r.loanAmount, r.monthlyPayment!, inputs.termYears) : null;
  const downAmount = valid ? inputs.price - r.loanAmount : null;
  const parts = valid
    ? [
        { key: 'down', label: 'Down payment', value: downAmount!, tone: 'cat-3' as const },
        { key: 'principal', label: 'Loan principal', value: r.loanAmount, tone: 'cat-1' as const },
        { key: 'interest', label: 'Total interest', value: interest!, tone: 'cat-2' as const },
      ]
    : [];
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const priceMax = Math.max(2_000_000, Math.ceil((defaults.price * 3) / 100_000) * 100_000);

  return (
    <form className="grid grid-cols-1 gap-6 lg:grid-cols-5" onSubmit={(e) => e.preventDefault()} aria-label="Mortgage payment calculator">
      <div className="space-y-4 lg:col-span-3">
        <SliderField label="Home price" unit="$" value={v.price} onChange={(price) => setV({ ...v, price })} min={50_000} max={priceMax} step={5000} hint="Prefilled with the latest median sale price" display={(n) => formatValue(n, 'currency')} />
        <SliderField label="Down payment" unit="%" value={v.down} onChange={(down) => setV({ ...v, down })} min={0} max={100} step={1} display={(n) => `${n}%`} />
        <SliderField label="Interest rate" unit="% per year" value={v.rate} onChange={(rate) => setV({ ...v, rate })} min={0} max={15} step={0.01} hint="Prefilled with the latest 30-yr fixed rate" display={(n) => `${n}%`} />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <label htmlFor={termId} className="label">
              Term
            </label>
            <select id={termId} className="input w-36" value={v.term} onChange={(e) => setV({ ...v, term: e.target.value })}>
              {[...new Set([...TERMS, defaults.termYears])].sort((a, b) => a - b).map((t) => (
                <option key={t} value={String(t)}>
                  {t} years
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="btn" onClick={() => setV(init())}>
            <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
            Reset to defaults
          </button>
        </div>
      </div>

      <output className="well block space-y-4 p-4 lg:col-span-2" aria-live="polite">
        {valid ? (
          <>
            <div>
              <p className="text-xs font-medium text-text-3">Monthly principal &amp; interest</p>
              <p className="num text-2xl font-semibold tracking-tight">{formatValue(r.monthlyPayment, 'currency')}</p>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-text-3">Loan amount</dt>
                <dd className="num font-medium">{formatValue(r.loanAmount, 'currency')}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-3">Payment-to-income</dt>
                <dd className="num font-medium">
                  {r.paymentToIncome !== null ? formatValue(r.paymentToIncome, 'ratio') : '—'}
                  {defaults.income === null && <span className="block text-2xs font-normal text-text-3">Needs household income (not in this data)</span>}
                </dd>
              </div>
            </dl>
            <div>
              <p className="mb-1.5 text-xs font-medium text-text-3">Total cost over the term</p>
              <div className="flex h-3 overflow-hidden rounded-full" role="img" aria-label={parts.map((p) => `${p.label} ${formatValue(p.value, 'currency')}`).join(', ')}>
                {parts.map((p) => (
                  <div key={p.key} className="h-full border-r-2 border-surface-2 last:border-r-0" style={{ width: `${(p.value / total) * 100}%`, background: color(p.tone) }} />
                ))}
              </div>
              <ul className="mt-2 space-y-1 text-xs">
                {parts.map((p) => (
                  <li key={p.key} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-text-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: color(p.tone) }} aria-hidden="true" />
                      {p.label}
                    </span>
                    <span className="num font-medium">{formatValue(p.value, 'currency')}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          <p className="text-sm text-bad-text">Enter a price, a down payment between 0 and 100%, a rate of 0 or more and a term.</p>
        )}
      </output>
      <p className="text-2xs text-text-3 lg:col-span-5">Principal and interest only; excludes taxes, insurance and HOA dues. Not financial advice.</p>
    </form>
  );
}
