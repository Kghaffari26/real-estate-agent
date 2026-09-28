import { useEffect, useMemo } from 'react';
import { Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Footer } from './components/layout/Footer';
import { Header } from './components/layout/Header';
import { useDataSource, useIndex, useManifest } from './data/hooks';
import { useTheme } from './hooks/useTheme';
import { withAttribution } from './lib/attribution';
import { formatDateTime, formatMonth, MISSING } from './lib/format';
import { AboutPage } from './pages/AboutPage';
import { ComparePage } from './pages/ComparePage';
import { MetroPage } from './pages/MetroPage';
import { MetrosPage } from './pages/MetrosPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OverviewPage } from './pages/OverviewPage';

function Shell() {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const index = useIndex();
  const manifest = useManifest();
  const source = useDataSource();

  const searchItems = useMemo(
    () => (index.status === 'ready' ? index.data.metros.map((m) => ({ slug: m.slug, name: m.name })) : []),
    [index],
  );

  // Move focus to the main landmark on navigation so screen readers announce the new view.
  useEffect(() => {
    document.getElementById('main')?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const lastRun = manifest.status === 'ready' ? manifest.data.last_run_at : index.status === 'ready' ? index.data.meta.finished_at : null;

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[2000] btn" onClick={(e) => {
        e.preventDefault();
        document.getElementById('main')?.focus();
      }}>
        Skip to content
      </a>
      <Header
        searchItems={searchItems}
        onSelectMetro={(slug) => navigate(`/metro/${slug}`)}
        theme={theme.preference}
        onThemeChange={theme.setPreference}
        sampleData={source.status === 'ready' && source.data?.source === 'sample'}
      />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 outline-none">
        <ErrorBoundary resetKey={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
      <Footer
        sources={index.status === 'ready' ? withAttribution(index.data.sources) : []}
        dataThrough={index.status === 'ready' ? formatMonth(index.data.data_through, true) : MISSING}
        lastUpdated={lastRun ? formatDateTime(lastRun) : MISSING}
      />
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<OverviewPage />} />
        <Route path="metros" element={<MetrosPage />} />
        <Route path="metro/:slug" element={<MetroPage />} />
        <Route path="compare" element={<ComparePage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
