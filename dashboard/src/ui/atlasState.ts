import { useState } from 'react';

export const ATLAS_NAV = [
  { to: '/explore', label: 'Atlas' },
  { to: '/', label: 'Brief', end: true },
  { to: '/compare', label: 'Compare' },
  { to: '/methodology', label: 'Method' },
] as const;

const MEDIA_KEY = 'mp-media-paused';

/** Whether decorative background motion is paused (the command bar's media toggle), persisted per viewer. */
export function useMediaPaused(): [boolean, (v: boolean) => void] {
  const [paused, setPaused] = useState(() => {
    try {
      return localStorage.getItem(MEDIA_KEY) === '1';
    } catch {
      return false;
    }
  });
  const set = (v: boolean) => {
    setPaused(v);
    try {
      localStorage.setItem(MEDIA_KEY, v ? '1' : '0');
    } catch {
      // private mode: the choice just won't persist
    }
  };
  return [paused, set];
}
