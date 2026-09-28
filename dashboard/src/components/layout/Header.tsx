import { NavLink } from 'react-router-dom';
import type { ThemePreference } from '../../lib/theme';
import { Badge } from '../ui/Badge';
import { MetroSearch, type SearchItem } from './MetroSearch';
import { ThemeToggle } from './ThemeToggle';

const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/metros', label: 'Metros', end: false },
  { to: '/compare', label: 'Compare', end: false },
  { to: '/about', label: 'About', end: false },
];

interface HeaderProps {
  searchItems: readonly SearchItem[];
  onSelectMetro: (slug: string) => void;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  sampleData: boolean;
}

export function Header({ searchItems, onSelectMetro, theme, onThemeChange, sampleData }: HeaderProps) {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <NavLink to="/" className="text-lg font-semibold text-text no-underline hover:no-underline">
            Housing Market Dashboard
          </NavLink>
          {sampleData && (
            <Badge tone="warning" title="The live data branch isn't published yet; showing a committed snapshot from a real agent run">
              Sample data
            </Badge>
          )}
        </div>
        <nav aria-label="Main" className="order-3 w-full md:order-none md:w-auto">
          <ul className="flex flex-wrap gap-1">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `block rounded-md px-3 py-1.5 text-sm no-underline hover:no-underline ${isActive ? 'bg-accent text-accent-contrast' : 'text-text hover:bg-surface-muted'}`
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex w-full min-w-0 items-center gap-2 md:ml-auto md:w-auto">
          <div className="min-w-0 flex-1 md:w-64">
            <MetroSearch items={searchItems} onSelect={onSelectMetro} label="Quick search metros" />
          </div>
          <ThemeToggle value={theme} onChange={onThemeChange} />
        </div>
      </div>
    </header>
  );
}
