import type { ReactNode } from 'react';
import { MiniSpark, TrendGlyph } from './dataviz';

export interface InstrumentProps {
  label: string;
  value: string;
  /** Formatted YoY change, and its direction for color (cool < 0 < hot). */
  yoy: string;
  yoySign: -1 | 0 | 1;
  mom?: string;
  trend?: string | null;
  series?: readonly (number | null)[];
  /** "36-mo high" / "36-mo low" marker text when the latest value is one. */
  extreme?: string | null;
  wide?: boolean;
  highlighted?: boolean;
  id?: string;
  children?: ReactNode;
}

/**
 * One gauge in the dossier's instrument cluster: value, YoY, MoM, a 3-month trend
 * glyph, the 36-month extreme and a sparkline. Instruments sit in one panel divided
 * by hairlines, never as a grid of separate cards (anti-slop #1).
 */
export function Instrument({ label, value, yoy, yoySign, mom, trend, series, extreme, wide = false, highlighted = false, id }: InstrumentProps) {
  const tone = yoySign > 0 ? 'text-mp-hot-2' : yoySign < 0 ? 'text-mp-cool-2' : 'text-mp-ink-2';
  return (
    <div
      id={id}
      className={`relative min-w-0 px-4 pb-3 pt-3.5 transition-colors duration-panel ease-mp ${wide ? 'basis-[212px]' : 'basis-[132px]'} flex-none ${
        highlighted ? 'bg-mp-accent/[.08] shadow-[inset_0_2px_0_rgb(var(--mp-accent))]' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="mp-label truncate text-[11px]">{label}</span>
        <TrendGlyph trend={trend} />
      </div>
      <div className={`mp-num-hero mt-1 whitespace-nowrap ${wide ? 'text-[30px]' : 'text-[21px]'}`}>{value}</div>
      <div className="mp-num whitespace-nowrap text-xs">
        <span className={tone}>{yoy}</span> <span className="font-ui text-mp-ink-3">YoY</span>
        {mom && <span className="ml-2 text-mp-ink-3">{mom} MoM</span>}
      </div>
      {series && (
        <div className="mt-2">
          <MiniSpark values={series} width={wide ? 184 : 104} />
        </div>
      )}
      {extreme && <span className="mp-label mt-1 block text-[10px] text-mp-accent">{extreme}</span>}
    </div>
  );
}
