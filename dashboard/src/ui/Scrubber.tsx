import { Pause, Play } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { thinMoments } from '../lib/moments';
import { Segmented } from './controls';

export interface ScrubberEvent {
  index: number;
  kind: 'high' | 'low';
  label: string;
  /** Show the label on the rail (others show it on hover/focus). Keep to two or three so they never collide. */
  showLabel?: boolean;
}

interface ScrubberProps {
  /** Month-end ISO dates, oldest first. */
  dates: readonly string[];
  index: number;
  onChange: (index: number) => void;
  playing: boolean;
  onPlayToggle: () => void;
  speed: '1' | '4';
  onSpeedChange: (speed: '1' | '4') => void;
  events?: readonly ScrubberEvent[];
  /** Formats a date for the thumb's accessible value and the tick labels. */
  formatDate: (iso: string) => string;
  /** Sentence announced politely when the month changes (e.g. the selected metro's value). */
  announcement?: string;
  className?: string;
}

/**
 * The time machine's scrubber: a native range over the months (so arrows, Home/End
 * and screen readers work), year ticks, a "moments" rail of rate highs and lows that
 * jump the scrubber when clicked, play/pause and a speed switch.
 */
export function Scrubber({ dates, index, onChange, playing, onPlayToggle, speed, onSpeedChange, events = [], formatDate, announcement, className = '' }: ScrubberProps) {
  const id = useId();
  const last = Math.max(dates.length - 1, 1);
  const pct = (i: number) => `${((i / last) * 100).toFixed(3)}%`;
  const firstYear = Number(dates[0]?.slice(0, 4) ?? 0);
  const yearStep = Number(dates[dates.length - 1]?.slice(0, 4) ?? 0) - firstYear > 9 ? 2 : 1;
  const railRef = useRef<HTMLDivElement>(null);
  const [railWidth, setRailWidth] = useState(0);
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRailWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const shown = thinMoments(events, last, railWidth);
  return (
    <div className={`flex items-center gap-4 ${className}`}>
      <div className="flex flex-none flex-col items-center gap-1.5">
        <button
          type="button"
          onClick={onPlayToggle}
          aria-label={playing ? 'Pause the time machine' : 'Play the time machine'}
          className="grid h-11 w-11 place-items-center rounded-full bg-mp-accent text-mp-accent-ink shadow-[var(--mp-glow)] transition-transform duration-micro ease-mp active:scale-95"
        >
          {playing ? <Pause size={18} strokeWidth={1.5} aria-hidden="true" /> : <Play size={18} strokeWidth={1.5} aria-hidden="true" />}
        </button>
        <Segmented
          size="sm"
          label="Playback speed"
          value={speed}
          onChange={onSpeedChange}
          options={[
            { value: '1', label: '1×' },
            { value: '4', label: '4×' },
          ]}
        />
        {events.length > 0 && (
          <select
            aria-label="Jump to a moment"
            className="w-[86px] rounded-control border border-mp-line bg-mp-panel px-1 py-0.5 text-[11px] text-mp-ink-2"
            value=""
            onChange={(e) => e.target.value !== '' && onChange(Number(e.target.value))}
          >
            <option value="">Moments</option>
            {events.map((e) => (
              <option key={`${e.kind}-${e.index}-${e.label}`} value={e.index}>
                {e.label}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="relative min-w-0 flex-1 pt-6">
        {/* moments rail: markers thinned to 24 px targets; every moment is also in the menu */}
        <div ref={railRef} className="absolute inset-x-0 -top-1 h-6">
          {shown.map((e) => {
            const right = e.index > last / 2;
            // A featured label yields (to a dot + tooltip) when the next featured one is too close.
            const featured = shown.filter((x) => x.showLabel !== false).sort((a, b) => a.index - b.index);
            const next = featured[featured.indexOf(e) + 1];
            const crowded = e.showLabel !== false && next !== undefined && (next.index - e.index) / last < 0.32;
            return (
              <button
                key={`${e.kind}-${e.index}`}
                type="button"
                onClick={() => onChange(e.index)}
                // The dot sits on its month; a label hangs off it toward the middle of the rail.
                className={`absolute top-0 flex h-6 items-center whitespace-nowrap text-xs text-mp-ink-2 hover:text-mp-ink ${e.showLabel !== false && !crowded ? 'z-10' : ''} ${right ? 'flex-row-reverse -translate-x-[calc(100%-12px)]' : '-translate-x-[12px]'}`}
                style={{ left: pct(e.index) }}
                aria-label={`Jump to ${e.label}`}
                title={e.label}
              >
                <span className="grid h-6 w-6 flex-none place-items-center" aria-hidden="true">
                  <span className={`h-2.5 w-2.5 rounded-full border-[1.5px] ${e.kind === 'high' ? 'border-mp-hot-2' : 'border-mp-cool-2'}`} />
                </span>
                {/* Featured labels sit on a panel-colored backing, above neighboring dots. */}
                {e.showLabel !== false && !crowded && <span className="hidden rounded bg-mp-panel px-1 sm:inline">{e.label}</span>}
              </button>
            );
          })}
        </div>
        <label htmlFor={id} className="sr-only">
          Month
        </label>
        <input
          id={id}
          type="range"
          className="mp-range mp-range-scrub w-full"
          style={{ ['--mp-pos' as string]: pct(index) }}
          min={0}
          max={dates.length - 1}
          step={1}
          value={index}
          aria-valuetext={dates[index] ? formatDate(dates[index]!) : undefined}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <div className="relative mt-1 h-4" aria-hidden="true">
          {dates.map((d, i) =>
            // Every January; every other one once the axis spans more than nine years.
            d.slice(5, 7) === '01' && (yearStep === 1 || (Number(d.slice(0, 4)) - firstYear) % yearStep === 0) ? (
              <span key={d} className="mp-num absolute -translate-x-1/2 text-[11px] text-mp-ink-3" style={{ left: pct(i) }}>
                {d.slice(0, 4)}
              </span>
            ) : null,
          )}
        </div>
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </div>
  );
}
