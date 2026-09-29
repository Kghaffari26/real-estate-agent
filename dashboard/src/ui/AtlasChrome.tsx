import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { CommandPalette } from '../components/shell/CommandPalette';
import { useDataSource, useIndex } from '../data/hooks';
import { useTheme } from '../hooks/useTheme';
import { isStale } from '../lib/labels';
import { CommandBar } from './CommandBar';
import { ATLAS_NAV, useMediaPaused } from './atlasState';
import { MotionRoot } from './MotionRoot';

interface AtlasChromeProps {
  children: ReactNode;
  /** Full-bleed canvas routes (Explore) float the bar over the canvas. */
  overlay?: boolean;
  onShare?: () => void;
}

/** The v2 page frame: Night/Dawn tokens, the command bar, ⌘K and framer-motion. */
export function AtlasChrome({ children, overlay = false, onShare }: AtlasChromeProps) {
  const theme = useTheme();
  const index = useIndex();
  const source = useDataSource();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mediaPaused, setMediaPaused] = useMediaPaused();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const metros = useMemo(() => (index.status === 'ready' ? index.data.metros.map((m) => ({ slug: m.slug, name: m.name })) : []), [index]);
  const freshness =
    index.status === 'ready'
      ? {
          dataThrough: index.data.data_through,
          ratesAsOf: index.data.rates_as_of,
          stale: isStale(index.data.meta.warnings),
          sample: source.status === 'ready' && source.data?.source === 'sample',
        }
      : null;
  const dark = theme.resolved === 'dark';

  return (
    <MotionRoot>
      <div className="mp-page relative min-h-screen" data-media-paused={mediaPaused || undefined}>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-mp-panel focus:px-3 focus:py-2">
          Skip to content
        </a>
        <CommandBar
          className={overlay ? 'absolute inset-x-0 top-0 z-30' : 'relative z-30'}
          nav={ATLAS_NAV}
          freshness={freshness}
          onOpenPalette={() => setPaletteOpen(true)}
          dark={dark}
          onToggleTheme={() => theme.setPreference(dark ? 'light' : 'dark')}
          mediaPaused={mediaPaused}
          onToggleMedia={() => setMediaPaused(!mediaPaused)}
          onShare={onShare}
        />
        <main id="main">{children}</main>
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} metros={metros} onNavigate={(to) => navigate(to)} />
      </div>
    </MotionRoot>
  );
}
