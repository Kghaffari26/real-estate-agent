import { lazy, Suspense, useMemo, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom';
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

// v2 ("Night Atlas") screens. Compare and Methodology keep the v1 shell until Phase 7.
const ArrivalPage = lazy(() => import('./pages/ArrivalPage').then((m) => ({ default: m.ArrivalPage })));
const ExplorePage = lazy(() => import('./pages/ExplorePage').then((m) => ({ default: m.ExplorePage })));
const DossierPage = lazy(() => import('./pages/DossierPage').then((m) => ({ default: m.DossierPage })));
const StudioPage = lazy(() => import('./pages/StudioPage').then((m) => ({ default: m.StudioPage })));
const StyleguidePage = lazy(() => import('./pages/StyleguidePage').then((m) => ({ default: m.StyleguidePage })));
const ComparePage = lazy(() => import('./pages/ComparePage').then((m) => ({ default: m.ComparePage })));
const AboutPage = lazy(() => import('./pages/AboutPage').then((m) => ({ default: m.AboutPage })));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));

function useCrumbs(): Crumb[] {
  const { pathname } = useLocation();
  const root: Crumb = { label: 'Brief', to: '/' };
  if (pathname.startsWith('/compare')) return [root, { label: 'Compare' }];
  if (pathname.startsWith('/about') || pathname.startsWith('/methodology')) return [root, { label: 'Methodology' }];
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
  const crumbs = useCrumbs();
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

const v2 = (page: ReactNode) => <Suspense fallback={null}>{page}</Suspense>;

/** Old links keep working: v1's `/metros?q=…` and `/dossier/:slug` land on their v2 homes. */
function Redirect({ to }: { to: (slug: string | undefined, search: URLSearchParams) => string }) {
  const { slug } = useParams();
  const { search } = useLocation();
  return <Navigate replace to={to(slug, new URLSearchParams(search))} />;
}

function MetroRoute() {
  const { slug } = useParams();
  // Keyed so switching metros resets page state (chart, highlights, calculator).
  return v2(<DossierPage key={slug} />);
}

export function App() {
  return (
    <ToastProvider>
      <EntityColorsProvider>
        <Routes>
          <Route index element={v2(<ArrivalPage />)} />
          <Route path="explore" element={v2(<ExplorePage />)} />
          <Route path="metro/:slug" element={<MetroRoute />} />
          <Route path="metro/:slug/afford" element={v2(<StudioPage />)} />
          <Route path="styleguide" element={v2(<StyleguidePage />)} />
          {/* v1 → v2 redirects */}
          <Route path="arrival" element={<Redirect to={() => '/'} />} />
          <Route path="metros" element={<Redirect to={() => '/explore?view=table'} />} />
          <Route path="dossier/:slug" element={<Redirect to={(slug, q) => `/metro/${slug}${q.size ? `?${q}` : ''}`} />} />
          <Route element={<Shell />}>
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
