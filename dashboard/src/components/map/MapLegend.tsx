import { color, type ColorToken } from '../../lib/tokens';

export interface LegendStep {
  color: ColorToken;
  label: string;
}

/** Diverging color steps plus a bubble-size key. */
export function MapLegend({ title, steps, sizes }: { title: string; steps: readonly LegendStep[]; sizes?: readonly { r: number; label: string }[] }) {
  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-3 text-xs">
      <div>
        <p className="mb-1.5 font-medium text-text-2">{title}</p>
        <ol className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {steps.map((s) => (
            <li key={s.label} className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full ring-1 ring-inset ring-border" style={{ background: color(s.color) }} aria-hidden="true" />
              <span className="num text-text-2">{s.label}</span>
            </li>
          ))}
        </ol>
      </div>
      {sizes && sizes.length > 0 && (
        <div>
          <p className="mb-1.5 font-medium text-text-2">Size: homes sold (12 mo)</p>
          <ul className="flex items-end gap-3">
            {sizes.map((s) => (
              <li key={s.label} className="flex items-center gap-1.5">
                <svg width={s.r * 2 + 2} height={s.r * 2 + 2} aria-hidden="true">
                  <circle cx={s.r + 1} cy={s.r + 1} r={s.r} fill="none" stroke={color('text-3')} strokeWidth="1" />
                </svg>
                <span className="num text-text-2">{s.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
