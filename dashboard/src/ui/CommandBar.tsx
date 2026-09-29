import { Bookmark, Moon, Pause, Play, Search, Share2, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { BRAND } from '../config/brand';
import { FEATURES } from '../config/features';
import { formatDate, formatMonth } from '../lib/format';
import { IconButton } from './controls';

export function AtlasMark({ className = 'h-[22px] w-[22px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} text-mp-accent`} aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 15v-3M10 15V8M14 15v-5M18 15V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export interface CommandBarProps {
  nav: ReadonlyArray<{ to: string; label: string; end?: boolean }>;
  freshness: { dataThrough: string | null; ratesAsOf: string | null; stale: boolean; sample: boolean } | null;
  onOpenPalette: () => void;
  dark: boolean;
  onToggleTheme: () => void;
  mediaPaused: boolean;
  onToggleMedia: () => void;
  onShare?: () => void;
  /** Extra controls (e.g. a hidden "Save" slot reserved for accounts, §13). */
  extra?: ReactNode;
  className?: string;
}

/** The top command bar: brand, sections, freshness, ⌘K, theme, media and share. */
export function CommandBar({ nav, freshness, onOpenPalette, dark, onToggleTheme, mediaPaused, onToggleMedia, onShare, extra, className = '' }: CommandBarProps) {
  const rates = freshness?.ratesAsOf ? formatDate(freshness.ratesAsOf).replace(/, \d{4}$/, '') : null;
  return (
    <header className={`flex h-16 items-center gap-3 px-4 sm:gap-5 sm:px-7 ${className}`}>
      <Link to="/" className="flex items-center gap-2.5 text-[16px] font-semibold tracking-tight text-mp-ink no-underline">
        <AtlasMark />
        <span>{BRAND.name}</span>
      </Link>
      <nav aria-label="Sections" className="ml-2 hidden gap-1 md:flex">
        {nav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              `rounded-control px-3 py-1.5 text-sm no-underline transition-colors duration-micro ease-mp ${isActive ? 'bg-mp-ink/[.07] text-mp-ink' : 'text-mp-ink-2 hover:text-mp-ink'}`
            }
          >
            {n.label}
          </NavLink>
        ))}
      </nav>
      <span className="flex-1" />
      {freshness && (
        <Link
          to="/methodology?section=run"
          className="hidden items-center gap-2 text-xs text-mp-ink-2 no-underline hover:text-mp-ink lg:flex"
          title={freshness.sample ? 'Showing the committed sample snapshot (a real agent run)' : 'Latest published run'}
        >
          <span className={`h-[7px] w-[7px] rounded-full ${freshness.stale ? 'bg-mp-warn' : 'bg-mp-accent shadow-[var(--mp-glow)]'}`} aria-hidden="true" />
          <span className="mp-num">
            Redfin through {formatMonth(freshness.dataThrough)}
            {rates && ` · Rates ${rates}`}
          </span>
          {freshness.stale && <span className="sr-only">(older than usual)</span>}
          {freshness.sample && <span className="rounded-full border border-mp-line px-1.5 text-[10px] font-semibold uppercase tracking-wider text-mp-ink-3">Sample</span>}
        </Link>
      )}
      <button
        type="button"
        onClick={onOpenPalette}
        className="hidden h-9 w-[260px] items-center gap-2.5 rounded-control border border-mp-line bg-mp-panel/60 px-3 text-left text-[13px] text-mp-ink-3 transition-colors duration-micro ease-mp hover:text-mp-ink-2 sm:flex"
        aria-keyshortcuts="Control+K Meta+K"
      >
        <Search size={15} strokeWidth={1.5} aria-hidden="true" />
        <span className="flex-1 truncate">Search metros, metrics, actions</span>
        <kbd className="rounded border border-mp-line px-1.5 font-figure text-[11px] text-mp-ink-3">⌘K</kbd>
      </button>
      <IconButton label="Search" className="sm:hidden" onClick={onOpenPalette}>
        <Search size={16} strokeWidth={1.5} aria-hidden="true" />
      </IconButton>
      <IconButton label={mediaPaused ? 'Play background motion' : 'Pause background motion'} onClick={onToggleMedia} aria-pressed={mediaPaused}>
        {mediaPaused ? <Play size={15} strokeWidth={1.5} aria-hidden="true" /> : <Pause size={15} strokeWidth={1.5} aria-hidden="true" />}
      </IconButton>
      <IconButton label={dark ? 'Switch to Dawn (light) theme' : 'Switch to Night (dark) theme'} onClick={onToggleTheme}>
        {dark ? <Moon size={15} strokeWidth={1.5} aria-hidden="true" /> : <Sun size={15} strokeWidth={1.5} aria-hidden="true" />}
      </IconButton>
      {/* §13 stub: "Save" slots in here once accounts exist (FEATURES.save). */}
      {FEATURES.save && (
        <IconButton label="Save this view" onClick={() => undefined} className="hidden sm:grid">
          <Bookmark size={15} strokeWidth={1.5} aria-hidden="true" />
        </IconButton>
      )}
      {onShare && (
        <IconButton label="Share this view" onClick={onShare} className="hidden sm:grid">
          <Share2 size={15} strokeWidth={1.5} aria-hidden="true" />
        </IconButton>
      )}
      {extra}
    </header>
  );
}
