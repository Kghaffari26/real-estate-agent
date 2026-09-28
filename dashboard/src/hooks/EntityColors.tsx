import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CATEGORICAL, type ColorToken } from '../lib/tokens';

/**
 * Color follows the entity: a metro keeps its categorical slot for the whole
 * session (Compare, its own page, the compare chips), and removing one metro never
 * repaints the others. Slots are handed out first-free in the validated order.
 */
interface EntityColorApi {
  colorFor: (slug: string) => ColorToken;
  /** Assign slots to `slugs` (in order) and free slots held by metros no longer shown. */
  sync: (slugs: readonly string[]) => void;
  peek: (slug: string) => ColorToken | undefined;
}

const Ctx = createContext<EntityColorApi | null>(null);

export function assignSlots(previous: ReadonlyMap<string, number>, slugs: readonly string[], slots: number): Map<string, number> {
  const next = new Map<string, number>();
  for (const slug of slugs) {
    const held = previous.get(slug);
    if (held !== undefined && ![...next.values()].includes(held)) next.set(slug, held);
  }
  for (const slug of slugs) {
    if (next.has(slug)) continue;
    const used = new Set(next.values());
    let slot = 0;
    while (used.has(slot) && slot < slots - 1) slot++;
    next.set(slug, slot);
  }
  return next;
}

export function EntityColorsProvider({ children }: { children: ReactNode }) {
  const ref = useRef(new Map<string, number>());
  const [, force] = useState(0);
  const sync = useCallback((slugs: readonly string[]) => {
    const next = assignSlots(ref.current, slugs, CATEGORICAL.length);
    const changed = next.size !== ref.current.size || [...next].some(([k, v]) => ref.current.get(k) !== v);
    if (changed) {
      ref.current = next;
      force((n) => n + 1);
    }
  }, []);
  const api = useMemo<EntityColorApi>(
    () => ({
      colorFor: (slug) => CATEGORICAL[ref.current.get(slug) ?? 0]!,
      peek: (slug) => {
        const slot = ref.current.get(slug);
        return slot === undefined ? undefined : CATEGORICAL[slot];
      },
      sync,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sync, ref.current],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useEntityColors(): EntityColorApi {
  const ctx = useContext(Ctx);
  if (ctx) return ctx;
  return { colorFor: () => CATEGORICAL[0]!, peek: () => undefined, sync: () => {} };
}
