/**
 * The Arrival globe (spec M1): a dark ocean, dotted land (U.S. brighter) and light
 * columns rising from the 50 metros, on deck.gl's GlobeView. Height = median sale
 * price from zero (proportional), color = YoY on the shared diverging scale.
 * Decorative: the counters and sections beside it carry every number as text.
 * Lazy-loaded; the poster image shows until the first frame is drawn.
 */
import { Deck, _GlobeView as GlobeView, type PickingInfo } from '@deck.gl/core';
import { ColumnLayer, ScatterplotLayer, SolidPolygonLayer } from '@deck.gl/layers';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { parseChannels, type RGB } from '../lib/columns';
import type { ColumnDatum } from '../viewmodels/atlas';
import dots from './landDots.json';

export interface GlobeHandle {
  /** The camera dive toward the U.S.; resolves when it lands (instantly under reduced motion). */
  dive: (durationMs: number) => Promise<void>;
}

interface GlobeProps {
  columns: readonly ColumnDatum[];
  dark: boolean;
  reducedMotion: boolean;
  paused: boolean;
  /** Resting zoom (the page sizes the globe to the viewport). */
  zoom: number;
  /** Max device pixel ratio (quality tier). */
  dpr?: number;
  onFirstFrame: () => void;
  onHover?: (info: { slug: string; x: number; y: number } | null) => void;
}

const HOME = { longitude: -100, latitude: 26 };
const LANDING = { longitude: -96.2, latitude: 37.4, zoom: 2.9 };
const DEG_PER_SEC = 3;

type Dot = { position: [number, number]; us: boolean };
const DOTS: Dot[] = [];
for (let i = 0; i < (dots as number[]).length; i += 3) {
  const d = dots as number[];
  DOTS.push({ position: [d[i]! / 10, d[i + 1]! / 10], us: d[i + 2] === 1 });
}
const WORLD = [{ polygon: [[-180, 90], [0, 90], [180, 90], [180, -90], [0, -90], [-180, -90]] as Array<[number, number]> }];

function palette() {
  const css = getComputedStyle(document.documentElement);
  const g = (n: string) => parseChannels(css.getPropertyValue(`--mp-${n}`));
  return { bg: g('bg'), bg2: g('bg-2'), ink: g('ink'), accent: g('accent') };
}
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((k) => Math.round(a[k]! + (b[k]! - a[k]!) * t)) as RGB;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export const GlobeCanvas = forwardRef<GlobeHandle, GlobeProps>(function GlobeCanvas({ columns, dark, reducedMotion, paused, zoom, dpr = 2, onFirstFrame, onHover }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const deckRef = useRef<Deck<GlobeView> | null>(null);
  const view = useRef({ ...HOME, zoom });
  const diving = useRef(false);
  const first = useRef(false);
  const live = useRef({ reducedMotion, paused, onFirstFrame, onHover });
  live.current = { reducedMotion, paused, onFirstFrame, onHover };

  const layers = () => {
    const p = palette();
    const ocean = dark ? mix(p.bg, [0, 0, 0], 0.2) : mix(p.bg2, p.ink, 0.04);
    const landDot = dark ? mix(p.bg2, [140, 170, 230], 0.36) : mix(p.bg2, p.ink, 0.3);
    const usDot = dark ? mix(p.bg2, [160, 200, 255], 0.68) : mix(p.bg2, p.ink, 0.6);
    return [
      new SolidPolygonLayer({ id: 'ocean', data: WORLD, getPolygon: (d: (typeof WORLD)[number]) => d.polygon, getFillColor: [...ocean, 255], stroked: false }),
      new ScatterplotLayer<Dot>({ id: 'land', data: DOTS, getPosition: (d) => d.position, getRadius: (d) => (d.us ? 30_000 : 26_000), getFillColor: (d) => [...(d.us ? usDot : landDot), d.us ? 235 : 190], radiusMinPixels: 0.8 }),
      new ColumnLayer<ColumnDatum>({
        id: 'columns',
        data: columns.filter((c) => c.height != null),
        getPosition: (d) => [d.lon, d.lat],
        diskResolution: 10,
        radius: 42_000,
        extruded: true,
        // From zero, proportional (price / largest price).
        getElevation: (d) => (d.height ?? 0) * 2_600_000,
        getFillColor: (d) => [...d.color, 245],
        material: { ambient: 0.55, diffuse: 0.55, shininess: 40, specularColor: [220, 235, 255] },
        pickable: Boolean(live.current.onHover),
        autoHighlight: true,
        highlightColor: [...p.accent, 255],
      }),
    ];
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const deck = new Deck<GlobeView>({
      canvas,
      views: new GlobeView({ id: 'globe', resolution: 10 }),
      initialViewState: { ...view.current },
      controller: { scrollZoom: false, doubleClickZoom: false, keyboard: false, dragPan: true, dragRotate: false, inertia: true },
      layers: layers(),
      useDevicePixels: Math.min(window.devicePixelRatio || 1, dpr),
      onViewStateChange: ({ viewState }) => {
        view.current = { longitude: viewState.longitude, latitude: viewState.latitude, zoom: viewState.zoom };
        return viewState;
      },
      onAfterRender: () => {
        if (!first.current) {
          first.current = true;
          live.current.onFirstFrame();
        }
      },
      onHover: (info: PickingInfo<ColumnDatum>) => live.current.onHover?.(info.object ? { slug: info.object.slug, x: info.x, y: info.y } : null),
      getCursor: ({ isHovering, isDragging }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'),
    });
    deckRef.current = deck;
    // Slow auto-rotation; stops for reduced motion, the media toggle, hidden tabs and dives.
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const l = live.current;
      if (!l.reducedMotion && !l.paused && !diving.current && document.visibilityState === 'visible') {
        view.current = { ...view.current, longitude: view.current.longitude + DEG_PER_SEC * dt };
        deck.setProps({ viewState: { ...view.current } });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      deck.finalize();
      deckRef.current = null;
    };
    // The deck is created once; data and theme changes update its layers below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (diving.current) return;
    view.current = { ...view.current, zoom };
    deckRef.current?.setProps({ viewState: { ...view.current } });
  }, [zoom]);

  useEffect(() => {
    deckRef.current?.setProps({ layers: layers() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, dark]);

  useImperativeHandle(ref, () => ({
    dive: (durationMs) =>
      new Promise<void>((resolve) => {
        const deck = deckRef.current;
        if (!deck || live.current.reducedMotion) return resolve();
        diving.current = true;
        const from = { ...view.current };
        // Arrive from the shorter way round.
        const dLon = ((((LANDING.longitude - from.longitude) % 360) + 540) % 360) - 180;
        const t0 = performance.now();
        const step = (now: number) => {
          const t = Math.min(1, (now - t0) / durationMs);
          const k = ease(t);
          view.current = { longitude: from.longitude + dLon * k, latitude: from.latitude + (LANDING.latitude - from.latitude) * k, zoom: from.zoom + (LANDING.zoom - from.zoom) * k };
          deck.setProps({ viewState: { ...view.current } });
          if (t < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      }),
  }));

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" data-testid="globe-canvas" />;
});

export default GlobeCanvas;
