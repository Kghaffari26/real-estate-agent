/**
 * The payment stack (spec M6): the whole cost of the home as 2.5D blocks, down
 * payment, principal and the interest paid over the term, stacked from zero with
 * heights proportional to dollars (one shared scale, so a longer term visibly adds
 * interest). Heights ease to new values as the sliders move (instant under reduced
 * motion). Decorative: the legend beside it states every figure.
 */
import { useEffect, useRef, useState } from 'react';
import { usePrefersReducedMotion } from '../hooks/useMediaQuery';

export interface StackPart {
  key: string;
  label: string;
  value: number;
  text: string;
  /** CSS colors: front face, side face, top face. */
  front: string;
  side: string;
  top: string;
}

/** Eases a list of numbers toward targets (rAF), for the block heights. */
function useEased(targets: number[], reduce: boolean, ms = 420): number[] {
  const [values, setValues] = useState(targets);
  const from = useRef(targets);
  const key = targets.map((t) => t.toFixed(2)).join('|');
  useEffect(() => {
    if (reduce) {
      from.current = targets;
      setValues(targets);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const k = 1 - (1 - t) ** 3;
      const v = targets.map((b, i) => (a[i] ?? 0) + (b - (a[i] ?? 0)) * k);
      from.current = v;
      setValues(v);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // `key` captures the targets; the arrays themselves are recreated each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reduce]);
  return values;
}

export function PaymentStack({ parts, maxTotal, height = 260 }: { parts: readonly StackPart[]; maxTotal: number; height?: number }) {
  const reduce = usePrefersReducedMotion();
  const H = useEased(
    parts.map((p) => (maxTotal > 0 ? (p.value / maxTotal) * height : 0)),
    reduce,
  );
  const W = 92;
  const D = 92;
  const iso = (x: number, y: number, z: number) => [(x - y) * 0.866, (x + y) * 0.5 - z] as const;
  const face = (pts: Array<[number, number, number]>) => `M${pts.map((p) => iso(...p).map((v) => v.toFixed(1)).join(',')).join('L')}Z`;
  let z = 0;
  const blocks = parts.map((p, i) => {
    const h = Math.max(0, H[i] ?? 0);
    const z0 = z;
    z += h + (h > 0.5 ? 3 : 0);
    return { p, z0, h };
  });
  const top = height + 3 * parts.length + 8;
  const vbX = -D * 0.866 - 6;
  const vbW = (W + D) * 0.866 + 12;
  const vbY = -top - 4;
  const vbH = top + (W + D) * 0.5 + 8;
  return (
    <svg viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`} className="h-full w-full overflow-visible" aria-hidden="true" focusable="false" data-testid="payment-stack">
      <path d={face([[0, 0, 0], [W, 0, 0], [W, D, 0], [0, D, 0]])} style={{ fill: 'rgb(var(--mp-ink) / .05)', stroke: 'rgb(var(--mp-ink) / .15)' }} strokeDasharray="3 3" />
      {blocks.map(({ p, z0, h }) =>
        h <= 0.5 ? null : (
          <g key={p.key} data-part={p.key}>
            <path d={face([[0, D, z0], [W, D, z0], [W, D, z0 + h], [0, D, z0 + h]])} style={{ fill: p.front }} stroke="rgb(0 0 0 / .18)" strokeWidth=".8" />
            <path d={face([[W, 0, z0], [W, D, z0], [W, D, z0 + h], [W, 0, z0 + h]])} style={{ fill: p.side }} stroke="rgb(0 0 0 / .18)" strokeWidth=".8" />
            <path d={face([[0, 0, z0 + h], [W, 0, z0 + h], [W, D, z0 + h], [0, D, z0 + h]])} style={{ fill: p.top }} stroke="rgb(0 0 0 / .18)" strokeWidth=".8" />
          </g>
        ),
      )}
    </svg>
  );
}
