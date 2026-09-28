import { useEffect, useRef, useState } from 'react';
import { usePrefersReducedMotion } from '../../hooks/useMediaQuery';

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * Counts up to `value` once on mount (a ~1 KB rAF tween, so framer-motion's engine
 * stays out of the first bundle). Skipped under prefers-reduced-motion. The visible
 * number is aria-hidden; screen readers get the final formatted value at once.
 */
export function AnimatedNumber({ value, format, className = '' }: { value: number | null | undefined; format: (v: number | null | undefined) => string; className?: string }) {
  const reduce = usePrefersReducedMotion();
  const final = format(value);
  const [shown, setShown] = useState(() => (reduce || typeof value !== 'number' ? final : format(value * 0.92)));
  const done = useRef(false);

  useEffect(() => {
    if (typeof value !== 'number' || !Number.isFinite(value) || reduce || done.current || typeof requestAnimationFrame === 'undefined') {
      setShown(final);
      return;
    }
    done.current = true;
    const from = value * 0.92;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / 900, 1);
      setShown(t < 1 ? format(from + (value - from) * easeOut(t)) : final);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduce, final]);

  return (
    <span className={`num ${className}`}>
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{final}</span>
    </span>
  );
}
