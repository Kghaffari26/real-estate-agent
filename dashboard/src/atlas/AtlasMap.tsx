/**
 * The atlas canvas: MapLibre (OpenFreeMap vector tiles, recolored to Night/Dawn,
 * optional 3D buildings and terrain) with deck.gl layers interleaved through
 * MapboxOverlay, so columns sit correctly among buildings. Lazy-loaded (its own
 * chunk) by ./index.tsx. Pure presentation: every value arrives preformatted/computed.
 */
import 'maplibre-gl/dist/maplibre-gl.css';
import { HexagonLayer } from '@deck.gl/aggregation-layers';
import { ColumnLayer, PathLayer, PolygonLayer, ScatterplotLayer } from '@deck.gl/layers';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { AttributionControl, Map as MLMap, setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { parseChannels, type RGB } from '../lib/columns';
import { CAMERA_FLIGHT } from '../motion/presets';
import { pointInPolygon, type Camera, type ColumnDatum, type LayerStyle } from '../viewmodels/atlas';

setWorkerUrl(workerUrl);

const STYLE_URL = { dark: 'https://tiles.openfreemap.org/styles/dark', light: 'https://tiles.openfreemap.org/styles/positron' };
const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const TERRAIN_ATTRIBUTION = 'Terrain: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Mapzen Terrain Tiles</a> on AWS (USGS, SRTM, GMTED2010 and others)';
const BASE_ATTRIBUTION = '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export interface HoverInfo {
  slug: string;
  x: number;
  y: number;
}

export interface AtlasMapHandle {
  panBy: (dx: number, dy: number) => void;
  zoomBy: (delta: number) => void;
  rotateBy: (degrees: number) => void;
  flyTo: (lon: number, lat: number, zoom?: number) => void;
  /** Zoom out (never in) so the view is at most `zoom`. */
  zoomOutTo: (zoom: number) => void;
  reset: (camera: Camera) => void;
  /** A PNG of the current view (map + columns), for the share menu. */
  snapshot: () => Promise<string | null>;
}

export interface AtlasMapProps {
  columns: readonly ColumnDatum[];
  style: LayerStyle;
  ring: Array<[number, number]> | null;
  pin: { lat: number; lon: number } | null;
  selected: readonly string[];
  buildings: boolean;
  terrain: boolean;
  dark: boolean;
  reducedMotion: boolean;
  camera: Camera;
  /** Heat layer color domain (±bound). */
  bound: number;
  label: string;
  /** Screen padding for the camera, so it centers in the space between the panels. */
  padding: { top: number; bottom: number; left: number; right: number };
  onCamera: (c: Camera) => void;
  onHover: (info: HoverInfo | null) => void;
  onSelect: (slug: string) => void;
  onOpen: (slug: string) => void;
  onPickEmpty: (lat: number, lon: number) => void;
  onLasso: (slugs: string[]) => void;
  onReady: () => void;
  onFail: (reason: string) => void;
}

