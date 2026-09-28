import { Search } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import type { ThemePreference } from '../../lib/theme';
import { LogoMark } from '../brand/Logo';
import { Breadcrumbs, type Crumb } from './Breadcrumbs';
import { FreshnessChip } from './FreshnessChip';
import { ThemeToggle } from './ThemeToggle';

interface TopBarProps {
  crumbs: readonly Crumb[];
  freshness: React.ComponentProps<typeof FreshnessChip> | null;
  onOpenPalette: () => void;
  theme: ThemePreference;
  onThemeChange: (t: ThemePreference) => void;
  isMac: boolean;
}

export function TopBar({ crumbs, freshness, onOpenPalette, theme, onThemeChange, isMac }: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur-md" data-no-print>
      <div className="flex h-header items-center gap-3 px-4 lg:px-6">
        <NavLink to="/" className="shrink-0 no-underline lg:hidden" aria-label="Metro Pulse home">
          <LogoMark />
        </NavLink>
        <div className="hidden min-w-0 flex-1 sm:block">
          <Breadcrumbs items={crumbs} />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {freshness ? <FreshnessChip {...freshness} /> : <span className="skeleton h-7 w-24 sm:w-44 md:w-64" aria-hidden="true" />}
          <button type="button" onClick={onOpenPalette} className="btn h-8 gap-2 px-2 text-text-3 md:w-56 md:justify-start md:px-2.5" aria-label="Search metros and pages" aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}>
            <Search aria-hidden="true" className="h-4 w-4" />
            <span className="hidden flex-1 text-left font-normal md:inline">Search metros…</span>
            <kbd className="kbd hidden md:inline-flex">{isMac ? '⌘' : 'Ctrl'} K</kbd>
          </button>
          <ThemeToggle value={theme} onChange={onThemeChange} />
        </div>
      </div>
    </header>
  );
}
