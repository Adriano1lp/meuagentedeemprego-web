import { Navigate, Route, Routes } from 'react-router-dom';

import { useAuth } from './auth/AuthContext';
import { ConsentGate } from './components/ConsentGate';
import { AuthPage } from './pages/AuthPage';
import { HistoryPage } from './pages/HistoryPage';
import { HomePage } from './pages/HomePage';
import { ProfilePage } from './pages/ProfilePage';

export function App() {
  const { isAuthenticated } = useAuth();

  return (
    <ConsentGate>
      <Routes>
        <Route
          path="/"
          element={isAuthenticated ? <HomePage /> : <AuthPage />}
        />
        <Route
          path="/historico"
          element={
            isAuthenticated ? <HistoryPage /> : <Navigate to="/" replace />
          }
        />
        <Route
          path="/perfil"
          element={
            isAuthenticated ? <ProfilePage /> : <Navigate to="/" replace />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ConsentGate>
  );
}
