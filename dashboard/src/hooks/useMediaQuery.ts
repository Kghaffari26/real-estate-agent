import { useEffect, useState } from 'react';

export function useMediaQuery(query: string, fallback = false): boolean {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : fallback);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export const useIsMobile = () => useMediaQuery('(max-width: 767px)');
export const usePrefersReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');
export const useIsDark = () => {
  // The theme class on <html> is the source of truth (it follows the toggle and the OS).
  const [dark, setDark] = useState(() => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setDark(el.classList.contains('dark')));
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
};
