/**
 * The affordability studio (spec §7.4, M6): the house at center stage, scaled by the
 * price you set (÷ U.S. median, clamped 0.6–1.6×) with a dashed ghost of the
 * year-ago house; sliders for price, down payment, rate and term; the payment, the
 * year-ago payment, the payment stack and the payment-to-income ring. Defaults and
 * "Reset to published" are the agent's published assumptions. Every figure comes from
 * lib/amortization (the agent's formula) on these inputs or from the metro file.
 */
import { ArrowLeft, RotateCcw, Share2 } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { HouseStage } from '../dossier/parts';
import { isValidSlug } from '../data/api';
import { useIndex, useMetro } from '../data/hooks';
import type { IndexOutput, MetroDetailOutput } from '../data/schema.gen';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useIsDark, usePrefersReducedMotion } from '../hooks/useMediaQuery';
import { useSetQuery } from '../hooks/useQueryState';
import { useToast } from '../hooks/Toast';
import { copyText } from '../lib/clipboard';
import { parseChannels } from '../lib/columns';
import { houseScale, temperatureLight } from '../lib/dossier';
import { formatDelta, formatValue } from '../lib/format';
import { parseStudio, PRICE_MAX, PRICE_MIN, RATE_MAX, RATE_MIN, studio, studioParams, TERMS, type StudioInputs } from '../lib/studio';
import { PaymentStack } from '../studio/PaymentStack';
import { AtlasChrome } from '../ui/AtlasChrome';
import { metroPath, useMediaPaused } from '../ui/atlasState';
import { Button, Segmented, Slider } from '../ui/controls';
import { GlassPanel } from '../ui/Glass';
import { calculatorDefaults } from '../viewmodels/metro';

export function StudioPage() {
  const { slug = '' } = useParams();
  const index = useIndex();
  const metro = useMetro(isValidSlug(slug) ? slug : '');
  useDocumentTitle(metro.status === 'ready' ? `Affordability · ${metro.data.name}` : null);
  const ready = index.status === 'ready' && metro.status === 'ready';
  const defaults = ready ? calculatorDefaults(metro.data) : null;
  return (
    <AtlasChrome>
      {ready && defaults ? (
        <Studio index={index.data} m={metro.data} published={{ price: defaults.price, downPaymentPct: defaults.downPaymentPct, ratePct: defaults.ratePct, termYears: defaults.termYears }} income={defaults.income} />
      ) : (
        <div className="grid min-h-[70vh] place-items-center px-6 text-center" role="status">
          <div>
            <p className="mp-display text-[34px]">
              {metro.status === 'error' ? 'We don’t track a metro at that address.' : ready ? 'No affordability figures for this metro this run.' : 'Loading the studio…'}
            </p>
            {(metro.status === 'error' || ready) && (
              <Link to={ready ? metroPath(slug) : '/explore'} className="mt-4 inline-block text-mp-accent">
                {ready ? 'Back to the dossier' : 'Browse the atlas'}
              </Link>
            )}
          </div>
        </div>
      )}
    </AtlasChrome>
  );
}

