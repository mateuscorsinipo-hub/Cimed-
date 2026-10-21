import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { Spinner, UiProvider } from './components/ui';
import { AppStateProvider } from './state/AppState';
import Landing from './pages/landing/Landing';
import { Privacy, Terms } from './pages/landing/Legal';
import NotFound from './pages/NotFound';

const AppLayout = lazy(() => import('./components/app/AppLayout').then((m) => ({ default: m.AppLayout })));
const Overview = lazy(() => import('./pages/app/Overview'));
const Sessions = lazy(() => import('./pages/app/Sessions'));
const SessionDetail = lazy(() => import('./pages/app/SessionDetail'));
const NewAnalysis = lazy(() => import('./pages/app/NewAnalysis'));
const Compare = lazy(() => import('./pages/app/Compare'));
const Onboard = lazy(() => import('./pages/app/Onboard'));
const TrackPage = lazy(() => import('./pages/app/TrackPage'));
const Engineer = lazy(() => import('./pages/app/Engineer'));
const Reports = lazy(() => import('./pages/app/Reports'));
const Settings = lazy(() => import('./pages/app/Settings'));

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

const fallback = (
  <div className="flex min-h-[50vh] items-center justify-center">
    <Spinner />
  </div>
);

export default function App() {
  return (
    <UiProvider>
      <ScrollToTop />
      <Suspense fallback={fallback}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/privacidade" element={<Privacy />} />
          <Route path="/termos" element={<Terms />} />
          <Route
            path="/app"
            element={
              <AppStateProvider>
                <AppLayout />
              </AppStateProvider>
            }
          >
            <Route index element={<Overview />} />
            <Route path="sessoes" element={<Sessions />} />
            <Route path="sessoes/:id" element={<SessionDetail />} />
            <Route path="analise" element={<NewAnalysis />} />
            <Route path="comparar" element={<Compare />} />
            <Route path="onboard" element={<Onboard />} />
            <Route path="tracado" element={<TrackPage />} />
            <Route path="engenheiro" element={<Engineer />} />
            <Route path="relatorios" element={<Reports />} />
            <Route path="relatorios/:id" element={<Reports />} />
            <Route path="configuracoes" element={<Settings />} />
            <Route path="*" element={<NotFound inApp />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </UiProvider>
  );
}
