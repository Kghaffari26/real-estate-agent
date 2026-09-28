import { color } from '../../lib/tokens';

export interface ComponentBar {
  key: string;
  label: string;
  /** Signed contribution to the score (z × sign): positive = hotter. */
  contribution: number | null;
  z: number | null;
  /** Plain-language reading, e.g. "Homes sell faster than most metros". */
  reading: string;
}

/**
 * Diverging bars centered at zero: bars right of the axis push the score up (hotter),
 * left pull it down. Hotter uses the red arm, cooler the blue arm of the diverging scale.
 */
export function TemperatureComponents({ bars }: { bars: readonly ComponentBar[] }) {
  const max = Math.max(1.5, ...bars.map((b) => Math.abs(b.contribution ?? 0)));
  return (
    <div>
      <div className="mb-2 flex justify-between text-2xs font-medium uppercase tracking-wider text-text-3" aria-hidden="true">
        <span>← Cooler</span>
        <span>Hotter →</span>
      </div>
      <ul className="space-y-3">
        {bars.map((b) => {
          const c = b.contribution;
          const width = c === null ? 0 : (Math.abs(c) / max) * 50;
          return (
            <li key={b.key}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium text-text">{b.label}</span>
                <span className="num text-xs text-text-3">z {b.z === null ? '—' : (b.z > 0 ? '+' : '') + b.z.toFixed(2)}</span>
              </div>
              <div className="relative mt-1 h-2.5 rounded-full bg-surface-3" aria-hidden="true">
                <div className="absolute inset-y-[-3px] left-1/2 w-px bg-border-strong" />
                {c !== null && (
                  <div
                    className="absolute inset-y-0 rounded-full"
                    // Bar geometry and color encode the value: data-driven inline styles.
                    style={{
                      width: `${width}%`,
                      left: c >= 0 ? '50%' : `${50 - width}%`,
                      background: color(c >= 0 ? 'div-pos-2' : 'div-neg-2'),
                    }}
                  />
                )}
              </div>
              <p className="mt-1 text-xs text-text-3">{b.reading}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
