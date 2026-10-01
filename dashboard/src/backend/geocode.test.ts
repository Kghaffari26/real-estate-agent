import { describe, expect, it, vi } from 'vitest';
import { cacheKey, handleGeocode, type GeocodeDeps } from '../../../supabase/functions/_shared/geocode_handler.ts';
import irvine from './fixtures/census-irvine.json';

const deps = (over: Partial<GeocodeDeps> = {}): GeocodeDeps & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    gate: vi.fn(async () => ({ allowed: true, cached: null })),
    store: vi.fn(async () => undefined),
    census: vi.fn(async (a: string) => {
      calls.push(a);
      return irvine;
    }),
    ...over,
  };
};

describe('the geocode function', () => {
  it('asks Census on a miss and caches the answer under a normalized key', async () => {
    const d = deps();
    const r = await handleGeocode({ address: '  1 Civic Center  Plaza, Irvine, CA. ' }, d);
    expect(r).toMatchObject({ status: 200, headers: { 'X-Geocode-Cache': 'miss' } });
    expect((r.body as { matches: unknown[] }).matches).toHaveLength(1);
    expect(d.gate).toHaveBeenCalledWith('1 civic center plaza, irvine, ca');
    expect(d.store).toHaveBeenCalledWith('1 civic center plaza, irvine, ca', expect.any(Array));
    expect(d.calls).toEqual(['1 Civic Center Plaza, Irvine, CA.']);
  });

  it('serves a cached answer (including “no match”) without calling Census', async () => {
    const d = deps({ gate: vi.fn(async () => ({ allowed: true, cached: [] })) });
    expect(await handleGeocode({ address: '27702 Crown Valley Pkwy' }, d)).toEqual({ status: 200, body: { matches: [] }, headers: { 'X-Geocode-Cache': 'hit' } });
    expect(d.calls).toEqual([]);
  });

  it('refuses over the limit with Retry-After, before any Census call', async () => {
    const d = deps({ gate: vi.fn(async () => ({ allowed: false, retry_after: 60 })) });
    expect(await handleGeocode({ address: '1 Civic Center Plaza' }, d)).toEqual({ status: 429, body: { error: 'rate_limited', retry_after: 60 }, headers: { 'Retry-After': '60' } });
    expect(d.calls).toEqual([]);
  });

  it('never caches a geocoder failure; a cache-write failure doesn’t fail the lookup', async () => {
    const down = deps({ census: vi.fn(async () => ({ errors: ['down'] })) });
    expect((await handleGeocode({ address: '1 Civic Center Plaza' }, down)).status).toBe(502);
    expect(down.store).not.toHaveBeenCalled();
    const noCache = deps({ store: vi.fn(async () => Promise.reject(new Error('no key'))) });
    expect((await handleGeocode({ address: '1 Civic Center Plaza' }, noCache)).status).toBe(200);
  });

  it('rejects bad input and unsigned callers without touching the limits or Census', async () => {
    const d = deps();
    expect((await handleGeocode({ address: 'Irvine' }, d)).status).toBe(400);
    expect((await handleGeocode(null, d)).status).toBe(400);
    expect(d.gate).not.toHaveBeenCalled();
    expect((await handleGeocode({ address: '1 Civic Center Plaza' }, deps({ gate: vi.fn(async () => Promise.reject(new Error('401'))) }))).status).toBe(401);
    expect(cacheKey('1 Main St, Irvine, CA.,')).toBe('1 main st, irvine, ca');
  });
});
