/**
 * /explore — the atlas (spec §7.2: M2 the pull, M3 area search, M4 time machine).
 * URL is the source of truth for everything shareable: metric, month, layer style,
 * color, buildings, terrain, pin + radius, selection, camera and table view.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Atlas, type AtlasMapHandle, type HoverInfo } from '../atlas';
import { AreaPanel, IdlePanel, MetroPanel } from '../atlas/ContextPanel';
import { AtlasTable, BottomSheet, Dialog, HoverCard, ShortcutList, type TableRow } from '../atlas/bits';
import { fmtChange, fmtMetric } from '../atlas/format';
import { LayerDockBody } from '../atlas/LayerDock';
import { loadTimeline } from '../data/api';
import { useIndex } from '../data/hooks';
import type { IndexOutput } from '../data/schema.gen';
import { useResource } from '../data/useResource';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useIsDark, useIsMobile, usePrefersReducedMotion } from '../hooks/useMediaQuery';
import { useSetQuery } from '../hooks/useQueryState';
import { useToast } from '../hooks/Toast';
import { areaSearch, formatPin, milesBetween, parsePin, parseRadius, ringPolygon } from '../lib/area';
import { copyText } from '../lib/clipboard';
import { parseChannels, type DivergingStops, type RGB } from '../lib/columns';
import { detectRateEvents } from '../lib/events';
import { formatMonth, formatValue } from '../lib/format';
import { monthIndex } from '../lib/timeline';
import { TICK_MS, timeStore, useTime } from '../state/timeStore';
import { AtlasChrome } from '../ui/AtlasChrome';
import { Dock } from '../ui/Dock';
import { GlassPanel } from '../ui/Glass';
import { Scrubber } from '../ui/Scrubber';
import {
  areaMetros,
  atlasMetrics,
  atlasMetros,
  COLOR_BY,
  columnSet,
  DEFAULT_CAMERA,
  formatCamera,
  LAYER_STYLES,
  MOBILE_CAMERA,
  parseCamera,
  type AtlasMetro,
  type Camera,
  type ColorBy,
  type LayerStyle,
} from '../viewmodels/atlas';

/** A zoom that fits a ring of `radiusMi` in roughly 480 px (tilted view). */
const zoomForRadius = (radiusMi: number) => Math.max(3.5, Math.min(10, Math.log2(17_897 / radiusMi) - 0.6));

function readStops(): { stops: DivergingStops; low: RGB; high: RGB } {
  const css = getComputedStyle(document.documentElement);
  const g = (n: string) => parseChannels(css.getPropertyValue(`--mp-${n}`));
  const ink = g('ink');
  const bg = g('bg');
  return {
    stops: { cool2: g('cool-2'), cool1: g('cool-1'), mid: g('mid'), hot1: g('hot-1'), hot2: g('hot-2') },
    low: [0, 1, 2].map((k) => Math.round(bg[k]! + (ink[k]! - bg[k]!) * 0.22)) as RGB,
    high: g('accent'),
  };
}

const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) && (el as HTMLInputElement).type !== 'range' && (el as HTMLInputElement).type !== 'radio';

export function ExplorePage() {
  useDocumentTitle('Atlas');
  const index = useIndex();
  return <AtlasChrome overlay>{index.status === 'ready' ? <Explore index={index.data} /> : <AtlasStatus error={index.status === 'error'} retry={index.retry} />}</AtlasChrome>;
}

