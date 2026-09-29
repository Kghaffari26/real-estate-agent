/**
 * The compare arena (spec §7.5, M7): up to three metros on one stage (3D houses on
 * entity-colored plots, sized by price / U.S. median; the isometric SVG trio on the
 * low tier and as the first paint), up to two metrics as charts with one shared
 * crosshair, and the side-by-side table with leaders. URL: `?m=a,b,c&metrics=x,y&
 * range=1Y|3Y|All&indexed=1` (v1's links keep working; v1's 5Y reads as All).
 */
import { ChevronsUp, Crown, Map as MapIcon, Share2, X } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fmtMetric } from '../atlas/format';
import { MultiChart } from '../compare/MultiChart';
import { MetroSearch } from '../components/ui/MetroSearch';
import { isValidSlug, loadTimeline } from '../data/api';
import { useIndex, useMetros } from '../data/hooks';
import type { IndexOutput, MetricRegistryEntry, MetroDetailOutput } from '../data/schema.gen';
import { useResource } from '../data/useResource';
import { HouseSvg } from '../dossier/HouseSvg';
import { useEntityColors } from '../hooks/EntityColors';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useIsDark, usePrefersReducedMotion } from '../hooks/useMediaQuery';
import { useQuality } from '../hooks/useQuality';
import { useQueryList, useSetQuery } from '../hooks/useQueryState';
import { useToast } from '../hooks/Toast';
import { copyText } from '../lib/clipboard';
import { parseChannels } from '../lib/columns';
import { houseScale } from '../lib/dossier';
import { formatMonth, formatValue } from '../lib/format';
import { buildRegistry, metricLabel } from '../lib/metrics';
import { CATEGORICAL } from '../lib/tokens';
import { hasWebGL } from '../lib/webgl';
import { AtlasChrome } from '../ui/AtlasChrome';
import { metroPath, useMediaPaused } from '../ui/atlasState';
import { Button, Chip, Segmented, Toggle } from '../ui/controls';
import { GlassPanel } from '../ui/Glass';
import { arenaSeries, comparableMetrics, compareTable, MAX_COMPARE } from '../viewmodels/compare';
import type { ChartRange } from '../viewmodels/dossier';

const Arena3D = lazy(() => import('../compare/Arena3D'));
const RANGES: ChartRange[] = ['1Y', '3Y', 'All'];
const MAX_METRICS = 2;
const shortName = (name: string) => name.replace(/,\s*[A-Z]{2}(-[A-Z]{2})*$/, '');

/** The entity color of a metro: its session slot (shared with the rest of the app) as an --mp-e token. */
function useSlotOf() {
  const colors = useEntityColors();
  return (slug: string) => Math.max(0, CATEGORICAL.indexOf(colors.colorFor(slug))) % MAX_COMPARE;
}
const cssColor = (slot: number) => `rgb(var(--mp-e${slot + 1}))`;

