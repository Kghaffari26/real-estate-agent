/**
 * The shared time index (spec §6: one `timeIndex` store that the scrubber, the
 * columns, the charts and the announcements read). The URL's `?t=YYYY-MM` is the
 * shareable copy; this store is the fast one that playback ticks.
 */
import { createStore, useStore } from 'zustand';

export type Speed = '1' | '4';

export interface TimeState {
  /** Months on the axis (0 before data arrives). */
  count: number;
  index: number;
  playing: boolean;
  speed: Speed;
  setCount: (count: number, index?: number) => void;
  setIndex: (index: number) => void;
  /** Move by `delta` months; playback wraps to the start, manual steps stop at the ends. */
  step: (delta: number, wrap?: boolean) => void;
  setPlaying: (playing: boolean) => void;
  togglePlaying: () => void;
  setSpeed: (speed: Speed) => void;
}

const clamp = (i: number, count: number) => (count <= 0 ? 0 : Math.min(count - 1, Math.max(0, Math.round(i))));

export const createTimeStore = () =>
  createStore<TimeState>((set, get) => ({
    count: 0,
    index: 0,
    playing: false,
    speed: '1',
    setCount: (count, index) => set({ count, index: clamp(index ?? count - 1, count) }),
    setIndex: (index) => set({ index: clamp(index, get().count) }),
    step: (delta, wrap = false) => {
      const { index, count } = get();
      if (count <= 0) return;
      const next = index + delta;
      if (wrap && next > count - 1) set({ index: 0 });
      else if (wrap && next < 0) set({ index: count - 1 });
      else set({ index: clamp(next, count) });
    },
    setPlaying: (playing) => {
      // Playing from the last month restarts from the first.
      if (playing && get().index >= get().count - 1) set({ index: 0 });
      set({ playing });
    },
    togglePlaying: () => get().setPlaying(!get().playing),
    setSpeed: (speed) => set({ speed }),
  }));

export const timeStore = createTimeStore();

export function useTime<T>(selector: (s: TimeState) => T): T {
  return useStore(timeStore, selector);
}

/** Milliseconds per month during playback. */
export const TICK_MS: Record<Speed, number> = { '1': 700, '4': 175 };
