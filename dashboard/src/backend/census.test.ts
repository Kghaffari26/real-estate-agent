import { describe, expect, it } from 'vitest';
import { censusUrl, cleanAddress, parseCensus } from '../../../supabase/functions/_shared/census.ts';
import irvine from './fixtures/census-irvine.json';

describe('the Census geocoder (shared with the geocode Edge Function)', () => {
  it('parses a real response into the fields intake stores', () => {
    expect(parseCensus(irvine)).toEqual([
      {
        matchedAddress: '1 CIVIC CENTER PLZ, IRVINE, CA, 92606',
        lat: expect.closeTo(33.6875, 3),
        lon: expect.closeTo(-117.8263, 3),
        zip: '92606',
        city: 'Irvine',
        state: 'CA',
        tract: '06059052521',
        countyFips: '06059',
        placeId: '0636770', // the region data's city id for Irvine
        placeName: 'Irvine',
      },
    ]);
  });

  it('prefers an incorporated city, falls back to a census-designated place, and tolerates gaps', () => {
    const m = {
      matchedAddress: '1 X ST, COTO DE CAZA, CA, 92679',
      coordinates: { x: -117.58, y: 33.6 },
      addressComponents: { zip: '92679', city: 'COTO DE CAZA', state: 'CA' },
      geographies: { 'Census Designated Places': [{ GEOID: '0616532', BASENAME: 'Coto de Caza' }] },
    };
    expect(parseCensus({ result: { addressMatches: [m] } })[0]).toMatchObject({ placeId: '0616532', city: 'Coto De Caza', tract: null, countyFips: null });
    expect(parseCensus({ result: { addressMatches: [{ ...m, coordinates: {} }] } })).toEqual([]);
    expect(parseCensus({ result: { addressMatches: [] } })).toEqual([]);
    expect(() => parseCensus({ errors: ['bad'] })).toThrow(/unexpected/);
  });

  it('cleans input and builds the request', () => {
    expect(cleanAddress('  1   Civic Center Plaza,  Irvine ')).toBe('1 Civic Center Plaza, Irvine');
    for (const bad of [null, 42, 'Irvine', '12345', 'x'.repeat(201)]) expect(cleanAddress(bad)).toBeNull();
    const url = new URL(censusUrl('1 Civic Center Plaza, Irvine, CA'));
    expect(url.searchParams.get('address')).toBe('1 Civic Center Plaza, Irvine, CA');
    expect(url.searchParams.get('layers')).toBe('Census Tracts,Counties,Incorporated Places,Census Designated Places');
  });
});
