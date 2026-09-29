import { lazy, Suspense, useMemo } from 'react';
import { Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppShell } from './components/shell/AppShell';
import type { Crumb } from './components/shell/Breadcrumbs';
import { PageSkeleton } from './components/ui/Skeleton';
import { useDataSource, useIndex, useManifest } from './data/hooks';
import { EntityColorsProvider } from './hooks/EntityColors';
import { ToastProvider } from './hooks/Toast';
import { useScrollToSection } from './hooks/useSectionLink';
import { useTheme } from './hooks/useTheme';
import { withAttribution } from './lib/attribution';
import { isStale } from './lib/labels';
import { formatDateTime, formatMonth, MISSING } from './lib/format';
import { OverviewPage } from './pages/OverviewPage';

// The Overview is the landing view and stays in the main bundle; the rest load on demand.
const MetrosPage = lazy(() => import('./pages/MetrosPage').then((m) => ({ default: m.MetrosPage })));
const MetroPage = lazy(() => import('./pages/MetroPage').then((m) => ({ default: m.MetroPage })));
const ComparePage = lazy(() => import('./pages/ComparePage').then((m) => ({ default: m.ComparePage })));
const AboutPage = lazy(() => import('./pages/AboutPage').then((m) => ({ default: m.AboutPage })));
const DossierPage = lazy(() => import('./pages/DossierPage').then((m) => ({ default: m.DossierPage })));
const ArrivalPage = lazy(() => import('./pages/ArrivalPage').then((m) => ({ default: m.ArrivalPage })));
const ExplorePage = lazy(() => import('./pages/ExplorePage').then((m) => ({ default: m.ExplorePage })));
const StyleguidePage = lazy(() => import('./pages/StyleguidePage').then((m) => ({ default: m.StyleguidePage })));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));

function useCrumbs(names: ReadonlyMap<string, string>): Crumb[] {
  const { pathname } = useLocation();
  const root: Crumb = { label: 'Overview', to: '/' };
  if (pathname === '/') return [{ label: 'Overview' }];
  if (pathname.startsWith('/metros')) return [root, { label: 'Metros' }];
  if (pathname.startsWith('/metro/')) {
    const slug = pathname.split('/')[2] ?? '';
    return [root, { label: 'Metros', to: '/metros' }, { label: names.get(slug) ?? 'Metro' }];
  }
  if (pathname.startsWith('/compare')) return [root, { label: 'Compare' }];
  if (pathname.startsWith('/about')) return [root, { label: 'Methodology' }];
  return [root, { label: 'Not found' }];
}

function Shell() {
  const location = useLocation();
  const theme = useTheme();
  const index = useIndex();
  const manifest = useManifest();
  const source = useDataSource();
  useScrollToSection();

  const metros = useMemo(() => (index.status === 'ready' ? index.data.metros.map((m) => ({ slug: m.slug, name: m.name })) : []), [index]);
  const names = useMemo(() => new Map(metros.map((m) => [m.slug, m.name])), [metros]);
  const crumbs = useCrumbs(names);
  const lastRun = manifest.status === 'ready' ? manifest.data.last_run_at : index.status === 'ready' ? index.data.meta.finished_at : null;
  const sample = source.status === 'ready' && source.data?.source === 'sample';

  return (
    <AppShell
      crumbs={crumbs}
      metros={metros}
      theme={theme.preference}
      onThemeChange={theme.setPreference}
      freshness={
        index.status === 'ready'
          ? { dataThrough: index.data.data_through, ratesAsOf: index.data.rates_as_of, stale: isStale(index.data.meta.warnings), sample }
          : null
      }
      footer={{
        sources: index.status === 'ready' ? withAttribution(index.data.sources) : [],
        dataThrough: index.status === 'ready' ? formatMonth(index.data.data_through, true) : MISSING,
        lastUpdated: lastRun ? formatDateTime(lastRun) : MISSING,
      }}
    >
      <ErrorBoundary resetKey={location.pathname}>
        <Suspense fallback={<PageSkeleton label="Loading view…" />}>
          <Outlet />
        </Suspense>
      </ErrorBoundary>
    </AppShell>
  );
}

function MetroRoute() {
  const { slug } = useParams();
  // Keyed so switching metros resets page state (calculator inputs, hovers).
  return <MetroPage key={slug} />;
}

export function App() {
  return (
    <ToastProvider>
      <EntityColorsProvider>
        <Routes>
          <Route
            path="dossier/:slug"
            element={
              <Suspense fallback={null}>
                <DossierPage />
              </Suspense>
            }
          />
          <Route
            path="arrival"
            element={
              <Suspense fallback={null}>
                <ArrivalPage />
              </Suspense>
            }
          />
          <Route
            path="explore"
            element={
              <Suspense fallback={null}>
                <ExplorePage />
              </Suspense>
            }
          />
          <Route
            path="styleguide"
            element={
              <Suspense fallback={null}>
                <StyleguidePage />
              </Suspense>
            }
          />
          <Route element={<Shell />}>
            <Route index element={<OverviewPage />} />
            <Route path="metros" element={<MetrosPage />} />
            <Route path="metro/:slug" element={<MetroRoute />} />
            <Route path="compare" element={<ComparePage />} />
            <Route path="about" element={<AboutPage />} />
            <Route path="methodology" element={<AboutPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </EntityColorsProvider>
    </ToastProvider>
  );
}
