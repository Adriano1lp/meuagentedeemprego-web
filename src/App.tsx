import { useRef } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';

import { readBillingReturnIntent } from './api/billing';
import { useAuth } from './auth/AuthContext';
import {
  APP_HISTORY,
  APP_HOME,
  APP_PROFILE,
  ENTER_PATH,
  rememberReturnTo,
  returnPathFromLocation,
} from './auth/returnTo';
import { BillingReturnProvider } from './billing/BillingReturn';
import { ConsentGate } from './components/ConsentGate';
import { AuthPage } from './pages/AuthPage';
import { HistoryPage } from './pages/HistoryPage';
import { HomePage } from './pages/HomePage';
import { LandingPage } from './pages/LandingPage';
import { ProfilePage } from './pages/ProfilePage';

function LandingRoute() {
  const location = useLocation();
  if (readBillingReturnIntent(location.search)) {
    return (
      <Navigate
        to={{
          pathname: APP_HOME,
          search: location.search,
          hash: location.hash,
        }}
        replace
      />
    );
  }
  return <LandingPage />;
}

function EntrarRoute() {
  const { isAuthenticated } = useAuth();
  const wasAuthenticated = useRef(isAuthenticated);
  if (wasAuthenticated.current && isAuthenticated) {
    return <Navigate to={APP_HOME} replace />;
  }
  return <AuthPage />;
}

function RequireAuth() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  if (!isAuthenticated && readBillingReturnIntent(location.search)) {
    return null;
  }
  if (!isAuthenticated) {
    rememberReturnTo(returnPathFromLocation(location.pathname, location.search));
    return <Navigate to={ENTER_PATH} replace />;
  }
  return <Outlet />;
}

function LegacyRedirect({ to }: { to: string }) {
  const location = useLocation();
  return (
    <Navigate
      to={{ pathname: to, search: location.search, hash: location.hash }}
      replace
    />
  );
}

export function App() {
  return (
    <BillingReturnProvider>
      <ConsentGate>
        <Routes>
          <Route path="/" element={<LandingRoute />} />
          <Route path={ENTER_PATH} element={<EntrarRoute />} />
          <Route path={APP_HOME} element={<RequireAuth />}>
            <Route index element={<HomePage />} />
            <Route path="historico" element={<HistoryPage />} />
            <Route path="perfil" element={<ProfilePage />} />
            <Route path="*" element={<Navigate to={APP_HOME} replace />} />
          </Route>
          <Route
            path="/historico"
            element={<LegacyRedirect to={APP_HISTORY} />}
          />
          <Route path="/perfil" element={<LegacyRedirect to={APP_PROFILE} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ConsentGate>
    </BillingReturnProvider>
  );
}
