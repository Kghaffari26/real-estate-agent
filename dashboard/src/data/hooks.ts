import { loadDataSource, loadEvents, loadIndex, loadManifest, loadMetro, loadPulse } from './api';
import { useResource } from './useResource';

export const useIndex = () => useResource('index', () => loadIndex());
export const useMetro = (slug: string) => useResource(`metro:${slug}`, () => loadMetro(slug));
export const useManifest = () => useResource('manifest', () => loadManifest());
export const useDataSource = () => useResource('source', () => loadDataSource());
/** §6.5 / §6.6: fetched only when the index lists the file (`listed`); null otherwise. */
export const useEvents = (listed: boolean) => useResource(`events:${listed}`, () => (listed ? loadEvents() : Promise.resolve(null)));
export const usePulse = (listed: boolean) => useResource(`pulse:${listed}`, () => (listed ? loadPulse() : Promise.resolve(null)));

export type Settled<T> = { slug: string; ok: true; data: T } | { slug: string; ok: false; error: Error };

/** Load several metros at once; one failing doesn't fail the others. */
export const useMetros = (slugs: readonly string[]) =>
  useResource(`metros:${slugs.join(',')}`, async () => {
    const results = await Promise.allSettled(slugs.map((slug) => loadMetro(slug)));
    return results.map((r, i): Settled<Awaited<ReturnType<typeof loadMetro>>> =>
      r.status === 'fulfilled'
        ? { slug: slugs[i]!, ok: true, data: r.value }
        : { slug: slugs[i]!, ok: false, error: r.reason instanceof Error ? r.reason : new Error(String(r.reason)) },
    );
  });
