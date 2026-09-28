import { LazyMotion, MotionConfig, m } from 'framer-motion';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Citation } from '../../data/schema.gen';
import type { ThemePreference } from '../../lib/theme';
import { BottomNav, Sidebar } from './Sidebar';
import { CommandPalette } from './CommandPalette';
import { Footer } from './Footer';
import { TopBar } from './TopBar';
import type { Crumb } from './Breadcrumbs';
import type { FreshnessChip } from './FreshnessChip';

const COLLAPSE_KEY = 're-sidebar-collapsed';
const loadFeatures = () => import('./motionFeatures').then((mod) => mod.default);

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

interface AppShellProps {
  children: ReactNode;
  crumbs: readonly Crumb[];
  freshness: React.ComponentProps<typeof FreshnessChip> | null;
  metros: readonly { slug: string; name: string }[];
  theme: ThemePreference;
  onThemeChange: (t: ThemePreference) => void;
  footer: { sources: readonly Citation[]; dataThrough: string; lastUpdated: string };
}

export function AppShell({ children, crumbs, freshness, metros, theme, onThemeChange, footer }: AppShellProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const isMac = useMemo(() => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent), []);

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        // not persisted
      }
      return !c;
    });
  }, []);

  // ⌘K / Ctrl+K anywhere opens the palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // New view: move focus to <main> so screen readers announce it; scroll to top unless a section is linked.
  useEffect(() => {
    document.getElementById('main')?.focus({ preventScroll: true });
    if (!new URLSearchParams(location.search).get('section')) window.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user">
        <a
          href="#main"
          className="btn sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[3000]"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById('main')?.focus();
          }}
        >
          Skip to content
        </a>
        <Sidebar collapsed={collapsed} onToggle={toggle} />
        <div className={`flex min-h-screen flex-col pb-16 print:!pl-0 print:pb-0 transition-[padding] duration-2 ease-out lg:pb-0 ${collapsed ? 'lg:pl-sidebar-c' : 'lg:pl-sidebar'}`}>
          <TopBar crumbs={crumbs} freshness={freshness} onOpenPalette={() => setPaletteOpen(true)} theme={theme} onThemeChange={onThemeChange} isMac={isMac} />
          <main id="main" tabIndex={-1} className="mx-auto min-h-[640px] lg:min-h-[900px] w-full max-w-[1400px] flex-1 px-4 py-6 outline-none print:min-h-0 lg:px-6 lg:py-8">
            <m.div key={location.pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}>
              {children}
            </m.div>
          </main>
          <Footer {...footer} />
        </div>
        <BottomNav />
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} metros={metros} onNavigate={(to) => navigate(to)} />
      </MotionConfig>
    </LazyMotion>
  );
}