export function CompareArenaPage() {
  useDocumentTitle('Compare');
  const index = useIndex();
  const [rawSlugs, setSlugs] = useQueryList('m', MAX_COMPARE);
  const slugs = rawSlugs.filter(isValidSlug);
  const metros = useMetros(slugs);
  const colors = useEntityColors();
  const slotOf = useSlotOf();
  const toast = useToast();
  const key = slugs.join(',');
  useEffect(() => colors.sync(slugs), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const loaded = metros.status === 'ready' ? metros.data.filter((r) => r.ok).map((r) => (r as { data: MetroDetailOutput }).data) : [];
  const failed = metros.status === 'ready' ? metros.data.filter((r) => !r.ok).map((r) => r.slug) : [];
  const nameOf = (slug: string) => (index.status === 'ready' ? index.data.metros.find((m) => m.slug === slug)?.name : null) ?? slug;
  const share = async () => toast((await copyText(window.location.href)) ? 'Link to this comparison copied' : "Couldn't copy the link");

  const picker = (
    <div className="flex flex-wrap items-center gap-3">
      {slugs.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Metros being compared">
          {slugs.map((slug) => (
            <li key={slug} className="inline-flex h-9 items-center gap-2 rounded-full border border-mp-line pl-3 pr-1 text-sm">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: cssColor(slotOf(slug)) }} aria-hidden="true" />
              <Link to={metroPath(slug)} className="text-mp-ink no-underline hover:underline">
                {nameOf(slug)}
              </Link>
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-mp-ink-3 hover:bg-mp-ink/10 hover:text-mp-ink"
                aria-label={`Remove ${nameOf(slug)}`}
                onClick={() => setSlugs(slugs.filter((s) => s !== slug))}
              >
                <X aria-hidden="true" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {index.status === 'ready' && slugs.length < MAX_COMPARE ? (
        <div className="w-full sm:w-72">
          <MetroSearch
            tone="atlas"
            items={index.data.metros.map((m) => ({
              slug: m.slug,
              name: m.name,
            }))}
            exclude={slugs}
            onSelect={(s) => setSlugs([...slugs, s])}
            label="Add a metro to compare"
            placeholder="Add a metro…"
          />
        </div>
      ) : slugs.length >= MAX_COMPARE ? (
        <p className="text-sm text-mp-ink-3">Maximum {MAX_COMPARE}: remove one to add another.</p>
      ) : null}
      <Link
        to={`/explore${slugs.length ? `?sel=${slugs.join(',')}` : ''}`}
        className="inline-flex h-9 items-center gap-2 rounded-control border border-mp-line px-3 text-sm text-mp-ink-2 no-underline hover:text-mp-ink"
      >
        <MapIcon size={15} strokeWidth={1.5} aria-hidden="true" /> Add from map
      </Link>
      {failed.length > 0 && (
        <p role="alert" className="w-full text-sm text-mp-bad">
          Couldn’t load: {failed.join(', ')}
        </p>
      )}
    </div>
  );

  return (
    <AtlasChrome onShare={slugs.length ? share : undefined}>
      <div className="mx-auto max-w-[1360px] px-4 pb-20 pt-6 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mp-label">Compare</div>
            <h1 className="mp-display mt-2 text-[40px] leading-[1] sm:text-[56px]">{loaded.length ? loaded.map((m) => shortName(m.name)).join(' · ') : 'Compare metros'}</h1>
          </div>
          {slugs.length > 0 && (
            <Button variant="quiet" onClick={share} icon={<Share2 size={15} strokeWidth={1.5} aria-hidden="true" />}>
              Share
            </Button>
          )}
        </div>
        <div className="mt-5">{picker}</div>

        {index.status === 'error' ? (
          <Notice title="The index didn’t load." />
        ) : slugs.length === 0 ? (
          <GlassPanel as="section" className="mt-8 grid place-items-center px-6 py-16 text-center">
            <div>
              <h2 className="mp-display text-[34px]">Pick metros to compare</h2>
              <p className="mx-auto mt-2 max-w-md text-mp-ink-2">
                Add up to {MAX_COMPARE} metros above, choose them on the map, or start from any dossier’s “Compare” button. Each keeps its color everywhere in the app.
              </p>
            </div>
          </GlassPanel>
        ) : index.status === 'loading' || metros.status === 'loading' ? (
          <Notice title="Loading the arena…" />
        ) : metros.status === 'error' ? (
          <Notice title="The metros didn’t load." />
        ) : loaded.length === 0 ? (
          <Notice title="None of the selected metros could be loaded." />
        ) : (
          <Arena index={index.data} metros={loaded} />
        )}
      </div>
    </AtlasChrome>
  );
}

function Notice({ title }: { title: string }) {
  return (
    <div className="grid min-h-[40vh] place-items-center text-center" role="status">
      <p className="mp-display text-[30px]">{title}</p>
    </div>
  );
}

function Arena({ index, metros }: { index: IndexOutput; metros: MetroDetailOutput[] }) {
  const [params] = useSearchParams();
  const setQuery = useSetQuery();
  const dark = useIsDark();
  const reduce = usePrefersReducedMotion();
  const [mediaPaused] = useMediaPaused();
  const slotOf = useSlotOf();
  const registry = useMemo(() => buildRegistry(index.metric_registry), [index]);

  // ---------- the stage ----------
  const usMedian = index.national.latest.median_sale_price?.value ?? null;
  const houses = metros.map((m) => ({
    m,
    slot: slotOf(m.slug),
    price: m.latest.median_sale_price?.value ?? null,
    scale: houseScale(m.latest.median_sale_price?.value, usMedian),
  }));
  const rgbs = useMemo(() => {
    const css = getComputedStyle(document.documentElement);
    return [0, 1, 2].map((i) => parseChannels(css.getPropertyValue(`--mp-e${i + 1}`)));
    // The tokens change with the theme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  // ---------- charts ----------
  const available = comparableMetrics(metros, registry);
  const [metricList, setMetricList] = useQueryList('metrics');
  const chosen = metricList.filter((k) => available.includes(k)).slice(0, MAX_METRICS);
  const metrics = chosen.length ? chosen : available.slice(0, 1);
  const rawRange = params.get('range');
  const range: ChartRange = rawRange === '5Y' ? 'All' : RANGES.includes(rawRange as ChartRange) ? (rawRange as ChartRange) : '3Y';
  const indexed = params.get('indexed') === '1';
  const [at, setAt] = useState<string | null>(null);
  const toggleMetric = (k: string) => {
    const on = metrics.includes(k);
    const next = on ? metrics.filter((x) => x !== k) : [...metrics, k].slice(-MAX_METRICS);
    setMetricList(available.filter((x) => next.includes(x)));
  };

  const table = compareTable(metros, registry);

  return (
    <>
      {/* ---------- the arena ---------- */}
      <section aria-labelledby="stage-h" className="mt-8">
        <h2 id="stage-h" className="sr-only">
          The houses
        </h2>
        <Stage
          houses={houses.map((h) => ({
            slug: h.m.slug,
            scale: h.scale,
            color: rgbs[h.slot] as [number, number, number],
            css: cssColor(h.slot),
          }))}
          dark={dark}
          animate={!reduce && !mediaPaused}
        />
        <ul
          className="grid gap-3 sm:gap-4"
          style={{
            gridTemplateColumns: `repeat(${houses.length}, minmax(0, 1fr))`,
          }}
          data-testid="arena-legend"
        >
          {houses.map((h) => (
            <li key={h.m.slug} className="border-t-2 pt-3 text-center" style={{ borderColor: cssColor(h.slot) }}>
              <Link to={metroPath(h.m.slug)} className="mp-display text-[19px] text-mp-ink no-underline hover:underline sm:text-[24px]">
                {shortName(h.m.name)}
              </Link>
              <p className="mp-num mt-1 text-xs text-mp-ink-2 sm:text-sm">
                {formatValue(h.price, 'currency')} <span className="block sm:inline">· house {h.scale.toFixed(2)}×</span>
              </p>
              <p className="text-xs text-mp-ink-3">{h.m.temperature.score != null ? `Temperature ${h.m.temperature.score} · ${h.m.temperature.label ?? '—'}` : 'No temperature this month'}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-center text-xs text-mp-ink-3">Each house is its median sale price ÷ the U.S. median ({formatValue(usMedian, 'currency')}), clamped 0.6–1.6×.</p>
      </section>

      {/* ---------- charts ---------- */}
      <GlassPanel as="section" aria-labelledby="charts-h" className="mt-10 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 id="charts-h" className="mp-label">
            Over time · crosshairs linked
          </h2>
          <div className="flex flex-wrap items-center gap-4">
            <Segmented label="Range" size="sm" value={range} onChange={(v) => setQuery({ range: v === '3Y' ? null : v })} options={RANGES.map((r) => ({ value: r, label: r }))} />
            <Toggle label="Index to 100" checked={indexed} onChange={(v) => setQuery({ indexed: v ? '1' : null })} hint="First month in range = 100" />
          </div>
        </div>
        <fieldset className="mt-4">
          <legend className="mp-label mb-2">Metrics (up to {MAX_METRICS})</legend>
          <div className="flex flex-wrap gap-2">
            {available.map((k) => (
              <Chip key={k} selected={metrics.includes(k)} onClick={() => toggleMetric(k)}>
                {metricLabel(registry, k)}
              </Chip>
            ))}
          </div>
        </fieldset>
        <div className="mt-6 space-y-10">
          {metrics.map((k) => (
            <ArenaChart
              key={k}
              index={index}
              metros={metros}
              metric={registry.get(k) as MetricRegistryEntry}
              label={metricLabel(registry, k)}
              range={range}
              indexed={indexed}
              at={at}
              onAt={setAt}
              slotOf={slotOf}
            />
          ))}
        </div>
      </GlassPanel>

      {/* ---------- the diff table ---------- */}
      <GlassPanel as="section" aria-labelledby="table-h" className="mt-10 p-5 sm:p-6">
        <h2 id="table-h" className="mp-label">
          Side by side · latest month
        </h2>
        <p className="mt-1 text-xs text-mp-ink-3">Crown: best where a direction is better (more homes sold, lower payment…). Arrows: simply the highest.</p>
        <div className="relative mt-4 overflow-x-auto" tabIndex={0} role="region" aria-label="Side-by-side comparison table">
          <table className="w-full min-w-max border-collapse text-sm" data-testid="compare-table">
            <caption className="sr-only">Latest values and year-over-year changes for each compared metro, with the leader per metric marked</caption>
            <thead>
              <tr className="border-b border-mp-line">
                <th scope="col" className="py-2 pr-4 text-left font-normal text-mp-ink-3">
                  Metric
                </th>
                {metros.map((m) => (
                  <th key={m.slug} scope="col" className="px-3 py-2 text-right font-medium text-mp-ink">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: cssColor(slotOf(m.slug)) }} aria-hidden="true" />
                      {shortName(m.name)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.map((row) => (
                <tr key={row.key} className="border-b border-mp-line/60">
                  <th scope="row" className="py-2 pr-4 text-left font-normal text-mp-ink-2">
                    {row.label}
                  </th>
                  {row.cells.map((cell, i) => {
                    const lead = row.leader === i;
                    return (
                      <td key={metros[i]!.slug} data-leader={lead || undefined} className={`px-3 py-2 text-right ${lead ? 'bg-mp-accent/10' : ''}`}>
                        <span className="mp-num inline-flex items-center gap-1 text-mp-ink">
                          {lead && (
                            <>
                              {row.leaderLabel === 'Highest' ? (
                                <ChevronsUp aria-hidden="true" size={12} className="text-mp-accent" />
                              ) : (
                                <Crown aria-hidden="true" size={12} className="text-mp-accent" />
                              )}
                              <span className="sr-only">{row.leaderLabel}: </span>
                            </>
                          )}
                          {cell.value}
                        </span>
                        {cell.yoy && <span className="mp-num block text-[11px] text-mp-ink-3">{cell.yoy} YoY</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassPanel>
    </>
  );
}

interface StageHouse {
  slug: string;
  scale: number;
  color: [number, number, number];
  css: string;
}

/** 3D when WebGL allows (lazy); the isometric SVG trio paints first and stays as the fallback. */
function Stage({ houses, dark, animate }: { houses: StageHouse[]; dark: boolean; animate: boolean }) {
  const quality = useQuality();
  const webgl = useMemo(() => quality.webgl && hasWebGL(), [quality.webgl]);
  const [ready, setReady] = useState(false);
  return (
    <div className="relative h-[300px] sm:h-[420px]" data-arena-mode={webgl ? '3d' : '2d'}>
      <div
        className={`absolute inset-0 grid transition-opacity duration-500 ${ready ? 'opacity-0' : 'opacity-100'}`}
        style={{
          gridTemplateColumns: `repeat(${houses.length}, minmax(0, 1fr))`,
        }}
      >
        {houses.map((h) => (
          <HouseSvg key={h.slug} scale={h.scale * 0.8} rim={h.color} lean={0} dark={dark} className="h-full w-full" />
        ))}
      </div>
      {webgl && (
        <Suspense fallback={null}>
          <div className={`absolute inset-0 transition-opacity duration-500 ${ready ? 'opacity-100' : 'opacity-0'}`}>
            <Arena3D houses={houses} dark={dark} animate={animate} dpr={quality.dpr} onReady={() => setReady(true)} />
          </div>
        </Suspense>
      )}
    </div>
  );
}

interface ArenaChartProps {
  index: IndexOutput;
  metros: MetroDetailOutput[];
  metric: MetricRegistryEntry;
  label: string;
  range: ChartRange;
  indexed: boolean;
  at: string | null;
  onAt: (d: string | null) => void;
  slotOf: (slug: string) => number;
}

function ArenaChart({ index, metros, metric, label, range, indexed, at, onAt, slotOf }: ArenaChartProps) {
  // "All" reaches back to 2012 when the metric has a published timeline (§6.4).
  const ref = index.timelines.find((t) => t.metric === metric.key);
  const slugs = useMemo(() => index.metros.map((x) => x.slug), [index.metros]);
  const wantTimeline = range === 'All' && !!ref;
  const timeline = useResource(wantTimeline ? `timeline:${metric.key}:true` : 'timeline:none', () => (wantTimeline ? loadTimeline(metric.key, slugs, { compact: true }) : Promise.resolve(null)));
  const s = arenaSeries(metros, metric, range, indexed, timeline.status === 'ready' ? timeline.data : null);
  const fmt = (v: number | null | undefined) => (indexed ? (v == null ? '—' : v.toFixed(1)) : fmtMetric(metric, v));
  return (
    <div data-testid={`arena-chart-${metric.key}`}>
      <MultiChart
        title={indexed ? `${label}, indexed` : label}
        dates={s.dates}
        lines={s.lines.map((l) => ({
          ...l,
          name: metros.find((m) => m.slug === l.slug)!.name,
          color: cssColor(slotOf(l.slug)),
        }))}
        fmt={fmt}
        fmtDate={(d) => formatMonth(d, true)}
        at={at}
        onAt={onAt}
      />
      <p className="mt-1 text-[11px] text-mp-ink-3">
        {s.span === 'timeline'
          ? `Monthly since ${formatMonth(s.dates[0], true)} (§6.4 timeline).`
          : range === 'All' && !ref
            ? 'This metric’s published history is the last 36 months.'
            : 'Redfin, monthly.'}
      </p>
    </div>
  );
}
