/**
 * deck.gl 9.4 × MapLibre 6 compatibility.
 *
 * deck's interleaved renderer (`@deck.gl/mapbox`, deck-utils `getViewport` and
 * `centerCameraOnTerrain`) reads `map.transform` (`height`, `_nearZ/_farZ`,
 * `elevation`). MapLibre 6 no longer exposes `transform` on the map; the painter's
 * transform carries the same fields. This aliases it, only when missing.
 *
 * Versions are pinned exactly in package.json. `maplibreCompat.test.ts` and the
 * atlas e2e ("deck picks what MapLibre projects") fail if an upgrade breaks this,
 * or if deck stops needing it (then delete this file).
 */
export const PINNED = { 'maplibre-gl': '6.11.2', '@deck.gl/mapbox': '9.4.0' } as const;

interface MapLike {
  transform?: unknown;
  painter?: { transform?: unknown };
}

/** Returns true when the alias was installed, false when the map already had a transform. */
export function shimTransform(map: object): boolean {
  const m = map as MapLike;
  if (m.transform !== undefined) return false;
  Object.defineProperty(map, 'transform', { configurable: true, get: () => m.painter?.transform });
  return true;
}
