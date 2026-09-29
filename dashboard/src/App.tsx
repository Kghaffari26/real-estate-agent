import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { EntityColorsProvider } from './hooks/EntityColors';
import { ToastProvider } from './hooks/Toast';
import { removeBoot } from './lib/boot';

// Every screen is v2 ("Night Atlas") and brings its own AtlasChrome.
const ArrivalPage = lazy(() => import('./pages/ArrivalPage').then((m) => ({ default: m.ArrivalPage })));
const ExplorePage = lazy(() => import('./pages/ExplorePage').then((m) => ({ default: m.ExplorePage })));
const DossierPage = lazy(() => import('./pages/DossierPage').then((m) => ({ default: m.DossierPage })));
const StudioPage = lazy(() => import('./pages/StudioPage').then((m) => ({ default: m.StudioPage })));
const CompareArenaPage = lazy(() =>
  import('./pages/CompareArenaPage').then((m) => ({
    default: m.CompareArenaPage,
  })),
);
const MethodologyPage = lazy(() =>
  import('./pages/MethodologyPage').then((m) => ({
    default: m.MethodologyPage,
  })),
);
const StyleguidePage = lazy(() => import('./pages/StyleguidePage').then((m) => ({ default: m.StyleguidePage })));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));

function Page({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  // index.html's pre-JS poster belongs to Arrival only (which removes it once its own poster paints).
  useEffect(() => {
    if (pathname !== '/') removeBoot();
  }, [pathname]);
  return (
    <ErrorBoundary resetKey={pathname}>
      <Suspense fallback={null}>{children}</Suspense>
    </ErrorBoundary>
  );
}

/** Old links keep working: v1's `/metros?q=…` and `/dossier/:slug` land on their v2 homes. */
function Redirect({ to }: { to: (slug: string | undefined, search: URLSearchParams) => string }) {
  const { slug } = useParams();
  const { search } = useLocation();
  return <Navigate replace to={to(slug, new URLSearchParams(search))} />;
}

function MetroRoute() {
  const { slug } = useParams();
  // Keyed so switching metros resets page state (chart, highlights).
  return (
    <Page>
      <DossierPage key={slug} />
    </Page>
  );
}

export function App() {
  return (
    <ToastProvider>
      <EntityColorsProvider>
        <Routes>
          <Route
            index
            element={
              <Page>
                <ArrivalPage />
              </Page>
            }
          />
          <Route
            path="explore"
            element={
              <Page>
                <ExplorePage />
              </Page>
            }
          />
          <Route path="metro/:slug" element={<MetroRoute />} />
          <Route
            path="metro/:slug/afford"
            element={
              <Page>
                <StudioPage />
              </Page>
            }
          />
          <Route
            path="compare"
            element={
              <Page>
                <CompareArenaPage />
              </Page>
            }
          />
          <Route
            path="methodology"
            element={
              <Page>
                <MethodologyPage />
              </Page>
            }
          />
          <Route
            path="styleguide"
            element={
              <Page>
                <StyleguidePage />
              </Page>
            }
          />
          {/* v1 → v2 redirects */}
          <Route path="about" element={<Redirect to={(_, q) => `/methodology${q.size ? `?${q}` : ''}`} />} />
          <Route path="arrival" element={<Redirect to={() => '/'} />} />
          <Route path="metros" element={<Redirect to={() => '/explore?view=table'} />} />
          <Route path="dossier/:slug" element={<Redirect to={(slug, q) => `/metro/${slug}${q.size ? `?${q}` : ''}`} />} />
          <Route
            path="*"
            element={
              <Page>
                <NotFoundPage />
              </Page>
            }
          />
        </Routes>
      </EntityColorsProvider>
    </ToastProvider>
  );
}
