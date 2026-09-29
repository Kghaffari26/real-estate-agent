/**
 * Arrival (spec §7.1, M1): a slowly turning globe with light columns, the headline
 * and three counters; "Enter the market" dives the camera into the atlas. Below,
 * one hero per section: the brief, the heat field, rates vs prices, movers and
 * alerts, the investigations, then sources.
 *
 * First paint is text plus a static poster of the globe; the WebGL globe (deck.gl,
 * lazy) replaces the poster once its first frame is drawn.
 */
import { ArrowDown, ArrowRight } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { GlobeHandle } from '../arrival/GlobeCanvas';


function useGlobeLayout() {
  const get = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const phone = w < 768;
    // Globe radius ~40% of the short side (desktop), a little smaller on phones.
    const r = Math.min(phone ? w * 0.46 : h * 0.4, 520);
    return { zoom: Math.log2((r * 2 * Math.PI) / 512), r, phone };
  };
  const [layout, setLayout] = useState(get);
  useEffect(() => {
    const on = () => setLayout(get());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return layout;
}
import { AlertCards, BriefStory, HeatField, Podium, RatesPrices, Section, WhyMoving, type HeatBar } from '../arrival/sections';
import { useIndex, useManifest } from '../data/hooks';
import type { IndexOutput } from '../data/schema.gen';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useIsDark, usePrefersReducedMotion } from '../hooks/useMediaQuery';
import { withAttribution } from '../lib/attribution';
import { parseChannels } from '../lib/columns';
import { detectRateEvents } from '../lib/events';
import { formatDate, formatDateTime, formatDelta, formatMonth, formatValue } from '../lib/format';
import { buildRegistry } from '../lib/metrics';
import { sentences } from '../lib/text';
import { loadGsap } from '../motion/presets';
import { AtlasChrome } from '../ui/AtlasChrome';
import { useMediaPaused } from '../ui/atlasState';
import { Button } from '../ui/controls';
import { Counter } from '../ui/Counter';
import { alertViews, investigationSummaryViews } from '../viewmodels/overview';
import { atlasMetros, columnSet } from '../viewmodels/atlas';

const Globe = lazy(() => import('../arrival/GlobeCanvas'));

const DIVE_MS = 1700;

export function ArrivalPage() {
  useDocumentTitle(null);
  const index = useIndex();
  return (
    <AtlasChrome overlay>
      {index.status === 'ready' ? (
        <Arrival index={index.data} />
      ) : (
        // The backdrop and globe poster paint before the data arrives (they need none),
        // so the largest paint on a slow phone is the poster, not the loading wait.
        <section aria-label="Overview" className="relative h-[100svh] min-h-[640px] overflow-hidden">
          <HeroBackdrop />
          <div className="relative z-10 mx-auto max-w-[1280px] px-4 pt-28 sm:px-8 sm:pt-36" role="status">
            <p className="mp-display text-[34px] text-mp-ink-2">{index.status === 'error' ? 'The data could not be loaded.' : 'Loading the market…'}</p>
          </div>
        </section>
      )}
    </AtlasChrome>
  );
}

