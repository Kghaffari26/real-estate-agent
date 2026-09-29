import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCache, DataError, dataUrl, isValidSlug, loadDataSource, loadIndex, loadMetro } from './api';

function response(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

beforeEach(() => clearCache());

describe('api', () => {
  it('builds versioned URLs under the base path', () => {
    expect(dataUrl('latest.json')).toMatch(/\/data\/latest\.json\?v=[0-9a-z]+$/);
    expect(dataUrl('metros/austin-tx.json', 'abc123')).toMatch(/\/data\/metros\/austin-tx\.json\?v=abc123$/);
  });

  it('fetches with the build\'s data version so a deploy never pairs with stale cached JSON', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ source: 'sample' }));
    await loadDataSource(fetcher);
    expect(String(fetcher.mock.calls[0]![0])).toMatch(/source\.json\?v=/);
  });

  it('validates slugs', () => {
    expect(isValidSlug('st-louis-mo')).toBe(true);
    expect(isValidSlug('../etc')).toBe(false);
    expect(isValidSlug(undefined)).toBe(false);
  });

  it('rejects bad slugs without fetching', async () => {
    const fetcher = vi.fn();
    await expect(loadMetro('../x', fetcher)).rejects.toMatchObject({ kind: 'not_found' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('maps HTTP and JSON failures to DataError kinds', async () => {
    await expect(loadMetro('nowhere-xx', vi.fn().mockResolvedValue(response('', 404)))).rejects.toMatchObject({ kind: 'not_found' });
    clearCache();
    await expect(loadIndex(vi.fn().mockResolvedValue(response('<html>', 200)))).rejects.toBeInstanceOf(DataError);
    clearCache();
    await expect(loadIndex(vi.fn().mockRejectedValue(new TypeError('offline')))).rejects.toMatchObject({ kind: 'network' });
    clearCache();
    await expect(loadIndex(vi.fn().mockResolvedValue(response({ nope: true })))).rejects.toMatchObject({ kind: 'invalid' });
  });

  it("doesn't cache failures", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response('', 500)).mockResolvedValueOnce(response('', 404));
    await expect(loadIndex(fetcher)).rejects.toMatchObject({ kind: 'network' });
    await expect(loadIndex(fetcher)).rejects.toMatchObject({ kind: 'not_found' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('treats a missing source.json as unknown', async () => {
    await expect(loadDataSource(vi.fn().mockResolvedValue(response('', 404)))).resolves.toBeNull();
    clearCache();
    await expect(loadDataSource(vi.fn().mockResolvedValue(response({ source: 'sample' })))).resolves.toMatchObject({ source: 'sample' });
  });
});
