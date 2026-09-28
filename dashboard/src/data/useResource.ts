import { useCallback, useEffect, useState } from 'react';

export type Resource<T> =
  | { status: 'loading'; data?: undefined; error?: undefined; retry: () => void }
  | { status: 'error'; data?: undefined; error: Error; retry: () => void }
  | { status: 'ready'; data: T; error?: undefined; retry: () => void };

/** Run an async loader keyed by `key`; re-runs when the key changes or on retry(). */
export function useResource<T>(key: string, load: () => Promise<T>): Resource<T> {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; status: 'loading' | 'error' | 'ready'; data?: T; error?: Error }>({
    key,
    status: 'loading',
  });
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    setState({ key, status: 'loading' });
    load().then(
      (data) => live && setState({ key, status: 'ready', data }),
      (error: unknown) => live && setState({ key, status: 'error', error: error instanceof Error ? error : new Error(String(error)) }),
    );
    return () => {
      live = false;
    };
    // `load` is intentionally keyed by `key`, so callers can pass inline closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  if (state.key !== key || state.status === 'loading') return { status: 'loading', retry };
  if (state.status === 'error') return { status: 'error', error: state.error!, retry };
  return { status: 'ready', data: state.data as T, retry };
}
