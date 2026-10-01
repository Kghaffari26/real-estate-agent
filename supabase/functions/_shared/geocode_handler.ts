// The geocode function's logic, without Deno or network specifics (unit-tested from the
// dashboard): validate the address, count it against the caller's limits and read the
// cache (geocode_gate, as the caller), else ask the Census geocoder and cache the answer
// (geocode_store, service role). A geocoder failure is never cached.
import { cleanAddress, parseCensus, type GeocodeMatch } from './census.ts';

export interface Gate {
  allowed: boolean;
  cached?: GeocodeMatch[] | null;
  retry_after?: number;
}

export interface GeocodeDeps {
  /** geocode_gate(key) as the signed-in caller; throws if the caller isn't signed in. */
  gate(key: string): Promise<Gate>;
  /** geocode_store(key, matches) with the service role; may be a no-op without a key. */
  store(key: string, matches: GeocodeMatch[]): Promise<void>;
  /** The Census geocoder's JSON for an address. */
  census(address: string): Promise<unknown>;
}

export interface Reply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

/** The cache key: the cleaned address, lowercased, without trailing punctuation. */
export const cacheKey = (address: string) => address.toLowerCase().replace(/[.,;\s]+$/, '');

export async function handleGeocode(input: unknown, deps: GeocodeDeps): Promise<Reply> {
  const address = cleanAddress((input as { address?: unknown } | null)?.address);
  if (!address) return { status: 400, body: { error: 'invalid_address' } };
  const key = cacheKey(address);

  let gate: Gate;
  try {
    gate = await deps.gate(key);
  } catch {
    return { status: 401, body: { error: 'sign_in_required' } };
  }
  if (!gate.allowed) {
    const retry = gate.retry_after ?? 60;
    return { status: 429, body: { error: 'rate_limited', retry_after: retry }, headers: { 'Retry-After': String(retry) } };
  }
  if (Array.isArray(gate.cached)) return { status: 200, body: { matches: gate.cached }, headers: { 'X-Geocode-Cache': 'hit' } };

  let matches: GeocodeMatch[];
  try {
    matches = parseCensus(await deps.census(address));
  } catch {
    return { status: 502, body: { error: 'geocoder_unavailable' } };
  }
  try {
    await deps.store(key, matches);
  } catch {
    // A cache write failing never fails the lookup.
  }
  return { status: 200, body: { matches }, headers: { 'X-Geocode-Cache': 'miss' } };
}
