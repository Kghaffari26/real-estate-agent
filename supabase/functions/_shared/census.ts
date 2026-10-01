// The Census Bureau geocoder, as the Desk's intake uses it (SPEC_LISTING_PREP.md §4 step 1).
// Pure: no Deno or browser APIs, so the Edge Function and the dashboard's tests share it.
// The geocoder sends no CORS headers, which is why the browser reaches it through the
// `geocode` Edge Function instead of directly.

export const CENSUS_URL = 'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress';
const LAYERS = ['Census Tracts', 'Counties', 'Incorporated Places', 'Census Designated Places'];

export interface GeocodeMatch {
  /** The address as the Census Bureau matched it, e.g. "1 CIVIC CENTER PLZ, IRVINE, CA, 92606". */
  matchedAddress: string;
  lat: number;
  lon: number;
  zip: string | null;
  /** The mailing city, title-cased ("Irvine"). */
  city: string | null;
  state: string | null;
  /** 11-digit census tract GEOID. */
  tract: string | null;
  /** 5-digit county FIPS ("06059" = Orange County). */
  countyFips: string | null;
  /** 7-digit place GEOID (a city, or a census-designated place), as the region data uses. */
  placeId: string | null;
  placeName: string | null;
}

/** Normalized address input, or null if it can't be a street address. */
export function cleanAddress(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/\s+/g, ' ').trim();
  if (s.length < 6 || s.length > 200 || !/\d/.test(s) || !/[a-z]/i.test(s)) return null;
  return s;
}

export function censusUrl(address: string): string {
  const q = new URLSearchParams({ address, benchmark: 'Public_AR_Current', vintage: 'Current_Current', layers: LAYERS.join(','), format: 'json' });
  return `${CENSUS_URL}?${q}`;
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
type Geo = Record<string, Array<Record<string, unknown>> | undefined>;

/** The geocoder's matches, best first (at most 5). Throws on a response that isn't the geocoder's. */
export function parseCensus(body: unknown): GeocodeMatch[] {
  const matches = (body as { result?: { addressMatches?: unknown } })?.result?.addressMatches;
  if (!Array.isArray(matches)) throw new Error('unexpected geocoder response');
  return matches.slice(0, 5).flatMap((m): GeocodeMatch[] => {
    const lon = Number(m?.coordinates?.x);
    const lat = Number(m?.coordinates?.y);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    const geo: Geo = m.geographies ?? {};
    const first = (layer: string) => geo[layer]?.[0];
    const place = first('Incorporated Places') ?? first('Census Designated Places');
    const comp = m.addressComponents ?? {};
    const zip = str(comp.zip);
    return [
      {
        matchedAddress: String(m.matchedAddress ?? ''),
        lat,
        lon,
        zip: zip && /^\d{5}$/.test(zip) ? zip : null,
        city: str(comp.city) ? titleCase(comp.city) : null,
        state: str(comp.state),
        tract: str(first('Census Tracts')?.GEOID),
        countyFips: str(first('Counties')?.GEOID),
        placeId: str(place?.GEOID),
        placeName: str(place?.BASENAME),
      },
    ];
  });
}
