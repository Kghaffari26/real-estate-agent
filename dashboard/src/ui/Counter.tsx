import { useEffect, useRef, useState } from 'react';
import { usePrefersReducedMotion } from '../hooks/useMediaQuery';
import { DUR, easeOutCubic } from '../motion/presets';

interface CounterProps {
  value: number | null | undefined;
  format: (v: number | null | undefined) => string;
  /** Where the count starts, as a share of the value (0 counts from zero). */
  from?: number;
  durationMs?: number;
  className?: string;
}

/**
 * A number that counts up once when it mounts or its value changes (600–900 ms,
 * eased). Screen readers get only the final value; under reduced motion it never
 * animates. Formatting always goes through the same formatter, so every frame of
 * the animation is a correctly formatted number.
 */
export function Counter({ value, format, from = 0, durationMs = DUR.count * 1000, className = '' }: CounterProps) {
  const reduce = usePrefersReducedMotion();
  const final = format(value);
  const animate = !reduce && typeof value === 'number' && Number.isFinite(value) && typeof requestAnimationFrame !== 'undefined';
  const [shown, setShown] = useState(() => (animate ? format((value as number) * from) : final));
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (!animate) {
      setShown(final);
      return;
    }
    const target = value as number;
    const start = last.current ?? target * from;
    last.current = target;
    if (start === target) {
      setShown(final);
      return;
    }
    const t0 = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min((now - t0) / durationMs, 1);
      setShown(t < 1 ? format(start + (target - start) * easeOutCubic(t)) : final);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // format is a stable module function in practice; re-running on it would restart the count
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, animate, final, durationMs, from]);

  return (
    <span className={className}>
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{final}</span>
    </span>
  );
}
