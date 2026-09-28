import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { Wordmark } from '../brand/Logo';
import { NAV_ITEMS } from './nav';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  footer?: React.ReactNode;
}

/** Desktop navigation (≥1024px). Collapses to an icon rail; the choice is remembered. */
export function Sidebar({ collapsed, onToggle, footer }: SidebarProps) {
  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-border bg-surface transition-[width] duration-2 ease-out lg:flex ${collapsed ? 'w-sidebar-c' : 'w-sidebar'}`}
      data-no-print
    >
      <div className={`flex h-header items-center border-b border-border ${collapsed ? 'justify-center' : 'px-4'}`}>
        <NavLink to="/" className="no-underline" aria-label="Metro Pulse home">
          <Wordmark collapsed={collapsed} />
        </NavLink>
      </div>
      <nav aria-label="Main" className="flex-1 p-2">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                title={collapsed ? label : undefined}
                className={({ isActive }) =>
                  `flex h-9 items-center gap-3 rounded-md text-sm font-medium no-underline transition-colors duration-1 ${collapsed ? 'justify-center' : 'px-3'} ${
                    isActive ? 'bg-accent-soft text-accent' : 'text-text-2 hover:bg-surface-3 hover:text-text'
                  }`
                }
              >
                <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span className={collapsed ? 'sr-only' : ''}>{label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      {!collapsed && footer && <div className="border-t border-border p-4 text-xs text-text-3">{footer}</div>}
      <div className="border-t border-border p-2">
        <button type="button" onClick={onToggle} className={`btn btn-ghost h-9 w-full ${collapsed ? 'px-0' : 'justify-start px-3'}`} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}>
          {collapsed ? <PanelLeftOpen aria-hidden="true" className="h-4 w-4" /> : <PanelLeftClose aria-hidden="true" className="h-4 w-4" />}
          {!collapsed && <span className="text-text-2">Collapse</span>}
        </button>
      </div>
    </aside>
  );
}

/** Mobile navigation (<1024px): a compact bottom tab bar. */
export function BottomNav() {
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur lg:hidden" data-no-print>
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex h-14 flex-col items-center justify-center gap-1 text-2xs font-medium no-underline ${isActive ? 'text-accent' : 'text-text-3 hover:text-text'}`
              }
            >
              <Icon aria-hidden="true" className="h-5 w-5" />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
