/**
 * Named regions (v3 spec §4.1): a framed camera and the tracked metros inside. Orange
 * County is the first; the regional desk (R2) builds its ZIP/city layers on these.
 */
import type { Camera } from '../viewmodels/atlas';

export interface Region {
  slug: string;
  name: string;
  /** Other words people search it by. */
  aliases: readonly string[];
  camera: Camera;
  /** Tracked metros (Redfin metros/divisions) inside the region. */
  metros: readonly string[];
}

export const REGIONS: readonly Region[] = [
  {
    slug: 'orange-county',
    name: 'Orange County, CA',
    aliases: ['oc', 'orange', 'anaheim', 'santa ana', 'irvine', 'huntington beach', 'newport beach', 'costa mesa'],
    camera: { lon: -117.79, lat: 33.66, zoom: 9.7, pitch: 50, bearing: -18 },
    metros: ['anaheim-ca'],
  },
];

export const regionBySlug = (slug: string | null | undefined): Region | null => REGIONS.find((r) => r.slug === slug) ?? null;

/** Regions matching a search (name or alias, prefix of any word); all of them for an empty query. */
export function matchRegions(query: string): Region[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...REGIONS];
  return REGIONS.filter((r) => [r.name, ...r.aliases].some((s) => s.toLowerCase().split(/[\s,]+/).some((w) => w.startsWith(q)) || s.toLowerCase().startsWith(q)));
}
