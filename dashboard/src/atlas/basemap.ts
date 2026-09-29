/**
 * OpenFreeMap's style, restyled as the atlas's canvas (pure, tested).
 *
 * Layers are classified by role, not by id: OpenFreeMap's positron (Dawn) and dark
 * (Night) styles name the same layers differently (`label_city` vs `place_city`).
 *
 * - **Labels by zoom:** states from 3.5, large cities from 4.6, cities from 6, towns
 *   from 8.5, villages from 10.5, suburbs and neighborhoods from 11.5, water names from
 *   9, major road names from 13 and the rest from 15. Countries and road shields are
 *   dropped (a U.S. atlas; shields are noise at our zooms).
 * - **Road hierarchy:** motorways faint but present, major roads fainter, minor roads
 *   only from zoom 11 and paths/rail from 13; casings take the land color so roads
 *   never outline themselves into a dark web.
 */
import type { StyleSpecification } from 'maplibre-gl';

export type RGB = [number, number, number];
export interface BasemapTokens {
  bg: RGB;
  bg2: RGB;
  ink: RGB;
  ink2: RGB;
  ink3: RGB;
  accent: RGB;
}
type AnyLayer = StyleSpecification['layers'][number] & { paint?: Record<string, unknown>; layout?: Record<string, unknown>; minzoom?: number; 'source-layer'?: string };

const css = ([r, g, b]: RGB, a = 1) => (a === 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`);
export const mixRgb = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((k) => Math.round(a[k]! + (b[k]! - a[k]!) * t)) as RGB;

export type LabelKind = 'state' | 'city-large' | 'city' | 'town' | 'village' | 'suburb' | 'water' | 'road-major' | 'road-minor';

/** What a symbol layer labels, or null to drop it. */
export function labelKind(l: { id: string; 'source-layer'?: string }): LabelKind | null {
  const id = l.id.toLowerCase();
  const src = l['source-layer'];
  if (/shield|oneway|country|continent/.test(id)) return null;
  if (src === 'water_name' || /water_name|waterway.*label/.test(id)) return 'water';
  if (src === 'transportation_name' || /highway[-_]name|road[-_]name/.test(id)) return /motorway|major/.test(id) ? 'road-major' : 'road-minor';
  if (src === 'place' || /^(label|place)_/.test(id)) {
    if (/state/.test(id)) return 'state';
    if (/city_large|city_capital/.test(id)) return 'city-large';
    if (/city/.test(id)) return 'city';
    if (/town/.test(id)) return 'town';
    if (/village/.test(id)) return 'village';
    if (/suburb|other|hamlet|neighbou?rhood/.test(id)) return 'suburb';
  }
  return null;
}

export const LABEL_MINZOOM: Record<LabelKind, number> = {
  state: 3.5,
  'city-large': 4.6,
  city: 6,
  town: 8.5,
  village: 10.5,
  suburb: 11.5,
  water: 9,
  'road-major': 13,
  'road-minor': 15,
};

export type RoadKind = 'casing' | 'motorway' | 'major' | 'minor' | 'path' | 'rail';

/** A line layer's role in the road hierarchy, or null for other lines. */
export function roadKind(l: { id: string; 'source-layer'?: string }): RoadKind | null {
  const id = l.id.toLowerCase();
  if (l['source-layer'] !== 'transportation' && !/highway|road|rail|tunnel|bridge/.test(id)) return null;
  if (/rail/.test(id)) return 'rail';
  if (/casing/.test(id)) return 'casing';
  if (/motorway/.test(id)) return 'motorway';
  if (/major|trunk|primary/.test(id)) return 'major';
  if (/path|pier|service|track/.test(id)) return 'path';
  return 'minor';
}

export const ROAD_MINZOOM: Partial<Record<RoadKind, number>> = { minor: 11, path: 13, rail: 13 };

export function atlasStyle(base: StyleSpecification, dark: boolean, t: BasemapTokens): StyleSpecification {
  // Night: land lifts slightly off the canvas. Dawn: near-white land on blue-gray water.
  const land = dark ? mixRgb(t.bg, t.bg2, 0.9) : mixRgb(t.bg, [255, 255, 255], 0.7);
  const water = dark ? mixRgb(t.bg, [0, 0, 0], 0.35) : mixRgb(t.bg2, t.ink, 0.09);
  const roadInk: RGB = dark ? [150, 180, 255] : t.ink;
  const roadAlpha: Record<Exclude<RoadKind, 'casing'>, number> = dark
    ? { motorway: 0.26, major: 0.15, minor: 0.055, path: 0.045, rail: 0.06 }
    : { motorway: 0.22, major: 0.13, minor: 0.07, path: 0.05, rail: 0.06 };
  const layers: AnyLayer[] = [];
  for (const layer of base.layers as AnyLayer[]) {
    if (layer.type === 'fill-extrusion' || layer.id === 'building') continue; // replaced by the extrusion layer
    const l: AnyLayer = { ...layer, paint: { ...(layer.paint ?? {}) }, layout: { ...(layer.layout ?? {}) } };
    const paint = l.paint!;
    if (l.type === 'symbol') {
      const kind = labelKind(l);
      if (!kind) continue;
      l.minzoom = Math.max(l.minzoom ?? 0, LABEL_MINZOOM[kind]);
      const strong = kind === 'state' || kind === 'city-large' || kind === 'city';
      paint['text-color'] = css(kind === 'state' ? t.ink3 : strong ? t.ink2 : kind === 'water' ? mixRgb(water, t.ink, 0.45) : t.ink3, strong ? 0.95 : 0.85);
      paint['text-halo-color'] = css(land, 0.92);
      paint['text-halo-width'] = 1.4;
      paint['text-halo-blur'] = 0.4;
      delete paint['icon-opacity'];
      if (kind === 'state') l.layout!['text-transform'] = 'uppercase';
      l.layout!['text-letter-spacing'] = kind === 'state' ? 0.12 : 0.01;
      layers.push(l);
      continue;
    }
    if (l.type === 'background') paint['background-color'] = css(land);
    else if (l.type === 'fill' && /water/.test(l.id)) paint['fill-color'] = css(water);
    else if (l.type === 'fill' && /^land$|land(cover|use)/.test(l.id)) {
      paint['fill-color'] = /^land$/.test(l.id) ? css(land) : css(mixRgb(land, t.ink, dark ? 0.03 : 0.02));
      paint['fill-opacity'] = /^land$/.test(l.id) ? 1 : 0.6;
    } else if (l.type === 'fill') paint['fill-color'] = css(mixRgb(land, t.ink, 0.04));
    else if (l.type === 'line' && /water/.test(l.id)) paint['line-color'] = css(water);
    else if (l.type === 'line' && /boundary|border|admin/.test(l.id)) {
      paint['line-color'] = css(t.accent, /state|border/.test(l.id) ? (dark ? 0.2 : 0.3) : dark ? 0.3 : 0.35);
    } else if (l.type === 'line') {
      const road = roadKind(l);
      if (road === 'casing') {
        paint['line-color'] = css(land);
      } else if (road) {
        paint['line-color'] = css(roadInk, roadAlpha[road]);
        const min = ROAD_MINZOOM[road];
        if (min !== undefined) l.minzoom = Math.max(l.minzoom ?? 0, min);
      } else paint['line-color'] = css(roadInk, 0.08);
    } else if (l.type === 'raster') paint['raster-opacity'] = 0.08;
    layers.push(l);
  }
  return { ...base, layers: layers as StyleSpecification['layers'] };
}
