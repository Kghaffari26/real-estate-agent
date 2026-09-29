import { describe, expect, it } from 'vitest';
import type { StyleSpecification } from 'maplibre-gl';
import styles from './__fixtures__/openfreemap-layers.json';
import { atlasStyle, labelKind, LABEL_MINZOOM, roadKind, type BasemapTokens } from './basemap';

// Layer ids/types of OpenFreeMap's two styles, captured 2026-09-29 (positron = Dawn, dark = Night).
const T: BasemapTokens = { bg: [242, 244, 248], bg2: [230, 233, 240], ink: [11, 16, 32], ink2: [58, 68, 88], ink3: [100, 110, 130], accent: [15, 118, 110] };
const style = (name: 'positron' | 'dark') => ({ version: 8, sources: {}, layers: styles[name].map((l) => ({ ...l, paint: {}, layout: {} })) }) as unknown as StyleSpecification;
const kinds = (name: 'positron' | 'dark') => new Set(styles[name].filter((l) => l.type === 'symbol').map((l) => labelKind(l)).filter(Boolean));

describe('basemap restyle', () => {
  it('keeps place names at every level in both styles (the v2 bug: positron kept none)', () => {
    for (const name of ['positron', 'dark'] as const) {
      const k = kinds(name);
      for (const need of ['state', 'city', 'town', 'village'] as const) expect(k.has(need), `${name} ${need}`).toBe(true);
    }
    expect(labelKind({ id: 'label_city', 'source-layer': 'place' })).toBe('city');
    expect(labelKind({ id: 'place_city_large', 'source-layer': 'place' })).toBe('city-large');
    expect(labelKind({ id: 'place_suburb', 'source-layer': 'place' })).toBe('suburb');
    expect(labelKind({ id: 'label_country_1', 'source-layer': 'place' })).toBeNull();
    expect(labelKind({ id: 'road_shield_us', 'source-layer': 'transportation_name' })).toBeNull();
  });

  it('staggers labels by zoom and never shows countries or shields', () => {
    for (const name of ['positron', 'dark'] as const) {
      const out = atlasStyle(style(name), name === 'dark', T).layers as Array<{ id: string; type: string; minzoom?: number }>;
      const symbols = out.filter((l) => l.type === 'symbol');
      expect(symbols.some((l) => /country|shield/.test(l.id))).toBe(false);
      const town = symbols.find((l) => /town/.test(l.id))!;
      expect(town.minzoom).toBeGreaterThanOrEqual(LABEL_MINZOOM.town);
      const state = symbols.find((l) => /state/.test(l.id))!;
      expect(state.minzoom).toBeLessThan(town.minzoom!);
    }
  });

  it('draws a road hierarchy: casings vanish into the land, minor roads wait for zoom 11', () => {
    expect(roadKind({ id: 'highway_motorway_casing', 'source-layer': 'transportation' })).toBe('casing');
    expect(roadKind({ id: 'highway_motorway_inner', 'source-layer': 'transportation' })).toBe('motorway');
    expect(roadKind({ id: 'highway_major_inner', 'source-layer': 'transportation' })).toBe('major');
    expect(roadKind({ id: 'highway_minor', 'source-layer': 'transportation' })).toBe('minor');
    expect(roadKind({ id: 'railway_transit', 'source-layer': 'transportation' })).toBe('rail');
    expect(roadKind({ id: 'water', 'source-layer': 'water' })).toBeNull();
    const out = atlasStyle(style('positron'), false, T).layers as Array<{ id: string; minzoom?: number; paint?: Record<string, string> }>;
    const alpha = (id: string) => Number(/rgba\([^)]*,([\d.]+)\)/.exec(out.find((l) => l.id === id)!.paint!['line-color']!)?.[1] ?? 1);
    expect(alpha('highway_motorway_inner')).toBeGreaterThan(alpha('highway_major_inner'));
    expect(alpha('highway_major_inner')).toBeGreaterThan(alpha('highway_minor'));
    expect(out.find((l) => l.id === 'highway_minor')!.minzoom).toBeGreaterThanOrEqual(11);
    expect(out.find((l) => l.id === 'highway_motorway_casing')!.paint!['line-color']).toMatch(/^rgb\(/); // the land color, opaque
  });
});
