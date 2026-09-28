import { useEffect, useRef, useState } from 'react';

/**
 * True once the element comes within `rootMargin` of the viewport (then stays true).
 * Used to defer heavy chunks (Recharts, MapLibre) until they're about to be seen.
 * Without IntersectionObserver (tests, old browsers) it's true immediately.
 */
export function useInView<T extends Element>(rootMargin = '400px'): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (seen || !ref.current) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setSeen(true);
        io.disconnect();
      }
    }, { rootMargin });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen, rootMargin]);
  return [ref, seen];
}
