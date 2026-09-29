/**
 * Naming a point on the map (an area-search pin) after the place under it, from the
 * place labels already in the basemap's vector tiles (no geocoding service). Pure.
 */
import { milesBetween, type LatLon } from './area';

export interface PlacePoint extends LatLon {
  name: string;
  /** OpenMapTiles place class: city, town, village, suburb, neighbourhood, hamlet… */
  cls: string;
}

// A city a little farther away still names the spot before a nearby hamlet does.
const WEIGHT: Record<string, number> = { city: 0.55, town: 0.7, village: 0.9, suburb: 1, neighbourhood: 1.15, quarter: 1.15, hamlet: 1.3 };

/** The best-named place within `maxMiles` (distance weighted by class), or null. */
export function nearestPlace(places: readonly PlacePoint[], at: LatLon, maxMiles = 6): PlacePoint | null {
  let best: PlacePoint | null = null;
  let score = Infinity;
  for (const p of places) {
    const w = WEIGHT[p.cls];
    if (w === undefined) continue;
    const d = milesBetween(at, p);
    if (d > maxMiles) continue;
    const s = d * w;
    if (s < score) {
      score = s;
      best = p;
    }
  }
  return best;
}