/** Stars, atmosphere and the globe poster, placed exactly where the live globe will be. */
function HeroBackdrop({ children, wrapRef, globeReady = false, diving = false }: { children?: ReactNode; wrapRef?: Ref<HTMLDivElement>; globeReady?: boolean; diving?: boolean }) {
  const dark = useIsDark();
  const globe = useGlobeLayout();
  return (
    <>
      <div className="mp-stars absolute inset-0" aria-hidden="true" />
      {/* GlobeView centers the globe in its canvas: the canvas box is placed so that
          center sits right of the copy (desktop) or below it (phones). */}
      <div ref={wrapRef} className={`absolute ${globe.phone ? 'left-[-20%] top-[30%] h-[62%] w-[140%]' : 'left-[26%] top-[-2%] h-[110%] w-[92%]'}`} aria-hidden="true">
        <div
          className="mp-atmosphere absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-opacity duration-500"
          // The visible limb is ~0.894 × the projected radius (the globe camera's perspective,
          // measured on the rendered poster); the glow sits just outside it.
          style={{ width: globe.r * 0.894 * 2.5, height: globe.r * 0.894 * 2.5, opacity: diving ? 0 : 1 }}
        />
        <img
          src={`${import.meta.env.BASE_URL}media/arrival-globe-${dark ? 'night' : 'dawn'}.jpg`}
          alt=""
          width={Math.round(globe.r * 2)}
          height={Math.round(globe.r * 2)}
          className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-opacity duration-700 ${globeReady ? 'opacity-0' : 'opacity-100'}`}
          style={{ width: globe.r * 2, height: globe.r * 2 }}
          fetchPriority="high"
          decoding="async"
          onError={(e) => (e.currentTarget.style.display = 'none')}
        />
        {children}
      </div>
    </>
  );
}

function Arrival({ index }: { index: IndexOutput }) {
  const navigate = useNavigate();
  const dark = useIsDark();
  const reduce = usePrefersReducedMotion();
  const [mediaPaused] = useMediaPaused();
  const manifest = useManifest();
  const globeRef = useRef<GlobeHandle>(null);
  const heroRef = useRef<HTMLElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const globeWrapRef = useRef<HTMLDivElement>(null);
  const [globeReady, setGlobeReady] = useState(false);
  const [diving, setDiving] = useState(false);
  const [mountGlobe, setMountGlobe] = useState(false);
  const globe = useGlobeLayout();

  // Mount the WebGL globe after first paint (the poster covers until its first frame).
  useEffect(() => {
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) idle(() => setMountGlobe(true), { timeout: 600 });
    else window.setTimeout(() => setMountGlobe(true), 200);
  }, []);

  // The globe recedes as the page scrolls past the hero (GSAP ScrollTrigger, §5.4).
  useEffect(() => {
    if (reduce) return;
    let kill: (() => void) | undefined;
    loadGsap().then(({ gsap }) => {
      if (!heroRef.current || !globeWrapRef.current) return;
      const tween = gsap.to(globeWrapRef.current, { opacity: 0.18, scale: 0.92, ease: 'none', scrollTrigger: { trigger: heroRef.current, start: 'top top', end: 'bottom top', scrub: 0.6 } });
      kill = () => {
        tween.scrollTrigger?.kill();
        tween.kill();
      };
    });
    return () => kill?.();
  }, [reduce]);

  const enter = async () => {
    if (diving) return;
    setDiving(true);
    if (reduce) return navigate('/explore');
    const { gsap } = await loadGsap();
    window.scrollTo({ top: 0, behavior: 'auto' });
    gsap.to(copyRef.current, { opacity: 0, y: -24, duration: 0.45, ease: 'power2.in' });
    // Land where the atlas frames the U.S.: centered between its dock and context panel.
    if (!globe.phone && globeWrapRef.current) {
      const free = (290 + (window.innerWidth - 290 - 380) / 2) / window.innerWidth;
      const box = globeWrapRef.current.getBoundingClientRect();
      gsap.to(globeWrapRef.current, { x: free * window.innerWidth - (box.left + box.width / 2), duration: DIVE_MS / 1000, ease: 'power2.inOut' });
    }
    await Promise.all([globeRef.current?.dive(DIVE_MS), new Promise((r) => setTimeout(r, DIVE_MS))]);
    navigate('/explore');
  };

  // ---------- figures, all from the index ----------
  const price = index.key_stats.find((k) => k.format === 'currency_compact' || k.format === 'currency');
  const rate = index.key_stats.find((k) => k.format === 'percent');
  const inv = index.national.latest.inventory;
  const metros = useMemo(() => atlasMetros(index), [index]);
  const registry = useMemo(() => buildRegistry(index.metric_registry), [index.metric_registry]);
  const columns = useMemo(() => {
    const css = getComputedStyle(document.documentElement);
    const g = (n: string) => parseChannels(css.getPropertyValue(`--mp-${n}`));
    const metric = index.metric_registry.find((r) => r.key === 'median_sale_price')!;
    return columnSet({ metros, metric, monthIndex: 0, isLatest: true, timeline: null, colorBy: 'yoy', heightBy: 'value', stops: { cool2: g('cool-2'), cool1: g('cool-1'), mid: g('mid'), hot1: g('hot-1'), hot2: g('hot-2') }, low: g('bg-2'), high: g('accent') }).columns;
    // Recolor when the theme flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metros, dark]);

  const heat: HeatBar[] = index.metros.map((m) => {
    const py = m.latest.median_sale_price && 'yoy' in m.latest.median_sale_price ? m.latest.median_sale_price.yoy : null;
    const iy = m.latest.inventory && 'yoy' in m.latest.inventory ? m.latest.inventory.yoy : null;
    return {
      slug: m.slug,
      name: m.name,
      short: m.name.replace(/, [A-Z-]+$/, ''),
      values: { temperature: m.temperature.score, price: py, inventory: iy },
      text: {
        temperature: m.temperature.score == null ? '—' : `${m.temperature.score} · ${m.temperature.label ?? ''}`.trim(),
        price: formatDelta(py, 'percent_signed'),
        inventory: formatDelta(iy, 'percent_signed'),
      },
      temperatureLabel: m.temperature.label,
    };
  });

  const nat = index.national;
  const rateEvents = detectRateEvents(nat.rates.dates, nat.rates.mortgage30, { minProminence: 0.3, window: 8 }).map((e) => ({ date: e.date, value: e.value, kind: e.kind, label: `${e.value.toFixed(2)}%` }));
  const brief = nat.brief;
  const sources = withAttribution(index.sources);
  const lastRun = manifest.status === 'ready' ? manifest.data.last_run_at : index.meta.finished_at;

  return (
    <>
      <h1 className="sr-only">Metro Pulse: the U.S. housing market, {formatMonth(index.data_through, true)}</h1>
      {/* ---------- hero ---------- */}
      <section ref={heroRef} aria-label="Overview" className="relative h-[100svh] min-h-[640px] overflow-hidden">
        <HeroBackdrop wrapRef={globeWrapRef} globeReady={globeReady} diving={diving}>
          {mountGlobe && (
            <Suspense fallback={null}>
              <Globe ref={globeRef} columns={columns} dark={dark} reducedMotion={reduce} paused={mediaPaused} zoom={globe.zoom} onFirstFrame={() => setGlobeReady(true)} />
            </Suspense>
          )}
        </HeroBackdrop>
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgb(var(--mp-bg))_0%,rgb(var(--mp-bg)/.75)_30%,transparent_58%)]" aria-hidden="true" />
        <span className="mp-grain" aria-hidden="true" />

        <div ref={copyRef} className="relative z-10 mx-auto flex h-full max-w-[1280px] flex-col justify-between px-4 pb-10 pt-28 sm:px-8 sm:pb-14 sm:pt-36">
          <div className="max-w-[640px]">
            <div className="mp-label text-mp-accent">The U.S. housing market · {formatMonth(index.data_through, true)}</div>
            <p className="mp-display mt-5 text-[40px] leading-[1.02] sm:text-[64px]">{index.headline}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button variant="primary" size="lg" onClick={enter} disabled={diving} data-testid="enter-market">
                Enter the market <ArrowRight size={16} strokeWidth={1.5} aria-hidden="true" />
              </Button>
              <Button size="lg" onClick={() => document.getElementById('brief')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' })}>
                Read the brief <ArrowDown size={16} strokeWidth={1.5} aria-hidden="true" />
              </Button>
            </div>
          </div>
          <dl className="grid max-w-[760px] grid-cols-3 gap-3 sm:gap-10" aria-label="Key national figures">
            <div>
              <dt className="mp-label text-[10px] sm:text-xs">U.S. median sale price</dt>
              <dd className="mp-num-hero mt-1 text-[22px] sm:mt-2 sm:text-[48px]">
                <Counter value={price?.value} format={(v) => formatValue(v, 'currency')} />
              </dd>
              <dd className="mp-num text-[11px] text-mp-ink-2 sm:text-[13px]">
                <span className={price?.delta && price.delta > 0 ? 'text-mp-hot-2' : 'text-mp-cool-2'}>{formatDelta(price?.delta, price?.delta_format ?? 'percent_signed')}</span> YoY
              </dd>
            </div>
            <div>
              <dt className="mp-label text-[10px] sm:text-xs">30-yr fixed rate</dt>
              <dd className="mp-num-hero mt-1 text-[22px] sm:mt-2 sm:text-[48px]">
                <Counter value={rate?.value} format={(v) => formatValue(v, 'percent', { scale: 'points' })} />
              </dd>
              <dd className="mp-num text-[11px] text-mp-ink-2 sm:text-[13px]">
                <span className={rate?.delta && rate.delta > 0 ? 'text-mp-hot-2' : 'text-mp-cool-2'}>{formatDelta(rate?.delta, 'pp_signed', { scale: 'points' })}</span> 1 wk
              </dd>
            </div>
            <div>
              <dt className="mp-label text-[10px] sm:text-xs">Active inventory</dt>
              <dd className="mp-num-hero mt-1 text-[22px] sm:mt-2 sm:text-[48px]">
                <Counter value={inv?.value} format={(v) => formatValue(v, 'count_signed_thousands').replace('+', '')} />
              </dd>
              <dd className="mp-num text-[11px] text-mp-ink-2 sm:text-[13px]">
                <span className={inv?.yoy && inv.yoy > 0 ? 'text-mp-hot-2' : 'text-mp-cool-2'}>{formatDelta(inv?.yoy, 'percent_signed')}</span> YoY
              </dd>
            </div>
          </dl>
        </div>
        <p className="absolute bottom-4 right-4 z-10 hidden max-w-[260px] text-right text-[11px] text-mp-ink-3 sm:block">
          50 metros as light columns: height is the median sale price from zero, color is the change from a year ago.
        </p>
      </section>

      {/* ---------- sections ---------- */}
      <Section id="brief" eyebrow="The national picture" title="What the numbers say" lede={`Data through ${formatMonth(index.data_through, true)}; 30-year rate as of ${formatDate(index.rates_as_of)}.`}>
        <BriefStory
          sentences={sentences(brief.text)}
          keyPoints={brief.key_points}
          citations={brief.citations.map((c) => ({ name: c.name, url: c.url }))}
          narratedBy={brief.narrative_source === 'llm' ? 'Narrated by Claude from facts computed in code; every figure is checked against them.' : 'Written from a template of the computed facts.'}
        />
      </Section>

      <Section id="heat" eyebrow="Market heat field" title="Fifty markets, one field" lede="Every tracked metro, ranked. Switch the ranking to see who's heating up, who's cutting prices and where supply is building.">
        <HeatField bars={heat} labels={{ temperature: 'Temperature', price: 'Price YoY', inventory: 'Inventory YoY' }} />
      </Section>

      <Section id="rates" eyebrow="Rates vs prices" title="The cost of money, the price of a home" lede="The 30-year fixed rate (weekly) and the U.S. median sale price (monthly), stacked on one time axis.">
        <RatesPrices
          rateDates={nat.rates.dates}
          rates={nat.rates.mortgage30}
          priceDates={nat.series.dates as string[]}
          prices={nat.series.median_sale_price as Array<number | null>}
          events={rateEvents}
          fmtRate={(v) => formatValue(v, 'percent', { scale: 'points' })}
          fmtPrice={(v) => formatValue(v, 'currency_compact')}
          fmtDate={(d) => formatMonth(d, true)}
        />
      </Section>

      <Section id="movers" eyebrow="Movers and alerts" title="Who moved most" lede="Median sale price change from a year ago. Select a metro to fly to it on the atlas.">
        <Podium
          gains={index.movers.price_gains.slice(0, 5).map((r) => ({ slug: r.slug, name: r.name, value: r.value, text: formatDelta(r.value, 'percent_signed') }))}
          declines={index.movers.price_declines.slice(0, 5).map((r) => ({ slug: r.slug, name: r.name, value: r.value, text: formatDelta(r.value, 'percent_signed') }))}
        />
        <AlertCards
          alerts={alertViews(index).map((a) => ({
            ...a,
            // Each metro's own figure when its label carries one ("Monthly payment +13% YoY" → "+13%").
            metros: a.metros.map((x) => ({ ...x, figure: x.label.match(/[+−-]?\d[\d.,]*%/)?.[0] ?? null })),
          }))}
        />
      </Section>

      <Section id="why" eyebrow="Why these markets are moving" title="The investigations" lede="When a metro moves sharply, an investigator agent pulls the numbers behind it and explains them. Numbers come from code; the agent only narrates.">
        <WhyMoving
          stories={investigationSummaryViews(index, registry).map((s) => ({ slug: s.slug, name: s.name, trigger: s.triggerLabel, text: s.text, cited: s.citedMetrics }))}
          empty="No metro crossed an investigation threshold in this run."
        />
      </Section>

      <footer className="border-t border-mp-line">
        <div className="mx-auto grid max-w-[1280px] gap-10 px-4 py-14 text-sm text-mp-ink-2 sm:px-8 md:grid-cols-[1fr_1fr]">
          <div>
            <div className="mp-label">Sources</div>
            <ul className="mt-3 space-y-2">
              {sources.map((s) => (
                <li key={s.name}>
                  {s.url ? (
                    <a href={s.url} className="text-mp-ink">
                      {s.name}
                    </a>
                  ) : (
                    <span className="text-mp-ink">{s.name}</span>
                  )}
                  {s.attribution && <span className="block text-xs text-mp-ink-3">{s.attribution}</span>}
                </li>
              ))}
              <li className="text-xs text-mp-ink-3">Basemap © OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors. Terrain: Mapzen Terrain Tiles on AWS.</li>
            </ul>
          </div>
          <div>
            <div className="mp-label">How this works</div>
            <p className="mt-3">Every number is computed in code from public data; the language model only narrates facts it is given, and its text is checked against them.</p>
            <p className="mt-3 text-xs text-mp-ink-3">
              Data through {formatMonth(index.data_through, true)} · last run {lastRun ? formatDateTime(lastRun) : '—'}
            </p>
            <Link to="/methodology" className="mt-4 inline-flex items-center gap-1.5 text-mp-accent no-underline hover:underline">
              Methodology <ArrowRight size={15} strokeWidth={1.5} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </footer>
    </>
  );
}
