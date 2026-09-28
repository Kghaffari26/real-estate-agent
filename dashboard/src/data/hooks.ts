import { loadDataSource, loadIndex, loadManifest, loadMetro } from './api';
import { useResource } from './useResource';

export const useIndex = () => useResource('index', () => loadIndex());
export const useMetro = (slug: string) => useResource(`metro:${slug}`, () => loadMetro(slug));
export const useManifest = () => useResource('manifest', () => loadManifest());
export const useDataSource = () => useResource('source', () => loadDataSource());

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
