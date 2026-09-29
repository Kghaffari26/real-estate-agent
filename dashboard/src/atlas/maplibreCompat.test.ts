import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PINNED, shimTransform } from './maplibreCompat';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string>; overrides?: Record<string, string> };
const installed = (name: string) => (JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8')) as { version: string }).version;

describe('deck.gl × MapLibre 6 patch', () => {
  it('runs against exactly the versions it was written for', () => {
    for (const name of ['maplibre-gl', '@deck.gl/core', '@deck.gl/layers', '@deck.gl/aggregation-layers', '@deck.gl/mapbox', '@luma.gl/core', '@math.gl/web-mercator']) {
      expect(pkg.dependencies[name], `${name} must be pinned exactly`).toMatch(/^\d+\.\d+\.\d+$/);
      expect(installed(name), `${name} installed = pinned`).toBe(pkg.dependencies[name]);
    }
    // An upgrade must be a deliberate edit here too (re-check the patch, then bump).
    expect(pkg.dependencies['maplibre-gl']).toBe(PINNED['maplibre-gl']);
    expect(pkg.dependencies['@deck.gl/mapbox']).toBe(PINNED['@deck.gl/mapbox']);
  });

  it('is still needed: deck reads map.transform, which MapLibre 6 no longer exposes', () => {
    const deckUtils = readFileSync('node_modules/@deck.gl/mapbox/dist/deck-utils.js', 'utf8');
    expect(deckUtils).toMatch(/map\.transform\.height/);
    expect(deckUtils).toMatch(/map\.transform\._nearZ/);
  });

  it('aliases the painter transform only when the map has none', () => {
    const painterTransform = { height: 900 };
    const bare = { painter: { transform: painterTransform } };
    expect(shimTransform(bare)).toBe(true);
    expect((bare as { transform?: unknown }).transform).toBe(painterTransform);
    // follows the painter if MapLibre swaps its transform object
    const next = { height: 800 };
    bare.painter.transform = next;
    expect((bare as { transform?: unknown }).transform).toBe(next);

    const own = { transform: { height: 1 }, painter: { transform: painterTransform } };
    expect(shimTransform(own)).toBe(false);
    expect(own.transform).toEqual({ height: 1 });
  });
});
