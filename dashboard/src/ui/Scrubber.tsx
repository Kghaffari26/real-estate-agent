import { Pause, Play } from 'lucide-react';
import { useId } from 'react';
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
      </div>
      <div className="relative min-w-0 flex-1 pt-6">
        {/* moments rail */}
        <div className="absolute inset-x-0 top-0 h-5">
          {events.map((e) => {
            const right = e.index > last / 2;
            // A featured label yields (to a dot + tooltip) when the next featured one is too close.
            const featured = events.filter((x) => x.showLabel !== false).sort((a, b) => a.index - b.index);
            const next = featured[featured.indexOf(e) + 1];
            const crowded = e.showLabel !== false && next !== undefined && (next.index - e.index) / last < 0.32;
            return (
              <button
                key={`${e.kind}-${e.index}`}
                type="button"
                onClick={() => onChange(e.index)}
                // The dot sits on its month; a label hangs off it toward the middle of the rail.
                className={`absolute top-0 flex items-center gap-1.5 whitespace-nowrap text-xs text-mp-ink-2 hover:text-mp-ink ${e.showLabel !== false && !crowded ? 'z-10' : ''} ${right ? 'flex-row-reverse -translate-x-[calc(100%-5px)]' : '-translate-x-[5px]'}`}
                style={{ left: pct(e.index) }}
                aria-label={`Jump to ${e.label}`}
                title={e.label}
              >
                <span className={`h-2.5 w-2.5 flex-none rounded-full border-[1.5px] ${e.kind === 'high' ? 'border-mp-hot-2' : 'border-mp-cool-2'}`} aria-hidden="true" />
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
