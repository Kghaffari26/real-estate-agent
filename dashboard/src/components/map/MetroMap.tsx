/**
 * MapLibre GL bubble map over OpenFreeMap vector tiles (free, no key). Lazy-loaded
 * with maplibre-gl (~200 KB gz) via ./index.tsx. Colors are resolved from the design
 * tokens at runtime (MapLibre can't read CSS variables) and re-resolved on theme change.
 */
import 'maplibre-gl/dist/maplibre-gl.css';
import { Map as MLMap, NavigationControl, setWorkerUrl, type GeoJSONSource, type MapLayerMouseEvent } from 'maplibre-gl';
// MapLibre resolves its worker relative to its own module URL, which bundling breaks;
// let Vite bundle the worker (with its shared chunk) and hand MapLibre the URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { FeatureCollection } from 'geojson';
import { useEffect, useRef, useState } from 'react';
import { resolveColor, type ColorToken } from '../../lib/tokens';

export interface MapPoint {
  slug: string;
  name: string;
  lat: number;
  lon: number;
  color: ColorToken;
  radius: number;
  /** Hover card lines, preformatted. */
  lines: readonly string[];
}

export interface MetroMapProps {
  points: readonly MapPoint[];
  dark: boolean;
  reducedMotion: boolean;
  onSelect: (slug: string) => void;
  onFail: (reason: string) => void;
  label: string;
  height?: string;
}

/** OpenFreeMap styles (free, no key); dark follows the app theme. */
const MAP_STYLES = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};

setWorkerUrl(workerUrl);

const SOURCE = 'metros';
const LAYER = 'metro-bubbles';
const US_BOUNDS: [[number, number], [number, number]] = [
  [-124.8, 24.4],
  [-66.9, 49.4],
];

function toGeoJSON(points: readonly MapPoint[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [...points]
      .sort((a, b) => b.radius - a.radius) // small bubbles drawn last, on top
      .map((p, i) => ({
        type: 'Feature',
        id: i + 1,
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { slug: p.slug, color: resolveColor(p.color), radius: p.radius },
      })),
  };
}

function addLayers(map: MLMap, points: readonly MapPoint[]) {
  if (map.getSource(SOURCE)) (map.getSource(SOURCE) as GeoJSONSource).setData(toGeoJSON(points));
  else map.addSource(SOURCE, { type: 'geojson', data: toGeoJSON(points) });
  if (!map.getLayer(LAYER)) {
    map.addLayer({
      id: LAYER,
      type: 'circle',
      source: SOURCE,
      paint: {
        'circle-radius': ['get', 'radius'],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.88,
        'circle-stroke-color': ['case', ['boolean', ['feature-state', 'hover'], false], resolveColor('text'), resolveColor('surface')],
        'circle-stroke-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 1.25],
      },
    });
  }
}

export default function MetroMap({ points, dark, reducedMotion, onSelect, onFail, label, height = 'h-[360px] sm:h-[440px]' }: MetroMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const pointsRef = useRef(points);
  const [hover, setHover] = useState<{ x: number; y: number; point: MapPoint } | null>(null);
  pointsRef.current = points;

  useEffect(() => {
    if (!container.current) return;
    let loaded = false;
    let failed = false;
    const fail = (reason: string) => {
      if (failed) return;
      failed = true;
      onFail(reason);
    };
    let map: MLMap;
    try {
      map = new MLMap({
        container: container.current,
        style: dark ? MAP_STYLES.dark : MAP_STYLES.light,
        bounds: US_BOUNDS,
        fitBoundsOptions: { padding: 24 },
        attributionControl: { compact: true },
        cooperativeGestures: true,
        dragRotate: false,
        pitchWithRotate: false,
      });
    } catch (error) {
      fail(`WebGL unavailable (${(error as Error).message})`);
      return;
    }
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    const timer = setTimeout(() => !loaded && fail('The basemap took too long to load'), 10000);
    map.on('error', (e) => {
      if (!loaded) fail(`The basemap failed to load (${e.error?.message ?? 'network error'})`);
    });
    map.on('style.load', () => {
      loaded = true;
      addLayers(map, pointsRef.current);
    });

    let hovered: string | number | undefined;
    map.on('mousemove', LAYER, (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) return;
      map.getCanvas().style.cursor = 'pointer';
      if (hovered !== undefined) map.setFeatureState({ source: SOURCE, id: hovered }, { hover: false });
      hovered = f.id;
      if (hovered !== undefined) map.setFeatureState({ source: SOURCE, id: hovered }, { hover: true });
      const point = pointsRef.current.find((p) => p.slug === f.properties?.slug);
      if (point) setHover({ x: e.point.x, y: e.point.y, point });
    });
    map.on('mouseleave', LAYER, () => {
      map.getCanvas().style.cursor = '';
      if (hovered !== undefined) map.setFeatureState({ source: SOURCE, id: hovered }, { hover: false });
      hovered = undefined;
      setHover(null);
    });
    map.on('click', LAYER, (e: MapLayerMouseEvent) => {
      const slug = e.features?.[0]?.properties?.slug as string | undefined;
      const point = pointsRef.current.find((p) => p.slug === slug);
      if (!point) return;
      if (reducedMotion) {
        onSelect(point.slug);
        return;
      }
      map.once('moveend', () => onSelect(point.slug));
      map.flyTo({ center: [point.lon, point.lat], zoom: 7.5, duration: 900, essential: false });
    });

    return () => {
      clearTimeout(timer);
      map.remove();
      mapRef.current = null;
    };
    // The map is created once; theme and data changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme: swap the basemap style; layers are re-added on style.load with re-resolved colors.
  const firstTheme = useRef(true);
  useEffect(() => {
    if (firstTheme.current) {
      firstTheme.current = false;
      return;
    }
    mapRef.current?.setStyle(dark ? MAP_STYLES.dark : MAP_STYLES.light);
  }, [dark]);

  // Data (metric or filter changes).
  useEffect(() => {
    const map = mapRef.current;
    if (map?.isStyleLoaded() && map.getSource(SOURCE)) (map.getSource(SOURCE) as GeoJSONSource).setData(toGeoJSON(points));
  }, [points]);

  return (
    <div className={`relative w-full overflow-hidden rounded-md border border-border ${height}`}>
      <div ref={container} className="h-full w-full" role="region" aria-label={label} />
      {hover && (
        <div
          className="pointer-events-none absolute z-10 w-56 -translate-x-1/2 rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-2"
          // Positioned at the hovered bubble: data-driven geometry.
          style={{ left: Math.min(Math.max(hover.x, 116), (container.current?.clientWidth ?? 400) - 116), top: hover.y + 14 }}
        >
          <p className="font-semibold text-text">{hover.point.name}</p>
          {hover.point.lines.map((line) => (
            <p key={line} className="num text-text-2">
              {line}
            </p>
          ))}
          <p className="mt-1 text-text-3">Click to open</p>
        </div>
      )}
    </div>
  );
}
