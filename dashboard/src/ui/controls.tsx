import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { fromPosition, toPosition, type SliderScale } from '../lib/sliderScale';

// ---------- Button ----------
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'quiet'; size?: 'md' | 'lg'; icon?: ReactNode };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'ghost', size = 'md', icon, className = '', children, type = 'button', ...rest }, ref) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-control font-medium transition-[background-color,border-color,color,transform] duration-micro ease-mp active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none';
  const sizes = size === 'lg' ? 'h-12 px-5 text-[15px]' : 'h-10 px-4 text-sm';
  const variants = {
    primary: 'bg-mp-accent text-mp-accent-ink hover:brightness-110 shadow-[var(--mp-glow)]',
    ghost: 'border border-mp-line text-mp-ink hover:bg-mp-ink/[.06]',
    quiet: 'text-mp-ink-2 hover:text-mp-ink hover:bg-mp-ink/[.06]',
  }[variant];
  return (
    <button ref={ref} type={type} className={`${base} ${sizes} ${variants} ${className}`} {...rest}>
      {icon}
      {children}
    </button>
  );
});

export function IconButton({ label, className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`grid h-9 w-9 place-items-center rounded-control border border-mp-line bg-mp-panel/60 text-mp-ink-2 transition-colors duration-micro ease-mp hover:text-mp-ink hover:bg-mp-ink/[.06] ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------- Chip ----------
type Tone = 'neutral' | 'accent' | 'cool' | 'hot' | 'good' | 'warn' | 'bad';
const toneDot: Record<Tone, string> = {
  neutral: 'bg-mp-ink-3',
  accent: 'bg-mp-accent',
  cool: 'bg-mp-cool-2',
  hot: 'bg-mp-hot-2',
  good: 'bg-mp-good',
  warn: 'bg-mp-warn',
  bad: 'bg-mp-bad',
};

interface ChipProps {
  children: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  dot?: boolean;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
  title?: string;
}

/** A pill: status, filter or a cited-metric link. Interactive only when it has onClick. */
export function Chip({ children, tone = 'neutral', icon, dot = false, selected = false, onClick, className = '', title }: ChipProps) {
  const cls = `inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors duration-micro ease-mp ${
    selected ? 'border-mp-accent text-mp-ink bg-mp-accent/10' : 'border-mp-line text-mp-ink-2'
  } ${onClick ? 'hover:text-mp-ink hover:border-mp-ink-3' : ''} ${className}`;
  const inner = (
    <>
      {dot && <span className={`h-2 w-2 rounded-full ${toneDot[tone]}`} aria-hidden="true" />}
      {icon}
      {children}
    </>
  );
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} aria-pressed={selected} title={title}>
      {inner}
    </button>
  ) : (
    <span className={cls} title={title}>
      {inner}
    </span>
  );
}

// ---------- Segmented ----------
interface SegmentedProps<T extends string> {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}

/** A radio group drawn as a segmented control (arrow keys move within it). */
export function Segmented<T extends string>({ label, options, value, onChange, className = '', size = 'md' }: SegmentedProps<T>) {
  const name = useId();
  return (
    <fieldset className={`inline-grid grid-flow-col auto-cols-fr overflow-hidden rounded-control border border-mp-line ${className}`}>
      <legend className="sr-only">{label}</legend>
      {options.map((o) => (
        <label
          key={o.value}
          className={`relative cursor-pointer select-none text-center font-medium transition-colors duration-micro ease-mp ${size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-[13px]'} ${
            o.value === value ? 'bg-mp-accent text-mp-accent-ink' : 'text-mp-ink-2 hover:text-mp-ink'
          } has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-mp-focus`}
        >
          <input type="radio" className="sr-only" name={name} value={o.value} checked={o.value === value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

// ---------- Toggle ----------
export function Toggle({ label, checked, onChange, icon, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; icon?: ReactNode; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-center gap-2.5 text-[13px] text-mp-ink-2">
      {icon}
      <label htmlFor={id} className="flex-1 cursor-pointer">
        {label}
        {hint && <span className="block text-xs text-mp-ink-3">{hint}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-[18px] w-[30px] flex-none rounded-full transition-colors duration-micro ease-mp ${checked ? 'bg-mp-accent' : 'bg-mp-ink/20'}`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-[2px] h-[14px] w-[14px] rounded-full transition-[left] duration-micro ease-mp ${checked ? 'left-[14px] bg-mp-accent-ink' : 'left-[2px] bg-mp-ink-2'}`}
        />
      </button>
    </div>
  );
}

// ---------- Slider ----------
interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  scale?: SliderScale;
  onChange: (value: number) => void;
  /** Formats the value shown beside the label and announced to screen readers. */
  format: (value: number) => string;
  hint?: ReactNode;
  /** Formatted ends of the track (e.g. "10" and "250 mi"). */
  ends?: [string, string];
  size?: 'md' | 'lg';
  className?: string;
}

const LOG_STEPS = 1000;

/**
 * A large, custom-styled slider on a native range input, so keyboard, touch and
 * screen readers work as they do everywhere (arrows, Page Up/Down, Home/End).
 * A log scale works in position space; the announced value is always the real one.
 */
export function Slider({ label, value, min, max, step = 1, scale = 'linear', onChange, format, hint, ends, size = 'md', className = '' }: SliderProps) {
  const id = useId();
  const hintId = useId();
  const pos = toPosition(value, min, max, scale);
  const isLog = scale === 'log';
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="mp-label">
          {label}
        </label>
        <output htmlFor={id} className={`mp-num text-mp-ink ${size === 'lg' ? 'text-2xl' : 'text-lg'}`}>
          {format(value)}
        </output>
      </div>
      <div className="mt-2 flex items-center gap-3">
        {ends && <span className="mp-num text-xs text-mp-ink-3">{ends[0]}</span>}
        <input
          id={id}
          type="range"
          className="mp-range flex-1"
          style={{ ['--mp-pos' as string]: `${(pos * 100).toFixed(2)}%` }}
          min={isLog ? 0 : min}
          max={isLog ? LOG_STEPS : max}
          step={isLog ? 1 : step}
          value={isLog ? Math.round(pos * LOG_STEPS) : value}
          aria-valuetext={format(value)}
          aria-describedby={hint ? hintId : undefined}
          onChange={(e) => {
            const raw = Number(e.target.value);
            onChange(isLog ? fromPosition(raw / LOG_STEPS, min, max, 'log', step) : raw);
          }}
        />
        {ends && <span className="mp-num text-xs text-mp-ink-3">{ends[1]}</span>}
      </div>
      {hint && (
        <div id={hintId} className="mt-1 text-xs text-mp-ink-3">
          {hint}
        </div>
      )}
    </div>
  );
}