// ---------- the basemap, recolored ----------
function tokens() {
  const css = getComputedStyle(document.documentElement);
  const rgb = (name: string) => parseChannels(css.getPropertyValue(`--mp-${name}`));
  return { bg: rgb('bg'), bg2: rgb('bg-2'), ink: rgb('ink'), ink3: rgb('ink-3'), accent: rgb('accent') };
}
const css = ([r, g, b]: RGB, a = 1) => (a === 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`);
const mixRgb = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((k) => Math.round(a[k]! + (b[k]! - a[k]!) * t)) as RGB;

type AnyLayer = StyleSpecification['layers'][number] & { paint?: Record<string, unknown>; layout?: Record<string, unknown> };

/** OpenFreeMap's style, restyled as the atlas's quiet canvas: the data is the hero. */
function atlasStyle(base: StyleSpecification, dark: boolean): StyleSpecification {
  const t = tokens();
  // Night: land lifts slightly off the canvas. Dawn: near-white land on blue-gray water.
  const land = dark ? mixRgb(t.bg, t.bg2, 0.9) : mixRgb(t.bg, [255, 255, 255], 0.7);
  const water = dark ? mixRgb(t.bg, [0, 0, 0], 0.35) : mixRgb(t.bg2, t.ink, 0.09);
  const line = dark ? [150, 180, 255] as RGB : [11, 16, 32] as RGB;
  const layers = (base.layers as AnyLayer[])
    .filter((l) => {
      if (l.type === 'fill-extrusion') return false;
      // Labels stay sparse: states and large cities (the stand-in style in tests has none).
      if (l.type === 'symbol') return /place_(state|city_large|city)$/.test(l.id);
      if (l.id === 'building') return false; // replaced by the extrusion layer
      return true;
    })
    .map((l): AnyLayer => {
      const paint = { ...(l.paint ?? {}) };
      if (l.type === 'background') paint['background-color'] = css(land);
      else if (l.type === 'fill' && /water/.test(l.id)) paint['fill-color'] = css(water);
      else if (l.type === 'fill' && /^land$|land(cover|use)/.test(l.id)) {
        paint['fill-color'] = /^land$/.test(l.id) ? css(land) : css(mixRgb(land, t.ink, dark ? 0.03 : 0.02));
        paint['fill-opacity'] = /^land$/.test(l.id) ? 1 : 0.6;
      } else if (l.type === 'fill') paint['fill-color'] = css(mixRgb(land, t.ink, 0.04));
      else if (l.type === 'line' && /water/.test(l.id)) paint['line-color'] = css(water);
      else if (l.type === 'line' && /boundary|border/.test(l.id)) {
        paint['line-color'] = css(t.accent, /state|border/.test(l.id) ? (dark ? 0.2 : 0.3) : dark ? 0.35 : 0.45);
      } else if (l.type === 'line') paint['line-color'] = css(line, dark ? 0.09 : 0.1);
      else if (l.type === 'raster') paint['raster-opacity'] = 0.08;
      else if (l.type === 'symbol') {
        // No labels at the national view: the columns are the picture. They return as you zoom in.
        (l as { minzoom?: number }).minzoom = l.id === 'place_city' ? 6 : l.id === 'place_city_large' ? 4.6 : 4.2;
        paint['text-color'] = css(t.ink3, 0.85);
        paint['text-halo-color'] = css(land, 0.9);
        paint['text-halo-width'] = 1.2;
      }
      return { ...l, paint } as AnyLayer;
    });
  return { ...base, layers: layers as StyleSpecification['layers'] };
}

const cache: Record<string, Promise<StyleSpecification>> = {};
function fetchStyle(dark: boolean): Promise<StyleSpecification> {
  const key = dark ? 'dark' : 'light';
  cache[key] ??= fetch(STYLE_URL[key]).then((r) => {
    if (!r.ok) throw new Error(`basemap style HTTP ${r.status}`);
    return r.json() as Promise<StyleSpecification>;
  });
  cache[key].catch(() => delete cache[key]);
  return cache[key];
}

function addExtras(map: MLMap, dark: boolean, buildings: boolean, terrain: boolean) {
  const t = tokens();
  if (map.getSource('openmaptiles') && !map.getLayer('mp-buildings')) {
    const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    map.addLayer(
      {
        id: 'mp-buildings',
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 12,
        layout: { visibility: buildings ? 'visible' : 'none' },
        paint: {
          'fill-extrusion-color': css(dark ? mixRgb(t.bg2, t.accent, 0.08) : mixRgb(t.bg, t.ink, 0.1)),
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 12, 0, 13.5, ['coalesce', ['get', 'render_height'], 0]],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.85,
        },
      },
      firstSymbol,
    );
  }
  if (!map.getSource('mp-dem')) {
    map.addSource('mp-dem', { type: 'raster-dem', tiles: [TERRAIN_TILES], tileSize: 256, encoding: 'terrarium', maxzoom: 14, attribution: TERRAIN_ATTRIBUTION });
  }
  setTerrain(map, terrain);
}

function setTerrain(map: MLMap, on: boolean) {
  if (!map.getSource('mp-dem')) return;
  map.setTerrain(on ? { source: 'mp-dem', exaggeration: 1.35 } : null);
}

/**
 * deck.gl 9.4's interleaved renderer reads `map.transform` (size, near/far planes,
 * terrain elevation). MapLibre 6 no longer exposes it on the map; the painter's
 * transform carries the same fields. Alias it when missing. Remove once deck.gl
 * supports MapLibre 6 natively.
 */
function shimTransform(map: MLMap) {
  const m = map as unknown as { transform?: unknown; painter?: { transform?: unknown } };
  if (m.transform !== undefined) return;
  Object.defineProperty(map, 'transform', { configurable: true, get: () => m.painter?.transform });
}

// ---------- deck layers ----------
// Columns keep a similar on-screen size as you zoom (never taller than at the national view).
const zoomFactor = (zoom: number) => 2 ** (0.9 * (3.35 - Math.max(zoom, 2.9)));

function deckLayers(p: AtlasMapProps, zoom: number, accent: RGB) {
  const f = zoomFactor(zoom);
  const data = p.columns.filter((c) => c.height != null);
  const sel = new Set(p.selected);
  const layers: unknown[] = [];
  if (p.ring) {
    layers.push(
      new PolygonLayer({ id: 'ring-fill', data: [{ polygon: p.ring }], getPolygon: (d: { polygon: Array<[number, number]> }) => d.polygon, getFillColor: [...accent, 22], stroked: false, pickable: false }),
      new PathLayer({ id: 'ring-glow', data: [{ path: p.ring }], getPath: (d: { path: Array<[number, number]> }) => d.path, getColor: [...accent, 70], getWidth: 9, widthUnits: 'pixels', pickable: false }),
      new PathLayer({ id: 'ring-line', data: [{ path: p.ring }], getPath: (d: { path: Array<[number, number]> }) => d.path, getColor: [...accent, 235], getWidth: 1.8, widthUnits: 'pixels', pickable: false }),
    );
  }
  if (p.pin) {
    layers.push(
      new ScatterplotLayer({ id: 'pin', data: [p.pin], getPosition: (d: { lat: number; lon: number }) => [d.lon, d.lat], getRadius: 5, radiusUnits: 'pixels', getFillColor: [...accent, 255], stroked: true, getLineColor: [...accent, 120], lineWidthUnits: 'pixels', getLineWidth: 8 }),
    );
  }
  const common = { data, pickable: true, autoHighlight: true, highlightColor: [...accent, 255] as [number, number, number, number], getPosition: (d: ColumnDatum) => [d.lon, d.lat] as [number, number] };
  if (p.style === 'columns') {
    layers.push(
      new ScatterplotLayer({ id: 'col-glow', data, getPosition: common.getPosition, getRadius: 52_000 * f, getFillColor: (d: ColumnDatum) => [...d.color, 55] as [number, number, number, number], pickable: false, updateTriggers: { getFillColor: data } }),
      new ColumnLayer({
        ...common,
        id: 'columns',
        diskResolution: 14,
        radius: 21_000 * f,
        extruded: true,
        elevationScale: f,
        getElevation: (d: ColumnDatum) => (d.height ?? 0) * 1_250_000,
        getFillColor: (d: ColumnDatum) => [...d.color, sel.has(d.slug) ? 255 : 232] as [number, number, number, number],
        material: { ambient: 0.42, diffuse: 0.62, shininess: 36, specularColor: [200, 220, 255] },
        transitions: p.reducedMotion ? undefined : { getElevation: 450, getFillColor: 450 },
        updateTriggers: { getElevation: data, getFillColor: [data, p.selected] },
      }),
    );
  } else if (p.style === 'bubbles') {
    layers.push(
      new ScatterplotLayer({
        ...common,
        id: 'bubbles',
        getRadius: (d: ColumnDatum) => 16_000 + Math.sqrt(d.height ?? 0) * 80_000,
        getFillColor: (d: ColumnDatum) => [...d.color, 205] as [number, number, number, number],
        stroked: true,
        getLineColor: (d: ColumnDatum) => (sel.has(d.slug) ? [...accent, 255] : [255, 255, 255, 60]) as [number, number, number, number],
        lineWidthUnits: 'pixels',
        getLineWidth: (d: ColumnDatum) => (sel.has(d.slug) ? 2.5 : 1),
        transitions: p.reducedMotion ? undefined : { getRadius: 450, getFillColor: 450 },
        updateTriggers: { getRadius: data, getFillColor: data, getLineColor: p.selected, getLineWidth: p.selected },
      }),
    );
  } else if (p.style === 'heat') {
    layers.push(
      new HexagonLayer({
        id: 'heat',
        data: p.columns.filter((c) => c.height != null && c.change != null),
        getPosition: common.getPosition,
        radius: 140_000,
        coverage: 0.88,
        extruded: true,
        elevationScale: 1,
        getElevationWeight: (d: ColumnDatum) => (d.height ?? 0) * 40_000,
        elevationAggregation: 'MAX',
        getColorWeight: (d: ColumnDatum) => d.change ?? 0,
        colorAggregation: 'MEAN',
        colorScaleType: 'quantize',
        colorDomain: [-p.bound, p.bound],
        colorRange: heatRange(),
        pickable: false,
        material: { ambient: 0.7, diffuse: 0.5 },
        updateTriggers: { getElevationWeight: p.columns, getColorWeight: p.columns },
      }),
      // Points stay pickable under the hexagons.
      new ScatterplotLayer({ ...common, id: 'heat-points', getRadius: 5, radiusUnits: 'pixels', getFillColor: [255, 255, 255, 170], stroked: false }),
    );
  } else {
    layers.push(
      new ScatterplotLayer({
        ...common,
        id: 'flat',
        getRadius: 7,
        radiusUnits: 'pixels',
        getFillColor: (d: ColumnDatum) => [...d.color, 240] as [number, number, number, number],
        stroked: true,
        getLineColor: (d: ColumnDatum) => (sel.has(d.slug) ? [...accent, 255] : [0, 0, 0, 90]) as [number, number, number, number],
        lineWidthUnits: 'pixels',
        getLineWidth: (d: ColumnDatum) => (sel.has(d.slug) ? 3 : 1),
        updateTriggers: { getFillColor: data, getLineColor: p.selected, getLineWidth: p.selected },
      }),
    );
  }
  if (p.style === 'columns' && sel.size) {
    layers.push(
      new ScatterplotLayer({
        id: 'selected-rings',
        data: data.filter((d) => sel.has(d.slug)),
        getPosition: common.getPosition,
        getRadius: 11,
        radiusUnits: 'pixels',
        filled: false,
        stroked: true,
        getLineColor: [...accent, 255],
        lineWidthUnits: 'pixels',
        getLineWidth: 2,
      }),
    );
  }
  return layers;
}

function heatRange(): Array<[number, number, number]> {
  const css2 = getComputedStyle(document.documentElement);
  const g = (n: string) => parseChannels(css2.getPropertyValue(`--mp-${n}`));
  const [c2, c1, m, h1, h2] = [g('cool-2'), g('cool-1'), g('mid'), g('hot-1'), g('hot-2')];
  return [c2, mixRgb(c2, c1, 0.6), mixRgb(c1, m, 0.6), mixRgb(m, h1, 0.6), mixRgb(h1, h2, 0.5), h2];
}

// ---------- component ----------
const Atlas = forwardRef<AtlasMapHandle, AtlasMapProps>(function AtlasMap(props, ref) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [zoom, setZoom] = useState(props.camera.zoom);
  const [lasso, setLasso] = useState<Array<[number, number]> | null>(null);
  const themeRef = useRef(props.dark);

  // Create the map once.
  useEffect(() => {
    let dead = false;
    const el = container.current;
    if (!el) return;
    const timeout = window.setTimeout(() => !mapRef.current?.loaded() && propsRef.current.onFail('The basemap took too long to load'), 15_000);
    fetchStyle(props.dark)
      .then((base) => {
        if (dead) return;
        const c = propsRef.current.camera;
        const map = new MLMap({
          container: el,
          style: atlasStyle(base, props.dark),
          center: [c.lon, c.lat],
          zoom: c.zoom,
          pitch: c.pitch,
          bearing: c.bearing,
          maxPitch: 70,
          attributionControl: false,
          boxZoom: false,
          canvasContextAttributes: { antialias: true, preserveDrawingBuffer: false },
        });
        mapRef.current = map;
        // Tests and debugging reach the live map through its container.
        (el as HTMLDivElement & { __map?: MLMap }).__map = map;
        shimTransform(map);
        // The container can size after the map is created (lazy mount, route transition).
        const ro = new ResizeObserver(() => map.resize());
        ro.observe(el);
        map.once('remove', () => ro.disconnect());
        map.addControl(new AttributionControl({ compact: true, customAttribution: [BASE_ATTRIBUTION, 'Data: Redfin'] }), 'bottom-right');
        const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
        overlayRef.current = overlay;
        map.addControl(overlay as never);
        map.on('style.load', () => addExtras(map, themeRef.current, propsRef.current.buildings, propsRef.current.terrain));
        map.setPadding(propsRef.current.padding);
        map.on('load', () => {
          window.clearTimeout(timeout);
          // Attribution starts collapsed to its (i) button; it stays one click away.
          el.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
          propsRef.current.onReady();
        });
        // Only a basemap that can't load its style is fatal; tile, glyph and terrain
        // errors (a missing ocean DEM tile, a sprite icon) just leave a gap.
        map.on('error', (e) => {
          if (!map.isStyleLoaded() && !(e as { sourceId?: string }).sourceId) propsRef.current.onFail(e.error?.message ?? 'Basemap error');
        });
        map.on('zoom', () => setZoom(Math.round(map.getZoom() * 4) / 4));
        map.on('moveend', () => {
          const ctr = map.getCenter();
          propsRef.current.onCamera({ lon: ctr.lng, lat: ctr.lat, zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() });
        });
        const pick = (x: number, y: number) => overlay.pickObject({ x, y, radius: 6 })?.object as ColumnDatum | undefined;
        map.on('mousemove', (e) => {
          const hit = pick(e.point.x, e.point.y);
          map.getCanvas().style.cursor = hit ? 'pointer' : '';
          propsRef.current.onHover(hit ? { slug: hit.slug, x: e.point.x, y: e.point.y } : null);
        });
        map.getCanvas().addEventListener('mouseleave', () => propsRef.current.onHover(null));
        map.on('click', (e) => {
          const hit = pick(e.point.x, e.point.y);
          if (hit) propsRef.current.onSelect(hit.slug);
          else propsRef.current.onPickEmpty(e.lngLat.lat, e.lngLat.lng);
        });
        map.on('dblclick', (e) => {
          const hit = pick(e.point.x, e.point.y);
          if (hit) {
            e.preventDefault();
            propsRef.current.onOpen(hit.slug);
          }
        });
      })
      .catch((err: Error) => propsRef.current.onFail(err.message));
    return () => {
      dead = true;
      window.clearTimeout(timeout);
      mapRef.current?.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
    // The map is created once; later prop changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme: swap the recolored style; deck and the extras are re-added on style.load.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || themeRef.current === props.dark) return;
    themeRef.current = props.dark;
    fetchStyle(props.dark)
      .then((base) => map.setStyle(atlasStyle(base, props.dark)))
      .catch(() => undefined);
  }, [props.dark]);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer('mp-buildings')) map.setLayoutProperty('mp-buildings', 'visibility', props.buildings ? 'visible' : 'none');
  }, [props.buildings]);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.isStyleLoaded()) setTerrain(map, props.terrain);
  }, [props.terrain]);

  // Deck layers follow the data.
  useEffect(() => {
    overlayRef.current?.setProps({ layers: deckLayers(props, zoom, tokens().accent) as never });
  });

  useImperativeHandle(
    ref,
    () => ({
      panBy: (dx, dy) => mapRef.current?.panBy([dx, dy], { duration: props.reducedMotion ? 0 : 200 }),
      zoomBy: (d) => {
        const m = mapRef.current;
        if (m) m.easeTo({ zoom: m.getZoom() + d, duration: props.reducedMotion ? 0 : 250 });
      },
      rotateBy: (deg) => {
        const m = mapRef.current;
        if (m) m.easeTo({ bearing: m.getBearing() + deg, duration: props.reducedMotion ? 0 : 250 });
      },
      flyTo: (lon, lat, z) => {
        const m = mapRef.current;
        if (!m) return;
        const target = { center: [lon, lat] as [number, number], zoom: z ?? Math.max(m.getZoom(), 6.2), pitch: Math.max(m.getPitch(), 50) };
        if (props.reducedMotion) m.jumpTo(target);
        else m.flyTo({ ...target, ...CAMERA_FLIGHT });
      },
      zoomOutTo: (z) => {
        const m = mapRef.current;
        if (m && m.getZoom() > z) m.easeTo({ zoom: z, duration: props.reducedMotion ? 0 : 500 });
      },
      reset: (c) => {
        const m = mapRef.current;
        const target = { center: [c.lon, c.lat] as [number, number], zoom: c.zoom, pitch: c.pitch, bearing: c.bearing };
        if (!m) return;
        if (props.reducedMotion) m.jumpTo(target);
        else m.flyTo({ ...target, ...CAMERA_FLIGHT });
      },
      snapshot: async () => {
        const m = mapRef.current;
        if (!m) return null;
        // Read the frame inside its own render event, while the buffer is still intact
        // (so the map never needs preserveDrawingBuffer outside an export).
        return new Promise<string | null>((resolve) => {
          m.once('render', () => {
            try {
              resolve(m.getCanvas().toDataURL('image/png'));
            } catch {
              resolve(null);
            }
          });
          m.triggerRepaint();
        });
      },
    }),
    [props.reducedMotion],
  );

  // Lasso: shift + drag draws a polygon; columns inside it are selected.
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.shiftKey || e.button !== 0) return;
    const map = mapRef.current;
    if (!map) return;
    e.preventDefault();
    e.stopPropagation();
    map.dragPan.disable();
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    setLasso([[e.clientX - rect.left, e.clientY - rect.top]]);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!lasso) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setLasso([...lasso, [e.clientX - rect.left, e.clientY - rect.top]]);
  };
  const onPointerUp = () => {
    const map = mapRef.current;
    if (!lasso || !map) return;
    map.dragPan.enable();
    const poly = lasso;
    setLasso(null);
    if (poly.length < 3) return;
    const inside = props.columns
      .filter((c) => c.height != null)
      .filter((c) => {
        const p = map.project([c.lon, c.lat]);
        return pointInPolygon(p.x, p.y, poly);
      })
      .sort((a, b) => (b.homesSold12m ?? 0) - (a.homesSold12m ?? 0))
      .map((c) => c.slug);
    props.onLasso(inside);
  };

  return (
    <div className="absolute inset-0" onPointerDownCapture={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      {/* .maplibregl-map forces position: relative, so the container sizes by h-full, not inset. */}
      <div ref={container} className="h-full w-full" role="region" aria-label={props.label} />
      {lasso && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          <polygon points={lasso.map((p) => p.join(',')).join(' ')} style={{ fill: 'rgb(var(--mp-accent) / .12)', stroke: 'rgb(var(--mp-accent))' }} strokeWidth="1.5" strokeDasharray="5 4" />
        </svg>
      )}
    </div>
  );
});

export default Atlas;