function Studio({ index, m, published, income }: { index: IndexOutput; m: MetroDetailOutput; published: StudioInputs; income: number | null }) {
  const [params] = useSearchParams();
  const setQuery = useSetQuery();
  const toast = useToast();
  const dark = useIsDark();
  const reduce = usePrefersReducedMotion();
  const [mediaPaused] = useMediaPaused();
  const inputs = parseStudio(params, published);
  const set = (next: Partial<StudioInputs>) => setQuery({ ...studioParams({ ...inputs, ...next }, published), tier: params.get('tier') });
  const usMedian = index.national.latest.median_sale_price?.value ?? null;
  const r = studio(inputs, usMedian, income);
  const a = m.affordability!;
  const agoPrice = a.assumptions.price_year_ago;
  const ghost = agoPrice != null ? houseScale(agoPrice, usMedian) : null;
  const vsAgo = r.payment != null && a.payment_year_ago ? r.payment / a.payment_year_ago - 1 : null;
  const isPublished = Object.values(studioParams(inputs, published)).every((v) => v === null);
  const light = useMemo(() => {
    const css = getComputedStyle(document.documentElement);
    const g = (n: string) => parseChannels(css.getPropertyValue(`--mp-${n}`));
    return temperatureLight(m.temperature.score, { cold: g('cold-light'), neutral: g('mid'), warm: g('warm-light') });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.temperature.score, dark]);

  // The stack's scale covers the published case at a 30-year term and the current inputs,
  // so blocks grow and shrink against a stable yardstick.
  const reference = studio({ ...published, termYears: 30 }, usMedian, income).total;
  const maxTotal = Math.max(reference, r.total) * 1.02;
  const usd = (v: number | null | undefined) => formatValue(v, 'currency');
  const shade = (token: string, pct: number) => `color-mix(in srgb, rgb(var(--mp-${token})) ${pct}%, rgb(var(--mp-panel)))`;
  const parts = [
    // Opaque shades (mixed into the panel) so stacked blocks never show through each other.
    { key: 'down', label: 'Down payment', value: r.down, text: usd(r.down), front: shade('ink', 32), side: shade('ink', 20), top: shade('ink', 46) },
    { key: 'principal', label: 'Loan principal', value: r.principal, text: usd(r.principal), front: shade('accent', 62), side: shade('accent', 42), top: shade('accent', 100) },
    { key: 'interest', label: `Interest over ${inputs.termYears} years`, value: r.interest, text: usd(r.interest), front: shade('hot-1', 68), side: shade('hot-1', 46), top: shade('hot-1', 100) },
  ];
  const cents = (v: number | null | undefined) => (v == null ? '—' : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

  const share = async () => toast((await copyText(window.location.href)) ? 'Link to these numbers copied' : "Couldn't copy the link");

  return (
    <div className="mx-auto max-w-[1360px] px-4 pb-20 pt-6 sm:px-8">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-mp-ink-3">
        <Link to={metroPath(m.slug)} className="inline-flex items-center gap-1 text-mp-ink-3 no-underline hover:text-mp-ink">
          <ArrowLeft size={14} strokeWidth={1.5} aria-hidden="true" /> {m.name}
        </Link>
        / <span className="text-mp-ink-2">Affordability studio</span>
      </nav>
      <h1 className="mp-display mt-3 text-[40px] leading-[1] sm:text-[56px]">What a home costs in {m.name.replace(/,\s*[A-Z-]+$/, '')}</h1>

      <div className="mt-8 grid gap-8 lg:grid-cols-[340px_minmax(0,1fr)_360px]">
        {/* ---------- inputs ---------- */}
        <GlassPanel as="section" aria-labelledby="inputs-h" className="order-2 p-5 lg:order-1">
          <h2 id="inputs-h" className="mp-label">
            Your numbers
          </h2>
          <div className="mt-4 space-y-7">
            <Slider
              label="Price"
              size="lg"
              value={inputs.price}
              min={PRICE_MIN}
              max={PRICE_MAX}
              step={1000}
              scale="log"
              onChange={(v) => set({ price: v })}
              format={(v) => formatValue(v, 'currency')}
              hint={`Published median ${usd(published.price)} · ${formatDelta(inputs.price / (usMedian ?? inputs.price) - 1, 'percent_signed')} vs the U.S. median`}
            />
            <Slider
              label="Down payment"
              size="lg"
              value={inputs.downPaymentPct}
              min={0}
              max={50}
              step={1}
              onChange={(v) => set({ downPaymentPct: v })}
              format={(v) => `${Math.round(v)}%`}
              hint={usd(r.down)}
            />
            <Slider
              label="30-yr rate"
              size="lg"
              value={inputs.ratePct}
              min={RATE_MIN}
              max={RATE_MAX}
              step={0.05}
              onChange={(v) => set({ ratePct: Math.round(v * 100) / 100 })}
              format={(v) => `${v.toFixed(2)}%`}
              hint={`Latest Freddie Mac PMMS ${published.ratePct.toFixed(2)}% · a year ago ${a.assumptions.rate_year_ago?.toFixed(2) ?? '—'}%`}
            />
            <div>
              <div className="mp-label mb-2">Term</div>
              <Segmented label="Term" value={String(inputs.termYears) as `${(typeof TERMS)[number]}`} onChange={(v) => set({ termYears: Number(v) })} options={TERMS.map((t) => ({ value: String(t) as `${typeof t}`, label: `${t} yr` }))} />
            </div>
            {/* On phones the payment panel is below the fold while you drag: echo it here. */}
            <p className="flex items-baseline justify-between border-t border-mp-line pt-4 text-sm text-mp-ink-2 lg:hidden" aria-hidden="true">
              Monthly payment <span className="mp-num text-[22px] text-mp-ink">{cents(r.payment)}</span>
            </p>
            <div className="flex flex-wrap gap-2 border-t border-mp-line pt-4">
              <Button onClick={() => setQuery({ price: null, down: null, rate: null, term: null })} disabled={isPublished} icon={<RotateCcw size={15} strokeWidth={1.5} aria-hidden="true" />}>
                Reset to published
              </Button>
              <Button variant="quiet" onClick={share} icon={<Share2 size={15} strokeWidth={1.5} aria-hidden="true" />}>
                Share
              </Button>
            </div>
          </div>
        </GlassPanel>

        {/* ---------- the house ---------- */}
        <section aria-label="The house" className="relative order-1 min-h-[340px] lg:order-2 lg:min-h-[560px]">
          <HouseStage className="absolute inset-0" scale={r.houseScale} rim={light.rim} lean={light.lean} dark={dark} animate={!reduce && !mediaPaused} ghostScale={ghost} />
          <p className="absolute inset-x-0 bottom-0 text-center text-xs text-mp-ink-3" data-testid="house-caption">
            House {r.houseScale.toFixed(2)}× the U.S. median ({usd(usMedian)}).{ghost != null && ` Dashed: a year ago, ${usd(agoPrice)} at ${a.assumptions.rate_year_ago?.toFixed(2)}%.`}
          </p>
        </section>

        {/* ---------- the payment ---------- */}
        <GlassPanel as="section" aria-labelledby="pay-h" className="order-3 p-5">
          <h2 id="pay-h" className="mp-label">
            Monthly payment · principal + interest
          </h2>
          <div aria-live="polite" aria-atomic="true">
            <div className="mp-num-hero mt-2 text-[48px] leading-none" data-testid="studio-payment">
              {cents(r.payment)}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 text-sm text-mp-ink-2">
              <span>
                A year ago <b className="mp-num font-medium text-mp-ink">{cents(a.payment_year_ago)}</b>
              </span>
              {vsAgo != null && <span className={`mp-num ${vsAgo > 0 ? 'text-mp-hot-2' : 'text-mp-cool-2'}`}>{formatDelta(vsAgo, 'percent_signed')}</span>}
            </div>
          </div>
          <div className="mt-5 grid grid-cols-[140px_1fr] items-end gap-4 border-t border-mp-line pt-4">
            <div className="h-[220px]">
              <PaymentStack parts={parts} maxTotal={maxTotal} height={220} />
            </div>
            <dl className="space-y-2.5 text-sm" data-testid="stack-legend">
              {[...parts].reverse().map((p) => (
                <div key={p.key}>
                  <dt className="flex items-center gap-2 text-xs text-mp-ink-3">
                    <span className="h-2.5 w-2.5 flex-none rounded-sm" style={{ background: p.top }} aria-hidden="true" />
                    {p.label}
                  </dt>
                  <dd className="mp-num pl-[18px] text-mp-ink">{p.text}</dd>
                </div>
              ))}
              <div className="border-t border-mp-line pt-2">
                <dt className="text-xs text-mp-ink-3">Total cost of the home</dt>
                <dd className="mp-num text-mp-ink">{usd(r.total)}</dd>
              </div>
            </dl>
          </div>
          <div className="mt-5 flex items-center gap-4 border-t border-mp-line pt-4">
            <Ring share={r.paymentToIncome} />
            <div>
              <div className="mp-label">Payment-to-income</div>
              <p className="mt-1 text-sm text-mp-ink-2">
                {r.paymentToIncome != null
                  ? `${formatValue(r.paymentToIncome, 'percent')} of the median household income (${usd(income)}).`
                  : 'Needs income data: Census ACS household income isn’t in this run, so the ring stays empty rather than guess.'}
              </p>
            </div>
          </div>
          <p className="mt-4 text-[11px] text-mp-ink-3">Principal and interest only; taxes, insurance and HOA are not included. Same formula as the agent’s published payments.</p>
        </GlassPanel>
      </div>
    </div>
  );
}

function Ring({ share }: { share: number | null }) {
  const R = 28;
  const C = 2 * Math.PI * R;
  const f = share == null ? 0 : Math.min(1, share);
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" role="img" aria-label={share == null ? 'Payment-to-income unavailable' : `Payment is ${formatValue(share, 'percent')} of income`}>
      <circle cx="36" cy="36" r={R} fill="none" style={{ stroke: 'rgb(var(--mp-ink) / .14)' }} strokeWidth="7" strokeDasharray={share == null ? '3 5' : undefined} />
      {share != null && (
        <circle cx="36" cy="36" r={R} fill="none" style={{ stroke: share > 0.3 ? 'rgb(var(--mp-hot-2))' : 'rgb(var(--mp-accent))' }} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${f * C} ${C}`} transform="rotate(-90 36 36)" />
      )}
    </svg>
  );
}
