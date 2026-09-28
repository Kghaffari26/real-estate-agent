import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/** The full shareable URL for the current view, optionally pointing at a section. */
export function shareUrl(pathname: string, search: string, section?: string): string {
  const params = new URLSearchParams(search);
  if (section) params.set('section', section);
  else params.delete('section');
  const query = params.toString();
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}#${pathname}${query ? `?${query}` : ''}`;
}

/** Scroll to `?section=<id>` once the section has rendered (data loads async). */
export function useScrollToSection() {
  const { search, pathname } = useLocation();
  useEffect(() => {
    const id = new URLSearchParams(search).get('section');
    if (!id) return;
    let frame = 0;
    const started = performance.now();
    const tick = () => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ block: 'start' });
        return;
      }
      if (performance.now() - started < 4000) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // Only on navigation, not on every control change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
}
