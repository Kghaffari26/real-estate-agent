import { describe, expect, it } from 'vitest';
import { paletteResults } from './palette';
import { matchRegions, regionBySlug } from './regions';

describe('regions', () => {
  it('finds Orange County by name, alias or a word prefix', () => {
    for (const q of ['orange', 'OC', 'irvine', 'newport', 'county']) expect(matchRegions(q).map((r) => r.slug), q).toEqual(['orange-county']);
    expect(matchRegions('denver')).toEqual([]);
    expect(regionBySlug('orange-county')?.metros).toEqual(['anaheim-ca']);
    expect(regionBySlug('nowhere')).toBeNull();
  });

  it('puts matching regions first in the command palette, linking to the framed atlas', () => {
    const [first] = paletteResults('irvine', [{ slug: 'anaheim-ca', name: 'Anaheim, CA' }]);
    expect(first).toMatchObject({ group: 'Regions', label: 'Orange County, CA', to: '/explore?region=orange-county' });
  });
});