function AtlasStatus({ error, retry }: { error: boolean; retry: () => void }) {
  return (
    <div className="grid min-h-screen place-items-center px-6 text-center" role="status">
      <div>
        <p className="mp-display text-[34px]">{error ? 'The atlas could not load its data.' : 'Loading the atlas…'}</p>
        {error && (
          <button type="button" onClick={retry} className="mt-4 rounded-control border border-mp-line px-4 py-2 text-sm">
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

function Explore({ index }: { index: IndexOutput }) {
  const [params] = useSearchParams();
  const setQuery = useSetQuery();
  const navigate = useNavigate();
  const toast = useToast();
  const dark = useIsDark();
  const mobile = useIsMobile();
  const reducedMotion = usePrefersReducedMotion();
  const mapRef = useRef<AtlasMapHandle>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // ---------- data ----------
  const metros = useMemo(() => atlasMetros(index), [index]);
  const bySlug = useMemo(() => new Map(metros.map((m) => [m.slug, m])), [metros]);
  const metrics = useMemo(() => atlasMetrics(index.metric_registry, metros), [index.metric_registry, metros]);
  const dates = index.national.series.dates as string[];

  // ---------- URL state ----------
  const metricKey = metrics.some((m) => m.key === params.get('m')) ? params.get('m')! : 'median_sale_price';
  const metric = metrics.find((m) => m.key === metricKey) ?? metrics[0]!;
  const style = (LAYER_STYLES as readonly string[]).includes(params.get('style') ?? '') ? (params.get('style') as LayerStyle) : 'columns';
  const colorBy = (COLOR_BY as readonly string[]).includes(params.get('by') ?? '') ? (params.get('by') as ColorBy) : 'yoy';
  const buildings = params.get('b') !== '0';
  const terrain = !mobile && params.get('terrain') === '1';
  const pin = parsePin(params.get('pin'));
  const radius = parseRadius(params.get('r'));
  const selected = (params.get('sel') ?? '').split(',').filter((s) => bySlug.has(s)).slice(0, 12);
  const table = params.get('view') === 'table';
  const tier = params.get('tier') === 'low' ? 'low' : 'high';
  // The default view fits the U.S. into the space between the panels at any desktop width.
  const [initialCamera] = useState<Camera>(() => {
    const saved = parseCamera(params.get('cam'));
    if (saved) return saved;
    if (mobile) return MOBILE_CAMERA;
    const free = Math.max(480, window.innerWidth - 290 - 380);
    return { ...DEFAULT_CAMERA, zoom: DEFAULT_CAMERA.zoom + Math.log2(free / 770) };
  });

  // ---------- time ----------
  const time = useTime((s) => s.index);
  const playing = useTime((s) => s.playing);
  const speed = useTime((s) => s.speed);
  useEffect(() => {
    timeStore.getState().setCount(dates.length, monthIndex(dates, params.get('t')));
    return () => timeStore.getState().setPlaying(false);
    // Initialize once per axis; later URL changes come from this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates.length]);
  const last = dates.length - 1;
  const isLatest = time >= last;
  // Playback advances the store; the URL catches up once playback stops.
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => timeStore.getState().step(1, true), TICK_MS[speed]);
    return () => window.clearInterval(id);
  }, [playing, speed]);
  useEffect(() => {
    if (playing) return;
    const t = window.setTimeout(() => setQuery({ t: time >= last ? null : dates[time]!.slice(0, 7) }), 250);
    return () => window.clearTimeout(t);
  }, [time, playing, last, dates, setQuery]);

  // History loads only once someone leaves the latest month.
  const count = useTime((s) => s.count);
  const [wantHistory, setWantHistory] = useState(false);
  useEffect(() => {
    if (count > 0 && (!isLatest || playing)) setWantHistory(true);
  }, [count, isLatest, playing]);
  const slugs = useMemo(() => metros.map((m) => m.slug), [metros]);
  const history = useResource(wantHistory ? `timeline:${metric.key}` : 'timeline:none', () => (wantHistory ? loadTimeline(metric.key, slugs) : Promise.resolve(null)));
  const timeline = history.status === 'ready' ? history.data : null;
  const historyPending = wantHistory && history.status === 'loading';

  // ---------- columns ----------
  const palette = useMemo(readStops, [dark]);
  const set = useMemo(
    () => columnSet({ metros, metric, monthIndex: time, isLatest: isLatest || !timeline, timeline, colorBy, ...palette }),
    [metros, metric, time, isLatest, timeline, colorBy, palette],
  );
  const valuesBySlug = useMemo(() => Object.fromEntries(set.columns.map((c) => [c.slug, { value: c.value, change: c.change }])), [set]);
  const shownMonth = isLatest || !timeline ? last : time;
  const monthLabel = formatMonth(dates[shownMonth], true);

  // ---------- area ----------
  const area = useMemo(() => (pin ? areaSearch(pin, radius, areaMetros(metros)) : null), [pin?.lat, pin?.lon, radius, metros]); // eslint-disable-line react-hooks/exhaustive-deps
  const ring = useMemo(() => (pin ? ringPolygon(pin, radius) : null), [pin?.lat, pin?.lon, radius]); // eslint-disable-line react-hooks/exhaustive-deps
  const pinLabel = useMemo(() => {
    if (!pin) return '';
    // Metros that share a centroid (Redfin divisions) tie on distance: prefer the city over a
    // "… County" division, then the larger market.
    const near = metros
      .map((m) => ({ m, d: milesBetween(pin, { lat: m.trueLat, lon: m.trueLon }) }))
      .sort((a, b) => a.d - b.d || Number(/ County,/.test(a.m.name)) - Number(/ County,/.test(b.m.name)) || (b.m.homesSold12m ?? 0) - (a.m.homesSold12m ?? 0))[0];
    if (near && near.d <= 20) return near.m.name;
    return `${Math.abs(pin.lat).toFixed(2)}°${pin.lat >= 0 ? 'N' : 'S'}, ${Math.abs(pin.lon).toFixed(2)}°${pin.lon >= 0 ? 'E' : 'W'}`;
  }, [pin, metros]);

  // ---------- actions ----------
  const select = useCallback((slugsNext: string[]) => setQuery({ sel: slugsNext.length ? slugsNext.join(',') : null }), [setQuery]);
  const flyToMetro = useCallback((m: AtlasMetro) => mapRef.current?.flyTo(m.lon, m.lat), []);
  const dropPin = useCallback((lat: number, lon: number, r?: number) => setQuery({ pin: formatPin({ lat, lon }), r: r ? String(r) : params.get('r'), sel: null }), [setQuery, params]);
  const clearAll = useCallback(() => setQuery({ pin: null, r: null, sel: null }), [setQuery]);
  const share = useCallback(async () => {
    const ok = await copyText(window.location.href);
    toast(ok ? 'Link to this view copied' : "Couldn't copy the link");
  }, [toast]);

  // A new pin flies the camera to its ring (not on radius changes, not on first load with a saved camera).
  const [mapReady, setMapReady] = useState(false);
  const pinKey = pin ? formatPin(pin) : '';
  const hadCamera = useRef(Boolean(params.get('cam')));
  useEffect(() => {
    if (!mapReady || !pin) return;
    if (hadCamera.current) {
      hadCamera.current = false;
      return;
    }
    mapRef.current?.flyTo(pin.lon, pin.lat, zoomForRadius(radius));
    // Radius changes resize the ring in place; only a new pin moves the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, pinKey]);

  // A growing ring never outgrows the view: ease out (never in) as the radius increases.
  useEffect(() => {
    if (mapReady && pin) mapRef.current?.zoomOutTo(zoomForRadius(radius));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radius]);

  // ---------- hover ----------
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [bounds, setBounds] = useState({ w: 1440, h: 900 });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBounds({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---------- keyboard (§7.2) ----------
  const [shortcuts, setShortcuts] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || shortcuts) return;
      const map = mapRef.current;
      const step = e.shiftKey ? 240 : 100;
      const k = e.key;
      const onRange = e.target instanceof HTMLInputElement && e.target.type === 'range';
      if (!onRange && k.startsWith('Arrow') && map) {
        e.preventDefault();
        map.panBy(k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0, k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0);
      } else if ((k === '+' || k === '=') && map) map.zoomBy(0.6);
      else if ((k === '-' || k === '_') && map) map.zoomBy(-0.6);
      else if (k === '[' && map) map.rotateBy(-15);
      else if (k === ']' && map) map.rotateBy(15);
      else if (k === ',') timeStore.getState().step(-1);
      else if (k === '.') timeStore.getState().step(1);
      else if (k === 't' || k === 'T') setQuery({ view: table ? null : 'table' });
      else if (k === '?') setShortcuts(true);
      else if (k === 'Escape') clearAll();
      else if (k === ' ' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        timeStore.getState().togglePlaying();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [table, setQuery, clearAll, shortcuts]);

  // ---------- rate moments on the rail ----------
  const events = useMemo(() => {
    const monthOf = (d: string) => dates.findIndex((x) => x.slice(0, 7) === d.slice(0, 7));
    const found = detectRateEvents(index.national.rates.dates, index.national.rates.mortgage30, { minProminence: 0.3, window: 8 })
      .map((e) => ({ ...e, month: monthOf(e.date) }))
      .filter((e) => e.month >= 0);
    const top = (kind: 'high' | 'low') => found.filter((e) => e.kind === kind).sort((a, b) => b.prominence - a.prominence)[0];
    const featured = new Set([top('high'), top('low')]);
    return found.map((e) => ({ index: e.month, kind: e.kind, label: `30-yr ${e.kind} ${e.value.toFixed(2)}% · ${formatMonth(e.date)}`, showLabel: featured.has(e) }));
  }, [dates, index.national.rates]);

  // ---------- announcements ----------
  const focusMetro = selected.length === 1 ? bySlug.get(selected[0]!) : null;
  const national = index.national.series[metric.key] as Array<number | null> | undefined;
  const announcement = focusMetro
    ? `${monthLabel}: ${focusMetro.name} ${metric.label.toLowerCase()} ${fmtMetric(metric, valuesBySlug[focusMetro.slug]?.value)}, ${fmtChange(metric, valuesBySlug[focusMetro.slug]?.change)} YoY`
    : national
      ? `${formatMonth(dates[time], true)}: U.S. ${metric.label.toLowerCase()} ${fmtMetric(metric, national[time])}`
      : formatMonth(dates[time], true);

  // ---------- table rows ----------
  const inArea = area ? new Map(area.metros.map((m) => [m.slug, m.miles])) : null;
  const rows: TableRow[] = metros
    .filter((m) => !inArea || inArea.has(m.slug))
    .map((m) => ({
      slug: m.slug,
      name: m.name,
      value: valuesBySlug[m.slug]?.value ?? null,
      change: valuesBySlug[m.slug]?.change ?? null,
      temperature: m.temperature,
      temperatureLabel: m.temperatureLabel,
      miles: inArea?.get(m.slug) ?? null,
    }));

  const noYoy = colorBy === 'yoy' && !isLatest && timeline != null && time < 12;
  const legend = {
    note: noYoy ? `No year-ago value before ${formatMonth(dates[12], true)}: the history starts ${formatMonth(dates[0], true)}.` : null,
    min: fmtChange(metric, -set.bound),
    max: fmtChange(metric, set.bound),
    heightMin: fmtMetric(metric, set.extent?.min),
    heightMax: fmtMetric(metric, set.extent?.max),
  };

  const dock = (
    <LayerDockBody
      metrics={metrics}
      metric={metric.key}
      onMetric={(m) => setQuery({ m: m === 'median_sale_price' ? null : m })}
      style={style}
      onStyle={(s) => setQuery({ style: s === 'columns' ? null : s })}
      colorBy={colorBy}
      onColorBy={(c) => setQuery({ by: c === 'yoy' ? null : c })}
      buildings={buildings}
      onBuildings={(v) => setQuery({ b: v ? null : '0' })}
      terrain={terrain}
      onTerrain={(v) => setQuery({ terrain: v ? '1' : null })}
      canTerrain={!mobile && tier === 'high'}
      legend={legend}
      onTable={() => setQuery({ view: table ? null : 'table' })}
      onShortcuts={() => setShortcuts(true)}
    />
  );

  const selectedMetros = selected.map((s) => bySlug.get(s)!).filter(Boolean);
  const context = area ? (
    <AreaPanel
      area={area}
      label={pinLabel}
      dataThrough={index.data_through}
      onRadius={(r) => setQuery({ r: String(Math.round(r)) })}
      onClear={clearAll}
      onShare={share}
      onSelect={(s) => {
        select([s]);
        const m = bySlug.get(s);
        if (m) flyToMetro(m);
      }}
    />
  ) : selectedMetros.length ? (
    <MetroPanel
      metros={selectedMetros}
      metric={metric}
      monthLabel={monthLabel}
      values={valuesBySlug}
      onClear={() => select([])}
      onFly={flyToMetro}
      onAround={(m) => dropPin(m.trueLat, m.trueLon, 50)}
    />
  ) : (
    <IdlePanel headline={index.headline} national={`${formatValue(index.key_stats[0]?.value, index.key_stats[0]?.format)} U.S. median · data through ${formatMonth(index.data_through, true)}`} />
  );

  const hoverMetro = hover ? bySlug.get(hover.slug) : null;

  const scrubber = (
    <Scrubber
      dates={dates}
      index={time}
      onChange={(i) => timeStore.getState().setIndex(i)}
      playing={playing}
      onPlayToggle={() => timeStore.getState().togglePlaying()}
      speed={speed}
      onSpeedChange={(s) => timeStore.getState().setSpeed(s)}
      events={events}
      formatDate={(d) => formatMonth(d, true)}
      announcement={announcement}
    />
  );

  return (
    <div ref={stageRef} className="relative h-[100svh] w-full overflow-hidden bg-mp-bg">
      <h1 className="sr-only">Atlas: {metric.label} across 50 U.S. metros</h1>
      <Atlas
        ref={mapRef}
        tier={tier}
        columns={set.columns}
        style={style}
        ring={ring}
        pin={pin}
        selected={selected}
        buildings={buildings}
        terrain={terrain}
        dark={dark}
        reducedMotion={reducedMotion}
        camera={initialCamera}
        bound={set.bound}
        padding={mobile ? { top: 70, bottom: 140, left: 10, right: 10 } : { top: 70, bottom: 150, left: 290, right: 380 }}
        label={`Map of ${metric.label.toLowerCase()} for 50 metros, ${monthLabel}. Use the table view (T) for the same data as a list.`}
        onModeChange={(mode) => setMapReady(mode === '3d')}
        onCamera={(c) => setQuery({ cam: formatCamera(c) })}
        onHover={setHover}
        onSelect={(s) => select([s])}
        onOpen={(s) => navigate(`/metro/${s}`)}
        onPickEmpty={(lat, lon) => dropPin(lat, lon)}
        onLasso={(s) => (s.length ? select(s) : undefined)}
      />
      <span className="mp-grain" aria-hidden="true" />

      {hoverMetro && hover && !table && (
        <HoverCard metro={hoverMetro} metric={metric} value={valuesBySlug[hoverMetro.slug]?.value ?? null} change={valuesBySlug[hoverMetro.slug]?.change ?? null} x={hover.x} y={hover.y} bounds={bounds} />
      )}

      {/* Big month, over the map: the time machine's hero. */}
      <div className={`pointer-events-none absolute z-10 ${mobile ? 'left-4 top-[72px]' : 'bottom-[132px] left-[292px]'}`} aria-hidden="true">
        <div className={`mp-display italic ${mobile ? 'text-[34px]' : 'text-[64px]'} leading-none text-mp-ink/90`}>{formatMonth(dates[time], true)}</div>
        {historyPending && <div className="mt-1 font-ui text-xs not-italic text-mp-ink-3">Loading metro history…</div>}
      </div>

      {mobile ? (
        <BottomSheetHost dock={dock} context={context} scrubber={scrubber} hasContext={Boolean(area || selectedMetros.length)} />
      ) : (
        <>
          <Dock title="Layers" className="absolute left-6 top-[76px] z-20 w-[248px]">
            {dock}
          </Dock>
          <GlassPanel as="aside" aria-label="Context" className="absolute right-6 top-[76px] z-20 max-h-[calc(100svh-100px)] w-[344px] overflow-y-auto p-5">
            {context}
          </GlassPanel>
          <GlassPanel className="absolute bottom-6 left-[292px] right-[392px] z-20 px-5 py-3">{scrubber}</GlassPanel>
        </>
      )}

      {table && (
        <div className={`absolute z-30 ${mobile ? 'inset-x-2 bottom-2 top-[68px]' : 'bottom-[132px] left-[292px] right-[392px] top-[76px]'}`}>
          <AtlasTable
            rows={rows}
            metric={metric}
            monthLabel={monthLabel}
            caption={area ? `${rows.length} metros within ${Math.round(radius)} mi of ${pinLabel}` : `All ${rows.length} metros`}
            selected={selected}
            onSelect={(s) => select([s])}
            onClose={() => setQuery({ view: null })}
          />
        </div>
      )}

      <Dialog title="Keyboard" open={shortcuts} onClose={() => setShortcuts(false)}>
        <ShortcutList />
      </Dialog>
    </div>
  );
}

function BottomSheetHost({ dock, context, scrubber, hasContext }: { dock: React.ReactNode; context: React.ReactNode; scrubber: React.ReactNode; hasContext: boolean }) {
  const [tab, setTab] = useState(hasContext ? 'context' : 'time');
  const [open, setOpen] = useState(hasContext);
  useEffect(() => {
    if (hasContext) {
      setTab('context');
      setOpen(true);
    }
  }, [hasContext]);
  return (
    <BottomSheet
      open={open}
      onToggle={() => setOpen((o) => !o)}
      active={tab}
      onTab={setTab}
      tabs={[
        { id: 'time', label: 'Time', body: scrubber },
        { id: 'layers', label: 'Layers', body: dock },
        { id: 'context', label: hasContext ? 'Selection' : 'About', body: context },
      ]}
    />
  );
}
