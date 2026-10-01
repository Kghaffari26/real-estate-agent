/**
 * The worker's early read of a property (Listing Prep P3): a value range from area
 * medians, buyer needs sized from Census data, nearest public schools and walkable
 * amenities. Every number here was computed by the worker (agents/listing_prep); the
 * card only formats it, with its confidence, its inputs and its sources.
 */
import { Gauge } from 'lucide-react';
import type { Insights } from '../../backend/intake';
import { formatDateTime } from '../../lib/format';
import { formatDollars } from '../../lib/intake';
import { Card } from '../DeskPage';

const AMENITY_LABELS: Record<string, string> = {
  grocery: 'Groceries',
  park: 'Parks',
  transit: 'Bus stops',
  rail: 'Rail stations',
  cafe_restaurant: 'Cafés and restaurants',
};
const LEVEL_LABELS: Record<string, string> = { elementary: 'Elementary', middle: 'Middle', high: 'High' };
const CONFIDENCE: Record<string, string> = { high: 'High confidence', moderate: 'Moderate confidence', low: 'Low confidence' };

export function InsightsCard({ insights, factsConfirmed }: { insights: Insights | null; factsConfirmed: boolean }) {
  return (
    <Card title="Value and buyer needs (early read)" icon={<Gauge size={16} strokeWidth={1.5} aria-hidden="true" />} testId="desk-insights">
      {!insights ? (
        <p className="text-sm text-mp-ink-2" data-testid="desk-insights-empty">
          {factsConfirmed
            ? 'The worker computes this within about 15 minutes of confirming the facts.'
            : 'Confirm the facts to get an early value range, buyer needs, and nearby schools and amenities.'}
        </p>
      ) : (
        <div className="space-y-5">
          <Valuation v={insights.valuation} />
          {insights.segments && insights.segments.length > 0 && (
            <section aria-label="Buyer needs">
              <h3 className="text-[11px] uppercase tracking-[.06em] text-mp-ink-3">Buyer needs, sized from Census data</h3>
              <ul className="mt-2 space-y-2" data-testid="desk-segments">
                {insights.segments.map((s) => (
                  <li key={s.key} className="text-sm">
                    <span className="text-mp-ink">
                      <b>{s.label}</b> · {Math.round(s.weight * 100)}%
                    </span>
                    <span className="block text-mp-ink-2">Priorities: {s.priorities.join(', ')}.</span>
                    {s.evidence.length > 0 && <span className="block text-xs text-mp-ink-3">{s.evidence.join('; ')}.</span>}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-mp-ink-3">Needs describe the home, not the people who’d buy it. They guide preparation, never who to market to.</p>
            </section>
          )}
          {insights.schools && insights.schools.length > 0 && (
            <section aria-label="Nearest public schools">
              <h3 className="text-[11px] uppercase tracking-[.06em] text-mp-ink-3">Nearest public schools (by distance, not attendance boundaries)</h3>
              <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2" data-testid="desk-schools">
                {insights.schools.map((s) => (
                  <li key={`${s.level}-${s.name}`} className="text-mp-ink-2">
                    <span className="text-mp-ink">{s.name}</span> · {LEVEL_LABELS[s.level] ?? s.level} ({s.grades}) · {s.miles.toFixed(1)} mi
                  </li>
                ))}
              </ul>
            </section>
          )}
          {insights.amenities && (
            <section aria-label="Within a 20-minute walk">
              <h3 className="text-[11px] uppercase tracking-[.06em] text-mp-ink-3">Within about a 20-minute walk</h3>
              <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2" data-testid="desk-amenities">
                {insights.amenities.map((a) => (
                  <li key={a.kind} className="text-mp-ink-2">
                    <span className="text-mp-ink">{AMENITY_LABELS[a.kind] ?? a.kind}:</span> {a.count}
                    {a.nearest_miles !== null && <> · nearest {a.nearest_miles.toFixed(1)} mi</>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {insights.notes.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-mp-warn" data-testid="desk-insights-notes">
              {insights.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <p className="text-xs text-mp-ink-3">
            Sources: {insights.sources.join('; ') || 'none'}. Computed {formatDateTime(insights.computed_at)}.
          </p>
        </div>
      )}
    </Card>
  );
}

function Valuation({ v }: { v: Insights['valuation'] }) {
  if (!v) return null;
  const inputs = v.inputs;
  return (
    <section aria-label="Value range" data-testid="desk-valuation">
      <h3 className="text-[11px] uppercase tracking-[.06em] text-mp-ink-3">Value range · {CONFIDENCE[v.confidence]}</h3>
      <p className="mt-1 text-[22px] font-medium tabular-nums text-mp-ink">
        {formatDollars(v.low)} – {formatDollars(v.high)}
      </p>
      <p className="text-sm text-mp-ink-2">Midpoint {formatDollars(v.mid)}.</p>
      {v.method === 'zip_ppsf' && (
        <p className="mt-1 text-xs text-mp-ink-3">
          {formatDollars(Number(inputs.ppsf))}/sq ft ({inputs.ppsf_source === 'city' ? 'the city’s' : 'the ZIP’s'} median) × {Number(inputs.sqft).toLocaleString('en-US')} sq ft
          {inputs.size_adjustment !== 1 && <>, × {Number(inputs.size_adjustment).toFixed(2)} for size</>}
          {inputs.condition_adjustment !== 1 && <>, × {Number(inputs.condition_adjustment).toFixed(2)} for condition</>}, ± {Math.round(Number(inputs.spread) * 100)}%.
        </p>
      )}
      <ul className="mt-1 space-y-0.5 text-xs text-mp-ink-3">
        {v.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-mp-ink-3">A market analysis for pricing strategy, not an appraisal or a guarantee of sale price.</p>
    </section>
  );
}
