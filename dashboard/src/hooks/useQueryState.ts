import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * A single URL query parameter as state, so every view setting is deep-linkable.
 * Values outside `allowed` (when given) fall back to `fallback`. Setting the fallback
 * removes the parameter to keep URLs short. Updates replace the history entry.
 */
export function useQueryState<T extends string = string>(
  key: string,
  fallback: NoInfer<T>,
  allowed?: readonly T[],
): [T, (value: T) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get(key);
  const value = raw !== null && (!allowed || (allowed as readonly string[]).includes(raw)) ? (raw as T) : fallback;

  const setValue = useCallback(
    (next: T) => {
      setParams(
        (prev) => {
          const updated = new URLSearchParams(prev);
          if (next === fallback || next === '') updated.delete(key);
          else updated.set(key, next);
          return updated;
        },
        { replace: true },
      );
    },
    [key, fallback, setParams],
  );

  return [value, setValue];
}

/** A comma-separated list parameter (e.g. ?m=a,b,c). */
export function useQueryList(key: string, max?: number): [string[], (values: string[]) => void] {
  const [params, setParams] = useSearchParams();
  const values = (params.get(key) ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .filter((v, i, all) => all.indexOf(v) === i)
    .slice(0, max);

  const setValues = useCallback(
    (next: string[]) => {
      setParams(
        (prev) => {
          const updated = new URLSearchParams(prev);
          const list = next.slice(0, max);
          if (list.length) updated.set(key, list.join(','));
          else updated.delete(key);
          return updated;
        },
        { replace: true },
      );
    },
    [key, max, setParams],
  );

  return [values, setValues];
}

/**
 * Set several parameters in one navigation. Needed because two `useQueryState`
 * setters called in the same handler each start from the same snapshot, so the
 * second would overwrite the first.
 */
/** The hash router's current query, read from the address bar (null outside a hash route, e.g. tests with a memory router). */
function liveHashSearch(): string | null {
  if (typeof window === 'undefined' || !window.location.hash.startsWith('#/')) return null;
  const q = window.location.hash.indexOf('?');
  return q < 0 ? '' : window.location.hash.slice(q + 1);
}

export function useSetQuery(): (updates: Record<string, string | null>) => void {
  const [, setParams] = useSearchParams();
  return useCallback(
    (updates) => {
      setParams(
        (prev) => {
          // Merge into the live URL, not this render's copy: two writes in one tick (a click
          // that sets ?city= and a camera jump whose moveend writes ?cam= synchronously) would
          // otherwise start from the same stale snapshot and the second would drop the first.
          const next = new URLSearchParams(liveHashSearch() ?? prev);
          for (const [key, value] of Object.entries(updates)) {
            if (value === null || value === '') next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
}
