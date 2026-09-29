import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { clearCache, loadRegion, loadRegionGeometry } from './api';
import { IndexOutputSchema, RegionGeometrySchema, RegionOutputSchema } from './schema.gen';

const read = (p: string) => readFileSync(resolve(__dirname, '../../sample-data', p), 'utf8');

describe('region files (v3 §4.2)', () => {
  it('the sample index lists Orange County, and its files parse with the generated types', () => {
    const index = IndexOutputSchema.parse(JSON.parse(read('latest.json')));
    const [ref] = index.regions;
    expect(ref).toMatchObject({ slug: 'orange-county', path: 'regions/orange-county.json', geometry: 'regions/orange-county.geo.json' });
    const region = RegionOutputSchema.parse(JSON.parse(read(ref!.path)));
    expect(region.zips.length).toBe(ref!.zips);
    expect(region.cities.map((c) => c.name)).toContain('Irvine');
    expect(region.dates).toHaveLength(36);
    const geo = RegionGeometrySchema.parse(JSON.parse(read(ref!.geometry!)));
    expect(geo.features.filter((f) => (f.properties as { kind: string }).kind === 'zip').length).toBeGreaterThan(80);
  });

  it('loaders return null for a missing or malformed file instead of failing', async () => {
    clearCache();
    const fetcher = vi.fn(async (url: string) => (String(url).includes('.geo.') ? new Response('{"type":"nope"}', { status: 200 }) : new Response('', { status: 404 })));
    expect(await loadRegion('orange-county', fetcher as unknown as typeof fetch)).toBeNull();
    expect(await loadRegionGeometry('orange-county', fetcher as unknown as typeof fetch)).toBeNull();
    expect(await loadRegion('../etc', fetcher as unknown as typeof fetch)).toBeNull();
  });
});
