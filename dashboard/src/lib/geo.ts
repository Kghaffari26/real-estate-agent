/** Map helpers (pure): de-overlap shared centroids and size bubbles. */

export interface GeoPoint {
  slug: string;
  lat: number;
  lon: number;
  /** Larger markets keep the true centroid when points share one. */
  weight: number;
}

/**
 * Metros Redfin reports as divisions (e.g. Dallas / Fort Worth) share their parent
 * CBSA's centroid. Points at the same position (rounded to `precision` degrees) are
 * fanned out on a small ring around it, largest first, in a stable order. The
 * longitude offset is widened by 1/cos(lat) so the ring is round on the map.
 */
export function spreadOverlapping<T extends GeoPoint>(points: readonly T[], radiusDeg = 0.45, precision = 2): (T & { displayLat: number; displayLon: number })[] {
  const groups = new Map<string, T[]>();
  for (const p of points) {
    const key = `${p.lat.toFixed(precision)},${p.lon.toFixed(precision)}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const out = new Map<string, { displayLat: number; displayLon: number }>();
  for (const group of groups.values()) {
    if (group.length === 1) {
      out.set(group[0]!.slug, { displayLat: group[0]!.lat, displayLon: group[0]!.lon });
      continue;
    }
    const ordered = [...group].sort((a, b) => b.weight - a.weight || a.slug.localeCompare(b.slug));
    ordered.forEach((p, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / ordered.length;
      const lonScale = 1 / Math.max(Math.cos((p.lat * Math.PI) / 180), 0.2);
      out.set(p.slug, {
        displayLat: p.lat + radiusDeg * Math.sin(angle),
        displayLon: p.lon + radiusDeg * lonScale * Math.cos(angle),
      });
    });
  }
  return points.map((p) => ({ ...p, ...out.get(p.slug)! }));
}

/** Area-true bubble radius (sqrt scale) between `min` and `max` px. */
export function bubbleRadius(value: number | null | undefined, maxValue: number, min = 4, max = 20): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || maxValue <= 0) return min;
  return min + (max - min) * Math.sqrt(Math.min(value / maxValue, 1));
}
