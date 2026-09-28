import { BRAND } from '../../config/brand';

/**
 * The Metro Pulse mark: a rounded tile with a pulse line rising through a skyline.
 * Uses currentColor for the tile so it follows the accent token; the same geometry
 * is in public/favicon.svg and scripts/make-og.mjs (keep them in sync when rebranding).
 */
export function LogoMark({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={`${className} text-accent`} aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <path d="M7 22V15.5M12 22V12M20 22V14M25 22V10" stroke="rgb(var(--color-accent-contrast))" strokeOpacity=".35" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M5.5 18.5h5l2.5-7 4 12 3-8h6.5" fill="none" stroke="rgb(var(--color-accent-contrast))" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      {!collapsed && <span className="text-md font-semibold tracking-tight text-text">{BRAND.name}</span>}
    </span>
  );
}
